import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

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
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 10, 60_000, "pull-tickets");
  if (rateLimited) return rateLimited;

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

    // ── Pull ALL open tickets from Halo (paginated) ──
    const allTickets: HaloTicket[] = [];
    let totalRecordCount = 0;

    // Two-pass pull from Halo to ensure we get ALL tickets:
    // Pass 1: open_only=true (Halo's view of open tickets)
    // Pass 2: all tickets from last 90 days (catches ones Halo's filter misses)
    // Deduplicate by ticket ID, then determine open/closed by actual status.
    const GAMMA_DEFAULT_TYPE_ID = 31;

    // Pass 1: Halo's "open" tickets
    const openResult = await fetchHaloTicketsPaginated(
      config.base_url, token,
      `open_only=true&tickettype_id=${GAMMA_DEFAULT_TYPE_ID}`,
    );
    console.log(`[HALO SYNC] Pass 1 (open_only): ${openResult.tickets.length} tickets, ${openResult.pages} pages, record_count=${openResult.totalCount}`);

    const seenIds = new Set<number>();
    for (const t of openResult.tickets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTickets.push(t);
      }
    }

    // Pass 2: All Gamma Default from last 90 days (catches missed tickets)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const allResult = await fetchHaloTicketsPaginated(
      config.base_url, token,
      `tickettype_id=${GAMMA_DEFAULT_TYPE_ID}&dateoccurred_start=${ninetyDaysAgo}`,
    );
    console.log(`[HALO SYNC] Pass 2 (all 90d): ${allResult.tickets.length} tickets, ${allResult.pages} pages, record_count=${allResult.totalCount}`);

    for (const t of allResult.tickets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTickets.push(t);
      }
    }

    totalRecordCount = allTickets.length;

    // Build lookup maps from Halo API
    const [agentNameMap, statusNameMap] = await Promise.all([
      fetchAgentNameMap(config.base_url, token),
      fetchStatusNameMap(config.base_url, token),
    ]);

    // Determine open/closed by actual status — don't trust Halo's open_only filter
    const resolvedStatuses = [
      "closed", "resolved", "cancelled", "completed",
      "resolved remotely", "resolved onsite",
      "resolved - awaiting confirmation",
    ];

    const openHaloIdSet = new Set(
      allTickets
        .filter((t) => {
          const status = resolveStatusName(t, statusNameMap).toLowerCase();
          return !resolvedStatuses.some((s) => status.includes(s));
        })
        .map((t) => t.id),
    );

    console.log(
      `[HALO SYNC] Total unique: ${allTickets.length}. Open by status: ${openHaloIdSet.size}. Resolved: ${allTickets.length - openHaloIdSet.size}.`,
    );

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
        status: "pending" as const,
        halo_status: resolveStatusName(ticket, statusNameMap),
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: resolveAgentName(ticket, agentNameMap),
        tickettype_id: (ticket.tickettype_id as number) ?? null,
        halo_is_open: openHaloIdSet.has(ticket.id),
        last_tech_action_at: ticket.lastactiondate ?? ticket.last_action_date ?? null,
        last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
        created_at: ticket.datecreated ?? now,
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
      let resolvedStatus = resolveStatusName(ticket, statusNameMap);
      let resolvedAgent = resolveAgentName(ticket, agentNameMap);

      // If status or agent couldn't be resolved from list data, fetch the
      // individual ticket from Halo which returns richer field data
      const statusMissing = resolvedStatus.startsWith("Status ") || resolvedStatus === "Unknown";
      const agentMissing = !resolvedAgent;
      if (statusMissing || agentMissing) {
        try {
          const singleRes = await fetch(
            `${config.base_url}/api/tickets/${ticket.id}?includedetails=true`,
            { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
          );
          if (singleRes.ok) {
            const full = (await singleRes.json()) as HaloTicket;
            if (statusMissing) {
              resolvedStatus = resolveStatusName(full, statusNameMap);
            }
            if (agentMissing) {
              resolvedAgent = resolveAgentName(full, agentNameMap);
            }
            console.log(`[HALO SYNC] Ticket #${ticket.id}: enriched from single endpoint — status="${resolvedStatus}", agent="${resolvedAgent}"`);
          }
        } catch {
          // Non-critical — keep whatever we resolved from the list
        }
      }

      const { error: updateError } = await serviceClient
        .from("tickets")
        .update({
          summary: ticket.summary,
          client_name: ticket.client_name ?? null,
          halo_status: resolvedStatus,
          halo_status_id: ticket.status_id,
          halo_team: ticket.team_name ?? ticket.team ?? null,
          halo_agent: resolvedAgent,
          tickettype_id: (ticket.tickettype_id as number) ?? null,
          halo_is_open: openHaloIdSet.has(ticket.id),
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

    // ── Reconcile open/closed status with Halo ─────────────────────
    // We have the full list of open Halo IDs from the status check above.
    // Set halo_is_open based on whether the ticket is in the open set.
    let reopenedCount = 0;
    let closedCount = 0;

    // Re-open tickets that Halo says are open but we have as closed
    const openHaloIds = [...openHaloIdSet];
    if (openHaloIds.length > 0) {
      const { data: localClosed } = await serviceClient
        .from("tickets")
        .select("id, halo_id")
        .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
        .eq("halo_is_open", false)
        .in("halo_id", openHaloIds);

      if (localClosed && localClosed.length > 0) {
        const reopenIds = localClosed.map((t) => t.id as string);
        await serviceClient
          .from("tickets")
          .update({ halo_is_open: true, updated_at: now })
          .in("id", reopenIds);
        reopenedCount = reopenIds.length;
        console.log(`[HALO SYNC] Re-opened ${reopenedCount} tickets that are open in Halo`);
      }
    }

    // Close tickets that Halo says are resolved but we have as open
    const resolvedHaloIds = allTickets
      .filter((t) => !openHaloIdSet.has(t.id))
      .map((t) => t.id);

    if (resolvedHaloIds.length > 0) {
      const { data: localOpen } = await serviceClient
        .from("tickets")
        .select("id, halo_id")
        .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
        .eq("halo_is_open", true)
        .in("halo_id", resolvedHaloIds);

      if (localOpen && localOpen.length > 0) {
        const closeIds = localOpen.map((t) => t.id as string);
        await serviceClient
          .from("tickets")
          .update({ halo_is_open: false, updated_at: now })
          .in("id", closeIds);
        closedCount = closeIds.length;
        console.log(`[HALO SYNC] Closed ${closedCount} tickets that are resolved in Halo`);
      }
    }

    // ── Auto-triage pending tickets that were never triaged ──────────
    // Tickets stuck in "pending" status missed their initial triage.
    let pendingTriaged = 0;
    {
      const workerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL;
      if (workerUrl) {
        const { data: pendingTickets } = await serviceClient
          .from("tickets")
          .select("id, halo_id, updated_at")
          .eq("status", "pending");

        // Only retry tickets that have been pending for at least 2 minutes
        // (avoid racing with in-flight triage requests)
        const twoMinutesAgo = Date.now() - 2 * 60 * 1000;

        for (const ticket of pendingTickets ?? []) {
          const updatedAt = ticket.updated_at ? new Date(ticket.updated_at).getTime() : 0;
          if (updatedAt < twoMinutesAgo) {
            try {
              await fetch(`${workerUrl}/triage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ halo_id: ticket.halo_id }),
              });
              pendingTriaged++;
              console.log(`[HALO SYNC] Retrying stuck pending ticket #${ticket.halo_id}`);
            } catch {
              // Non-critical
            }
          }
        }

        if (pendingTriaged > 0) {
          console.log(`[HALO SYNC] Re-queued ${pendingTriaged} stuck pending tickets for triage`);
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
      success: true,
      message: `Synced ${allTickets.length} tickets. ${openHaloIdSet.size} open, ${closedCount} closed, ${reopenedCount} re-opened, ${created} new.`,
      pulled: allTickets.length,
      open_count: openHaloIdSet.size,
      halo_total: totalRecordCount || allTickets.length,
      created,
      updated,
      closed: closedCount,
      reopened: reopenedCount,
      reset_to_pending: resetToPending,
      pending_retriaged: pendingTriaged,
      sla_breaching: slaBreachers.length,
      sla_auto_triaged: slaTriaged,
      maps: { agents: agentNameMap.size, statuses: statusNameMap.size },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Paginate through Halo tickets with the given query filter.
 * Returns all fetched tickets, total count from Halo, and pages fetched.
 */
async function fetchHaloTicketsPaginated(
  baseUrl: string,
  token: string,
  queryFilter: string,
): Promise<{ tickets: HaloTicket[]; totalCount: number; pages: number }> {
  const tickets: HaloTicket[] = [];
  const pageSize = 100;
  let page = 1;
  let totalCount = 0;

  while (true) {
    const res = await fetch(
      `${baseUrl}/api/tickets?page_size=${pageSize}&page_no=${page}&${queryFilter}&order=datecreated&orderdesc=true&includecolumns=true&includeslainfo=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[HALO SYNC] Failed to fetch page ${page} (${queryFilter}): ${text}`);
      break;
    }

    const data = (await res.json()) as {
      tickets?: HaloTicket[];
      record_count?: number;
    };
    const batch = data.tickets ?? [];
    tickets.push(...batch);

    if (data.record_count && data.record_count > totalCount) {
      totalCount = data.record_count;
    }

    if (batch.length < pageSize) break;
    page++;

    // Safety cap: 50 pages = 5000 tickets per query
    if (page > 50) {
      console.warn(`[HALO SYNC] Hit 50-page cap for query: ${queryFilter}`);
      break;
    }
  }

  return { tickets, totalCount, pages: page };
}

/**
 * Resolve the human-readable status name from Halo ticket data.
 * Halo uses different field names depending on the endpoint/version.
 */
function resolveStatusName(
  ticket: HaloTicket,
  statusNameMap: ReadonlyMap<number, string>,
): string {
  // Try the various status name fields Halo returns
  const name =
    ticket.statusname ??
    ticket.status_name ??
    ticket.status ??
    null;

  if (name && typeof name === "string" && /[a-zA-Z]/.test(name)) {
    return name;
  }

  // Try the live status map from Halo API
  const fromApi = statusNameMap.get(ticket.status_id);
  if (fromApi) return fromApi;

  // Fall back to our hardcoded status ID map
  return HALO_STATUS_MAP[ticket.status_id] ?? `Status ${ticket.status_id}`;
}

/**
 * Resolve agent name from ticket data, using the agent name map as fallback.
 */
function resolveAgentName(
  ticket: HaloTicket,
  agentNameMap: ReadonlyMap<number, string>,
): string | null {
  // Prefer agent_name from the API — but only if it looks like a real name
  // Halo sometimes returns the agent_id as the agent_name field
  if (
    ticket.agent_name &&
    typeof ticket.agent_name === "string" &&
    /[a-zA-Z]/.test(ticket.agent_name)
  ) {
    return ticket.agent_name;
  }
  // Look up by agent_id in our cached agents list
  if (ticket.agent_id) {
    const name = agentNameMap.get(ticket.agent_id) ?? null;
    if (!name) {
      console.warn(`[HALO SYNC] Ticket #${ticket.id}: agent_id=${ticket.agent_id} not found in agent map (${agentNameMap.size} agents loaded)`);
    }
    return name;
  }
  return null;
}

/**
 * Fetch all Halo agents and build an id→name lookup map.
 */
async function fetchStatusNameMap(
  baseUrl: string,
  token: string,
): Promise<ReadonlyMap<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(
      `${baseUrl}/api/status?count=500`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (res.ok) {
      const raw = await res.json();
      const statuses: ReadonlyArray<{ id: number; name: string }> =
        Array.isArray(raw) ? raw : (raw.statuses ?? raw.records ?? []);
      for (const s of statuses) {
        if (s.id && s.name) {
          map.set(s.id, s.name);
        }
      }
      console.log(`[HALO SYNC] Status name map: ${map.size} statuses loaded`);
    } else {
      console.warn(`[HALO SYNC] Status list fetch failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("[HALO SYNC] Status name map fetch error:", err);
  }
  return map;
}

async function fetchAgentNameMap(
  baseUrl: string,
  token: string,
): Promise<ReadonlyMap<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(
      `${baseUrl}/api/agent?count=500`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (res.ok) {
      const raw = await res.json();
      // Halo may return a flat array OR { agents: [...] }
      const agents: ReadonlyArray<{ id: number; name: string }> =
        Array.isArray(raw) ? raw : (raw.agents ?? raw.records ?? []);
      for (const agent of agents) {
        if (agent.id && agent.name) {
          map.set(agent.id, agent.name);
        }
      }
      console.log(`[HALO SYNC] Agent name map: ${map.size} agents loaded`);
    } else {
      console.warn(`[HALO SYNC] Agent list fetch failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("[HALO SYNC] Agent name map fetch error:", err);
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
