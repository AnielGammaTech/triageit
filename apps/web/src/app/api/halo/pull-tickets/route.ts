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
  readonly sla_timer_text?: string;
  readonly fixbydate?: string;
  readonly respondbydate?: string;
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
    let totalRecordCount = 0;

    while (true) {
      const ticketsResponse = await fetch(
        `${config.base_url}/api/tickets?page_size=${pageSize}&page_no=${page}&open_only=true&order=datecreated&orderdesc=true&includecolumns=true&includeslainfo=true`,
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

      // Track total from Halo's own count
      if (data.record_count && data.record_count > totalRecordCount) {
        totalRecordCount = data.record_count;
      }

      console.log(
        `[HALO SYNC] Page ${page}: got ${tickets.length} tickets (total so far: ${allTickets.length}, Halo says: ${data.record_count ?? "unknown"})`,
      );

      if (tickets.length < pageSize) break;
      page++;

      // Safety: cap at 20 pages (2000 tickets) to avoid infinite loops
      if (page > 20) {
        console.warn("[HALO SYNC] Hit 20-page cap, stopping pagination");
        break;
      }
    }

    console.log(
      `[HALO SYNC] Done: fetched ${allTickets.length} tickets across ${page} pages (Halo record_count: ${totalRecordCount})`,
    );

    if (allTickets.length === 0) {
      return NextResponse.json({
        pulled: 0,
        created: 0,
        updated: 0,
        message: "No open tickets found in Halo.",
      });
    }

    // Build agent name lookup from Halo agents list
    const agentNameMap = await fetchAgentNameMap(config.base_url, token);

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
        status: "pending" as const,
        halo_status: resolveStatusName(ticket),
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: resolveAgentName(ticket, agentNameMap),
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

        // Trigger triage for newly created tickets via the worker
        const workerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL;
        if (workerUrl) {
          for (const ticket of newTickets) {
            try {
              await fetch(`${workerUrl}/triage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ halo_id: ticket.id }),
              });
              console.log(`[HALO SYNC] Enqueued new ticket #${ticket.id} for triage`);
            } catch (err) {
              console.error(`[HALO SYNC] Failed to enqueue ticket #${ticket.id}:`, err);
            }
          }
        }
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
          halo_agent: resolveAgentName(ticket, agentNameMap),
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

    // ── Fix tickets incorrectly marked as "triaged" without triage results ──
    // These tickets were synced before the status bug was fixed.
    let resetToPending = 0;
    {
      // Find tickets marked "triaged" that have zero triage_results rows
      const { data: markedTriaged } = await serviceClient
        .from("tickets")
        .select("id, halo_id, triage_results(id)")
        .eq("status", "triaged");

      const falsyTriaged = (markedTriaged ?? []).filter(
        (t) => !t.triage_results || t.triage_results.length === 0,
      );

      if (falsyTriaged.length > 0) {
        const resetIds = falsyTriaged.map((t) => t.id);
        const { error: resetError } = await serviceClient
          .from("tickets")
          .update({ status: "pending" as const, updated_at: now })
          .in("id", resetIds);

        if (!resetError) {
          resetToPending = falsyTriaged.length;
          console.log(
            `[HALO SYNC] Reset ${resetToPending} tickets from "triaged" to "pending" (no triage results found)`,
          );

          // Trigger triage for these reset tickets
          const workerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL;
          if (workerUrl) {
            for (const ticket of falsyTriaged) {
              try {
                await fetch(`${workerUrl}/triage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ halo_id: ticket.halo_id }),
                });
              } catch {
                // Non-critical — worker startup scan will catch these
              }
            }
          }
        }
      }
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

    // ── Auto-triage SLA-breaching tickets ────────────────────────────
    // Tickets with breached response or fix SLA need immediate attention.
    // Trigger triage for any that haven't been triaged recently.
    let slaTriaged = 0;
    const slaBreachers = allTickets.filter((t) => {
      const responseBreached = t.responsetargetmet === false;
      const fixBreached = t.fixtargetmet === false;
      return responseBreached || fixBreached;
    });

    if (slaBreachers.length > 0) {
      const workerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL;

      // Find which SLA breachers already have a recent triage (last 3h)
      const breacherHaloIds = slaBreachers.map((t) => t.id);
      const { data: recentlyTriaged } = await serviceClient
        .from("tickets")
        .select("halo_id, status, updated_at")
        .in("halo_id", breacherHaloIds);

      const recentlyTriagedMap = new Map(
        (recentlyTriaged ?? []).map((t) => [t.halo_id, t]),
      );

      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

      for (const breacher of slaBreachers) {
        const local = recentlyTriagedMap.get(breacher.id);
        const wasRecentlyUpdated = local?.updated_at
          ? new Date(local.updated_at).getTime() > threeHoursAgo
          : false;
        const isAlreadyTriaging = local?.status === "triaging" || local?.status === "pending";

        // Skip if recently triaged or currently triaging
        if (wasRecentlyUpdated || isAlreadyTriaging) continue;

        // Trigger triage via worker
        if (workerUrl) {
          try {
            await fetch(`${workerUrl}/triage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ halo_id: breacher.id }),
            });
            slaTriaged++;
            console.log(
              `[HALO SYNC] SLA breach — auto-triaging #${breacher.id}: response=${breacher.responsetargetmet}, fix=${breacher.fixtargetmet}`,
            );
          } catch (err) {
            console.error(`[HALO SYNC] Failed to auto-triage SLA breacher #${breacher.id}:`, err);
          }
        }
      }

      if (slaTriaged > 0) {
        console.log(`[HALO SYNC] Auto-triaged ${slaTriaged} SLA-breaching tickets`);
      }
    }

    return NextResponse.json({
      pulled: allTickets.length,
      halo_total: totalRecordCount || allTickets.length,
      pages_fetched: page,
      created,
      updated,
      closed: closedCount,
      reset_to_pending: resetToPending,
      sla_breaching: slaBreachers.length,
      sla_auto_triaged: slaTriaged,
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

/**
 * Resolve agent name from ticket data, using the agent name map as fallback.
 */
function resolveAgentName(
  ticket: HaloTicket,
  agentNameMap: ReadonlyMap<number, string>,
): string | null {
  // Prefer agent_name from the API if present
  if (ticket.agent_name && typeof ticket.agent_name === "string") {
    return ticket.agent_name;
  }
  // Look up by agent_id in our cached agents list
  if (ticket.agent_id) {
    return agentNameMap.get(ticket.agent_id) ?? null;
  }
  return null;
}

/**
 * Fetch all Halo agents and build an id→name lookup map.
 */
async function fetchAgentNameMap(
  baseUrl: string,
  token: string,
): Promise<ReadonlyMap<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(
      `${baseUrl}/api/agent?count=500&includeenabled=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (res.ok) {
      const data = (await res.json()) as ReadonlyArray<{
        id: number;
        name: string;
      }>;
      for (const agent of data) {
        map.set(agent.id, agent.name);
      }
    }
  } catch {
    // Non-critical — agent names will just be missing
  }
  return map;
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
