import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

interface HaloTicket {
  readonly id: number;
  readonly summary: string;
  readonly details?: string;
  readonly client_id?: number;
  readonly client_name?: string;
  readonly user_name?: string;
  readonly user_emailaddress?: string;
  readonly agent_id?: number;
  readonly agent_name?: string;
  readonly team?: string;
  readonly team_name?: string;
  readonly status_id: number;
  readonly status?: string;
  readonly statusname?: string;
  readonly status_name?: string;
  readonly priority_id?: number;
  readonly datecreated: string;
  readonly dateoccurred?: string;
  readonly lastactiondate?: string;
  readonly last_action_date?: string;
  readonly lastcustomeractiondate?: string;
  readonly responsetargetmet?: boolean;
  readonly fixtargetmet?: boolean;
  readonly sla_status?: string;
  readonly [key: string]: unknown;
}

// Human-readable status name lookup for common Halo status IDs
const HALO_STATUS_MAP: Record<number, string> = {
  1: "New",
  2: "In Progress",
  3: "Waiting on Customer",
  4: "Customer Reply",
  5: "Scheduled",
  6: "On Hold",
  7: "Pending Vendor",
  8: "Waiting on Tech",
  9: "Closed",
  10: "Resolved",
  23: "In Progress",
  24: "Resolved Remotely",
  25: "Waiting on Parts",
  26: "Resolved Onsite",
  27: "Cancelled",
  29: "In Progress",
  30: "Waiting on Customer",
  // 31 is instance-specific — rely on statusname from API instead
  32: "New",
};

/**
 * POST /api/halo/pull-tickets
 *
 * Pulls all open tickets directly from Halo PSA and upserts them into the
 * local tickets table. Returns { pulled, created, updated }.
 */
export async function POST() {
  const serviceClient = await createServiceClient();

  const { data: integration } = await serviceClient
    .from("integrations")
    .select("config, is_active")
    .eq("service", "halo")
    .single();

  if (!integration?.is_active) {
    return NextResponse.json(
      { error: "Halo PSA is not configured. Go to Settings > Integrations and add your Halo credentials." },
      { status: 400 },
    );
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  try {
    const tokenUrl = await discoverTokenEndpoint(config.base_url, config.tenant);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id,
        client_secret: config.client_secret,
        scope: "all",
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return NextResponse.json(
        { error: `Failed to authenticate with Halo PSA: ${text}` },
        { status: 502 },
      );
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };
    const token = tokenData.access_token;

    // Paginate through all open tickets
    const allTickets: HaloTicket[] = [];
    const pageSize = 100;
    let page = 1;

    while (true) {
      const ticketsResponse = await fetch(
        `${config.base_url}/api/tickets?page_size=${pageSize}&page_no=${page}&open_only=true&order=datecreated&orderdesc=true&includecolumns=true`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!ticketsResponse.ok) {
        const text = await ticketsResponse.text();
        return NextResponse.json(
          { error: `Failed to fetch tickets from Halo: ${text}` },
          { status: 502 },
        );
      }

      const data = (await ticketsResponse.json()) as {
        tickets?: HaloTicket[];
        record_count?: number;
      };
      const tickets = data.tickets ?? [];
      allTickets.push(...tickets);

      if (tickets.length < pageSize) break;
      page++;
    }

    if (allTickets.length === 0) {
      return NextResponse.json({
        pulled: 0,
        created: 0,
        updated: 0,
        message: "No open tickets found in Halo.",
      });
    }

    const now = new Date().toISOString();

    // Find which tickets already exist locally
    const haloIds = allTickets.map((t) => t.id);
    const { data: existingTickets, error: lookupError } = await serviceClient
      .from("tickets")
      .select("id, halo_id")
      .in("halo_id", haloIds);

    if (lookupError) {
      return NextResponse.json(
        { error: `DB lookup failed: ${lookupError.message}` },
        { status: 500 },
      );
    }

    const existingHaloIds = new Set((existingTickets ?? []).map((t) => t.halo_id));

    const newTickets = allTickets.filter((t) => !existingHaloIds.has(t.id));
    const existingIds = allTickets.filter((t) => existingHaloIds.has(t.id));

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    // Batch insert new tickets
    if (newTickets.length > 0) {
      const insertRows = newTickets.map((ticket) => ({
        halo_id: ticket.id,
        summary: ticket.summary,
        details: ticket.details ?? null,
        client_name: ticket.client_name ?? null,
        client_id: ticket.client_id ?? null,
        user_name: ticket.user_name ?? null,
        user_email: ticket.user_emailaddress ?? null,
        original_priority: ticket.priority_id ?? null,
        status: "triaged" as const,
        halo_status: resolveStatusName(ticket),
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: ticket.agent_name ?? (ticket.agent_id ? String(ticket.agent_id) : null),
        last_retriage_at: now,
        last_tech_action_at: ticket.lastactiondate ?? ticket.last_action_date ?? null,
        last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
        updated_at: now,
      }));

      const { error: insertError, count } = await serviceClient
        .from("tickets")
        .insert(insertRows, { count: "exact" });

      if (insertError) {
        errors.push(`Insert failed: ${insertError.message}`);
      } else {
        created = count ?? newTickets.length;
      }
    }

    // Batch update existing tickets
    for (const ticket of existingIds) {
      const { error: updateError } = await serviceClient
        .from("tickets")
        .update({
          summary: ticket.summary,
          client_name: ticket.client_name ?? null,
          halo_status: resolveStatusName(ticket),
          halo_status_id: ticket.status_id,
          halo_team: ticket.team_name ?? ticket.team ?? null,
          halo_agent: ticket.agent_name ?? (ticket.agent_id ? String(ticket.agent_id) : null),
          last_retriage_at: now,
          last_tech_action_at: ticket.lastactiondate ?? ticket.last_action_date ?? null,
          last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
          updated_at: now,
        })
        .eq("halo_id", ticket.id);

      if (updateError) {
        errors.push(`Update #${ticket.id}: ${updateError.message}`);
      } else {
        updated++;
      }
    }

    if (errors.length > 0 && created === 0 && updated === 0) {
      return NextResponse.json(
        { error: `All DB operations failed: ${errors[0]}` },
        { status: 500 },
      );
    }

    // ── Detect tickets closed in Halo ────────────────────────────────
    // Any local ticket NOT in the Halo open list and NOT already resolved
    // was closed/resolved in Halo since our last sync.
    let closedCount = 0;
    const openHaloIds = new Set(allTickets.map((t) => t.id));

    const { data: localNonResolved } = await serviceClient
      .from("tickets")
      .select("id, halo_id, halo_status")
      .not("halo_status", "is", null);

    if (localNonResolved) {
      const resolvedStatuses = [
        "closed", "resolved", "cancelled", "completed",
        "resolved remotely", "resolved onsite",
        "resolved - awaiting confirmation",
      ];

      const staleTickets = localNonResolved.filter((t) => {
        const statusLower = (t.halo_status ?? "").toLowerCase();
        const alreadyResolved = resolvedStatuses.some((s) => statusLower.includes(s));
        return !alreadyResolved && !openHaloIds.has(t.halo_id);
      });

      // Batch-fetch current status from Halo for these stale tickets
      for (const stale of staleTickets) {
        try {
          const res = await fetch(
            `${config.base_url}/api/tickets/${stale.halo_id}?includecolumns=true`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (res.ok) {
            const ticketData = (await res.json()) as HaloTicket;
            const freshStatus = resolveStatusName(ticketData);

            await serviceClient
              .from("tickets")
              .update({
                halo_status: freshStatus,
                halo_status_id: ticketData.status_id,
                updated_at: now,
              })
              .eq("id", stale.id);

            closedCount++;
          }
        } catch {
          // Non-critical — skip if individual fetch fails
        }
      }
    }

    return NextResponse.json({
      pulled: allTickets.length,
      created,
      updated,
      closed: closedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Resolve the human-readable status name from Halo ticket data.
 * Halo uses different field names depending on the endpoint/version.
 */
function resolveStatusName(ticket: HaloTicket): string {
  // Try the various status name fields Halo returns
  const name =
    ticket.statusname ??
    ticket.status_name ??
    ticket.status ??
    null;

  if (name && typeof name === "string" && !name.startsWith("status_")) {
    return name;
  }

  // Fall back to our status ID map
  return HALO_STATUS_MAP[ticket.status_id] ?? `Status ${ticket.status_id}`;
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
    // Fall through to default
  }

  const tokenUrl = `${baseUrl}/auth/token`;
  return tenant ? `${tokenUrl}?tenant=${tenant}` : tokenUrl;
}
