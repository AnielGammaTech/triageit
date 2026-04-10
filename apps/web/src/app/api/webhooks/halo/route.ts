import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/webhooks/halo
 *
 * Halo PSA sends a webhook when tickets are created/updated.
 * Halo can send the ticket object directly in the body, or just a notification
 * with the ticket ID. We handle both cases:
 *
 * 1. Extract the ticket ID from the webhook payload
 * 2. Fetch the full ticket from Halo API (to get reliable, complete data)
 * 3. Skip closed/resolved tickets — only triage open tickets
 * 4. Upsert into our tickets table
 * 5. Set status to "pending" for new tickets (ready for triage)
 * 6. Trigger the worker to begin AI triage
 *
 * Setup in Halo PSA:
 *   Configuration > Integrations > Webhooks
 *   URL: https://your-domain.com/api/webhooks/halo
 *   Method: POST
 *   Auth: Basic authentication
 *   Username: HALO_WEBHOOK_USERNAME env var
 *   Password: HALO_WEBHOOK_PASSWORD env var
 *   Trigger: Ticket Created (and optionally Ticket Updated)
 */

// Halo statuses that indicate a ticket is closed/resolved and should be skipped
const CLOSED_STATUS_NAMES = new Set([
  "closed",
  "resolved",
  "cancelled",
  "canceled",
  "completed",
  "resolved remotely",
  "resolved onsite",
  "resolved - awaiting confirmation",
]);

// Common Halo status IDs for closed/resolved (Halo API often omits statusname)
// 9 = Closed is the most common across Halo instances
const CLOSED_STATUS_IDS = new Set([9, 10, 24, 26, 27]);
export async function POST(request: NextRequest) {
  // Auth check — supports both Basic auth (Halo's format) and Bearer token
  const authHeader = request.headers.get("authorization") ?? "";
  const expectedUser = process.env.HALO_WEBHOOK_USERNAME;
  const expectedPass = process.env.HALO_WEBHOOK_PASSWORD;
  const bearerSecret = process.env.HALO_WEBHOOK_SECRET;

  if (expectedUser && expectedPass) {
    // Basic auth: "Basic base64(username:password)"
    if (!authHeader.startsWith("Basic ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const encoded = authHeader.slice(6);
    let decoded: string;
    try {
      decoded = atob(encoded);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [user, pass] = decoded.split(":");
    if (user !== expectedUser || pass !== expectedPass) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (bearerSecret) {
    // Fallback: Bearer token
    if (authHeader !== `Bearer ${bearerSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Parse body — Halo may send various formats
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Extract ticket ID — Halo webhooks can send:
  // { id: 123, summary: "..." }  (direct ticket object)
  // { ticket_id: 123 }           (notification style)
  // { event_data: { id: 123 } }  (wrapped format)
  const ticketId = extractTicketId(body);
  if (!ticketId) {
    return NextResponse.json(
      { error: "Could not extract ticket ID from webhook payload" },
      { status: 400 },
    );
  }

  const supabase = await createServiceClient();

  // Get Halo credentials to fetch the full ticket
  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("service", "halo")
    .single();

  if (!integration?.is_active) {
    // No Halo config — try to use the webhook body directly
    return await upsertFromWebhookBody(supabase, ticketId, body);
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  try {
    // Authenticate with Halo
    const token = await getHaloToken(config);

    // Fetch the full ticket from Halo API (includecolumns=true to get agent_name)
    const ticketResponse = await fetch(
      `${config.base_url}/api/tickets/${ticketId}?includecolumns=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!ticketResponse.ok) {
      console.error(
        `[WEBHOOK] Failed to fetch ticket #${ticketId} from Halo: ${ticketResponse.status}`,
      );
      // Fallback to webhook body
      return await upsertFromWebhookBody(supabase, ticketId, body);
    }

    const haloTicket = (await ticketResponse.json()) as HaloApiTicket;

    // If ticket is closed/resolved in Halo, sync status and run close review
    if (isTicketClosed(haloTicket)) {
      const statusName = (haloTicket.statusname ?? haloTicket.status_name ?? "closed") as string;
      console.log(
        `[WEBHOOK] Ticket #${ticketId} is closed in Halo (status: ${statusName}) — syncing status`,
      );

      const { data: existingTicket } = await supabase
        .from("tickets")
        .select("id")
        .eq("halo_id", ticketId)
        .single();

      if (existingTicket) {
        await supabase
          .from("tickets")
          .update({
            halo_is_open: false,
            halo_status: statusName,
            halo_status_id: haloTicket.status_id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingTicket.id);

        console.log(
          `[WEBHOOK] Marked ticket #${ticketId} as closed in TriageIT`,
        );

        // Trigger close review for Gamma Default tickets only (type 31)
        if (haloTicket.tickettype_id === 31) {
          const workerUrl = process.env.WORKER_URL;
          if (workerUrl) {
            try {
              await fetch(`${workerUrl}/close-review`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ halo_id: ticketId }),
              });
              console.log(`[WEBHOOK] Close review triggered for #${ticketId}`);
            } catch (err) {
              console.error(`[WEBHOOK] Failed to trigger close review for #${ticketId}:`, err);
            }
          }
        }
      }

      return NextResponse.json({
        status: "closed",
        reason: "Ticket closed in Halo — synced to TriageIT, close review triggered",
        halo_id: ticketId,
      });
    }

    // Only process Gamma Default tickets (type 31) — skip Alerts and other types
    const GAMMA_DEFAULT_TYPE_ID = 31;
    if (haloTicket.tickettype_id && haloTicket.tickettype_id !== GAMMA_DEFAULT_TYPE_ID) {
      console.log(
        `[WEBHOOK] Skipping non-Gamma Default ticket #${ticketId} (type: ${haloTicket.tickettype_id})`,
      );
      return NextResponse.json({
        status: "skipped",
        reason: `Not Gamma Default (type ${haloTicket.tickettype_id})`,
        halo_id: ticketId,
      });
    }

    // Upsert into our tickets table — include Halo status for live tracking
    return await upsertTicket(supabase, {
      halo_id: haloTicket.id,
      summary: haloTicket.summary ?? "No subject",
      details: haloTicket.details ?? null,
      client_name: haloTicket.client_name ?? null,
      client_id: haloTicket.client_id ?? null,
      user_name: haloTicket.user_name ?? null,
      user_email: haloTicket.user_emailaddress ?? null,
      original_priority: haloTicket.priority_id ?? null,
      halo_status: (haloTicket.statusname ?? haloTicket.status_name ?? null) as string | null,
      halo_status_id: haloTicket.status_id ?? null,
      halo_agent: await resolveWebhookAgentName(haloTicket, config, token),
      halo_team: (haloTicket.team ?? null) as string | null,
      tickettype_id: haloTicket.tickettype_id ?? null,
      raw_data: haloTicket,
    });
  } catch (error) {
    console.error("[WEBHOOK] Error processing Halo webhook:", error);
    // Last resort fallback
    return await upsertFromWebhookBody(supabase, ticketId, body);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function isTicketClosed(ticket: HaloApiTicket): boolean {
  // Check by status name (most reliable when present)
  const statusName = (ticket.statusname ?? ticket.status_name ?? "").toString().toLowerCase().trim();
  if (CLOSED_STATUS_NAMES.has(statusName)) return true;

  // Check by status_id — Halo API often omits statusname
  // Common closed/resolved status IDs across Halo instances
  if (typeof ticket.status_id === "number" && CLOSED_STATUS_IDS.has(ticket.status_id)) return true;

  // Halo's "inactive" flag
  if (ticket.inactive === true) return true;

  return false;
}

function extractTicketId(body: Record<string, unknown>): number | null {
  // Halo webhook notification format (most common):
  // { id: "uuid", object_id: 33479, ticket: {...}, event: "...", webhook_id: "..." }
  // object_id is the REAL ticket ID — body.id is the notification UUID!
  if (typeof body.object_id === "number") return body.object_id;
  if (typeof body.object_id === "string") {
    const parsed = parseInt(body.object_id, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Nested ticket object: { ticket: { id: 33479 } }
  if (body.ticket && typeof body.ticket === "object") {
    const ticket = body.ticket as Record<string, unknown>;
    if (typeof ticket.id === "number") return ticket.id;
  }

  // Direct ticket object (when Halo sends full ticket): { id: 123, summary: "..." }
  // Only use body.id if it's a number (not a UUID string)
  if (typeof body.id === "number") return body.id;

  // Notification: { ticket_id: 123 }
  if (typeof body.ticket_id === "number") return body.ticket_id;
  if (typeof body.ticket_id === "string") {
    const parsed = parseInt(body.ticket_id, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Wrapped: { event_data: { id: 123 } }
  if (body.event_data && typeof body.event_data === "object") {
    const eventData = body.event_data as Record<string, unknown>;
    if (typeof eventData.id === "number") return eventData.id;
  }

  // body.id as string — ONLY if it looks like a pure number (not a UUID)
  if (typeof body.id === "string" && /^\d+$/.test(body.id)) {
    return parseInt(body.id, 10);
  }

  return null;
}

interface TicketInsertData {
  readonly halo_id: number;
  readonly summary: string;
  readonly details: string | null;
  readonly client_name: string | null;
  readonly client_id: number | null;
  readonly user_name: string | null;
  readonly user_email: string | null;
  readonly original_priority: number | null;
  readonly halo_status?: string | null;
  readonly halo_status_id?: number | null;
  readonly halo_agent?: string | null;
  readonly halo_team?: string | null;
  readonly tickettype_id?: number | null;
  readonly raw_data: unknown;
}

async function upsertTicket(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  data: TicketInsertData,
) {
  const { data: existing } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", data.halo_id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("tickets")
      .update({
        summary: data.summary,
        details: data.details,
        client_name: data.client_name,
        client_id: data.client_id,
        user_name: data.user_name,
        user_email: data.user_email,
        original_priority: data.original_priority,
        halo_status: data.halo_status ?? undefined,
        halo_status_id: data.halo_status_id ?? undefined,
        halo_agent: data.halo_agent ?? undefined,
        halo_team: data.halo_team ?? undefined,
        halo_is_open: true,
        tickettype_id: data.tickettype_id ?? undefined,
        raw_data: data.raw_data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    // Check for update request patterns on ticket updates
    // Forward the latest action to the worker's /webhook/action endpoint
    await checkForUpdateRequest(data.halo_id);

    // Auto-retriage when ticket status is "Customer Reply" — customer is waiting
    const statusLower = (data.halo_status ?? "").toLowerCase();
    if (statusLower.includes("customer reply") || statusLower.includes("customer responded")) {
      await triggerAutoRetriage(data.halo_id, existing.id);
    }

    return NextResponse.json({ status: "updated", ticket_id: existing.id });
  }

  const { data: inserted, error } = await supabase
    .from("tickets")
    .insert({
      halo_id: data.halo_id,
      summary: data.summary,
      details: data.details,
      client_name: data.client_name,
      client_id: data.client_id,
      user_name: data.user_name,
      user_email: data.user_email,
      original_priority: data.original_priority,
      halo_status: data.halo_status ?? null,
      halo_status_id: data.halo_status_id ?? null,
      halo_agent: data.halo_agent ?? null,
      halo_team: data.halo_team ?? null,
      tickettype_id: data.tickettype_id ?? null,
      halo_is_open: true,
      status: "pending",
      raw_data: data.raw_data,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to insert ticket" }, { status: 500 });
  }

  // Trigger the worker to begin AI triage
  await triggerTriage(inserted.id);

  return NextResponse.json({ status: "created", ticket_id: inserted.id }, { status: 201 });
}

async function upsertFromWebhookBody(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  ticketId: number,
  body: Record<string, unknown>,
) {
  return await upsertTicket(supabase, {
    halo_id: ticketId,
    summary: (body.summary as string) ?? (body.subject as string) ?? "No subject",
    details: (body.details as string) ?? (body.description as string) ?? null,
    client_name: (body.client_name as string) ?? null,
    client_id: typeof body.client_id === "number" ? body.client_id : null,
    user_name: (body.user_name as string) ?? (body.reportedby as string) ?? null,
    user_email: (body.user_emailaddress as string) ?? (body.user_email as string) ?? null,
    original_priority: typeof body.priority_id === "number" ? body.priority_id : null,
    raw_data: body,
  });
}

/**
 * Check if the latest customer action on a ticket is an update request.
 * If so, forward it to the worker's /webhook/action endpoint for handling.
 */
async function checkForUpdateRequest(haloId: number): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return;

  try {
    // Fetch recent actions from Halo via the worker's proxy
    // The worker will detect if it's an update request and handle it
    const supabase = await createServiceClient();
    const { data: integration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .single();

    if (!integration) return;

    const config = integration.config as {
      base_url: string;
      client_id: string;
      client_secret: string;
      tenant?: string;
    };

    const token = await getHaloToken(config);

    // Fetch the latest actions for this ticket
    const actionsResponse = await fetch(
      `${config.base_url}/api/actions?ticket_id=${haloId}&excludesys=true&count=3&order=datecreated&orderdesc=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!actionsResponse.ok) return;

    const actionsData = (await actionsResponse.json()) as { actions?: Array<{ note?: string; hiddenfromuser?: boolean; who?: string }> };
    const actions = actionsData.actions ?? [];

    // Find the most recent customer-visible action (not internal)
    const latestCustomerAction = actions.find((a) => !a.hiddenfromuser && a.note);
    if (!latestCustomerAction?.note) return;

    // Forward to worker's /webhook/action endpoint — it will check patterns
    await fetch(`${workerUrl}/webhook/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket_id: haloId,
        note: latestCustomerAction.note,
        who: latestCustomerAction.who,
        hiddenfromuser: false,
      }),
    });
  } catch (error) {
    // Non-fatal — don't block the webhook response
    console.error(`[WEBHOOK] Failed to check for update request on #${haloId}:`, error);
  }
}

/**
 * Trigger the worker service to begin AI triage on the ticket.
 * The worker runs as a separate Railway service with a /triage endpoint.
 * Falls back gracefully — ticket stays "pending" and can be retriggered.
 */
async function triggerTriage(ticketId: string): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    console.warn("[WEBHOOK] WORKER_URL not set — ticket will stay pending until manually triggered");
    return;
  }

  try {
    const response = await fetch(`${workerUrl}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: ticketId }),
    });

    if (!response.ok) {
      console.error(`[WEBHOOK] Worker triage trigger failed: ${response.status}`);
    } else {
      console.log(`[WEBHOOK] Triage triggered for ticket ${ticketId}`);
    }
  } catch (error) {
    // Non-fatal — ticket stays "pending", can be retried
    console.error("[WEBHOOK] Failed to reach worker:", error);
  }
}

/**
 * Trigger auto-retriage for a ticket when a customer replies.
 * This ensures the tech review catches unresponsive techs in real-time
 * instead of waiting for the next cron cycle.
 */
async function triggerAutoRetriage(haloId: number, localTicketId: string): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return;

  try {
    console.log(`[WEBHOOK] Auto-retriage triggered for #${haloId} (customer reply detected)`);
    const response = await fetch(`${workerUrl}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: localTicketId }),
    });

    if (!response.ok) {
      console.error(`[WEBHOOK] Auto-retriage failed for #${haloId}: ${response.status}`);
    }
  } catch (error) {
    console.error(`[WEBHOOK] Auto-retriage error for #${haloId}:`, error);
  }
}

async function getHaloToken(config: {
  base_url: string;
  client_id: string;
  client_secret: string;
  tenant?: string;
}): Promise<string> {
  const tokenUrl = await discoverTokenEndpoint(config.base_url, config.tenant);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: "all",
    }),
  });

  if (!response.ok) {
    throw new Error(`Halo auth failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function discoverTokenEndpoint(
  baseUrl: string,
  tenant?: string,
): Promise<string> {
  try {
    const infoResponse = await fetch(`${baseUrl}/api/authinfo`);
    if (infoResponse.ok) {
      const info = (await infoResponse.json()) as {
        auth_url?: string;
        token_endpoint?: string;
      };
      if (info.token_endpoint) return info.token_endpoint;
      if (info.auth_url) return `${info.auth_url}/token`;
    }
  } catch {
    // Fall through
  }
  const tokenUrl = `${baseUrl}/auth/token`;
  return tenant ? `${tokenUrl}?tenant=${tenant}` : tokenUrl;
}

/**
 * Resolve the assigned agent's name from a Halo ticket.
 * Prefers agent_name field; falls back to looking up agent_id via the Halo agents API.
 */
async function resolveWebhookAgentName(
  ticket: HaloApiTicket,
  config: { base_url: string; client_id: string; client_secret: string; tenant?: string },
  token: string,
): Promise<string | null> {
  // Prefer agent_name if the API returned it
  if (ticket.agent_name && typeof ticket.agent_name === "string") {
    return ticket.agent_name;
  }

  // Fall back to agent_id lookup
  const agentId = ticket.agent_id;
  if (typeof agentId !== "number" || agentId <= 0) return null;

  try {
    const res = await fetch(
      `${config.base_url}/api/agent/${agentId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const agent = (await res.json()) as { name?: string };
    return agent.name ?? null;
  } catch {
    console.warn(`[WEBHOOK] Could not resolve agent name for agent_id=${agentId}`);
    return null;
  }
}

interface HaloApiTicket {
  readonly id: number;
  readonly summary?: string;
  readonly details?: string;
  readonly client_id?: number;
  readonly client_name?: string;
  readonly user_name?: string;
  readonly user_emailaddress?: string;
  readonly user_id?: number;
  readonly priority_id?: number;
  readonly status_id?: number;
  readonly statusname?: string;
  readonly status_name?: string;
  readonly inactive?: boolean;
  readonly tickettype_id?: number;
  readonly category_1?: string;
  readonly datecreated?: string;
  readonly [key: string]: unknown;
}
