import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { enqueueTriageJob } from "../queue/producer.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import type { HaloTicket } from "@triageit/shared";

interface TicketSyncResult {
  readonly pulled: number;
  readonly created: number;
  readonly updated: number;
  readonly triageEnqueued: number;
}

/**
 * Periodic ticket sync — pulls all open tickets from Halo and upserts
 * into the local DB. Catches tickets that missed the webhook.
 *
 * Runs every 30 minutes via BullMQ cron to keep TriageIt in sync with Halo.
 */
export async function syncTicketsFromHalo(): Promise<TicketSyncResult> {
  const supabase = createSupabaseClient();

  const haloConfig = await getCachedHaloConfig(supabase);

  if (!haloConfig) {
    console.log("[TICKET-SYNC] Halo not configured — skipping");
    return { pulled: 0, created: 0, updated: 0, triageEnqueued: 0 };
  }

  const halo = new HaloClient(haloConfig);

  // Only sync "Gamma Default" tickets (type id=31)
  console.log("[TICKET-SYNC] Fetching Gamma Default open tickets from Halo...");
  const openTickets = await halo.getOpenTickets(31);
  console.log(`[TICKET-SYNC] Got ${openTickets.length} open tickets from Halo`);

  if (openTickets.length === 0) {
    return { pulled: 0, created: 0, updated: 0, triageEnqueued: 0 };
  }

  // Find which tickets already exist locally
  const haloIds = openTickets.map((t) => t.id);
  const { data: existingTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, status")
    .in("halo_id", haloIds);

  const existingMap = new Map(
    (existingTickets ?? []).map((t) => [t.halo_id, t]),
  );

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let triageEnqueued = 0;

  // Pre-resolve all agent names in one pass (fixes N+1 API calls)
  const uniqueAgentIds = [...new Set(
    openTickets
      .map((t) => t.agent_id)
      .filter((id): id is number => id != null),
  )];

  const agentNameMap = new Map<number, string>();
  for (const agentId of uniqueAgentIds) {
    const name = await halo.resolveAgentName(null, agentId);
    if (name) agentNameMap.set(agentId, name);
  }

  function getResolvedAgentName(ticket: HaloTicket): string | null {
    const name = ticket.agent_name;
    if (name && typeof name === "string" && !/^(?:tech\s*)?\d+$/i.test(name.trim())) return name;
    if (ticket.agent_id && agentNameMap.has(ticket.agent_id)) return agentNameMap.get(ticket.agent_id)!;
    return name ?? null;
  }

  // Insert new tickets (ones not in local DB)
  const newTickets = openTickets.filter((t) => !existingMap.has(t.id));

  if (newTickets.length > 0) {
    const insertRows = newTickets.map((ticket) => ({
      halo_id: ticket.id,
      summary: ticket.summary ?? `Ticket #${ticket.id}`,
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
      halo_agent: getResolvedAgentName(ticket),
      tickettype_id: ticket.tickettype_id ?? null,
      last_tech_action_at: ticket.lastactiondate ?? null,
      last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
      created_at: ticket.datecreated ?? now,
      updated_at: now,
    }));

    const { data: insertedRows, error: insertError } = await supabase
      .from("tickets")
      .insert(insertRows)
      .select("id, halo_id");

    if (insertError) {
      console.error("[TICKET-SYNC] Insert failed:", insertError.message);
    } else if (insertedRows) {
      created = insertedRows.length;
      console.log(`[TICKET-SYNC] Created ${created} new tickets`);

      // Enqueue new tickets for triage using IDs returned from insert
      for (const row of insertedRows) {
        try {
          const original = newTickets.find((t) => t.id === row.halo_id);
          if (original) {
            await enqueueTriageJob({
              ticketId: row.id,
              haloId: row.halo_id,
              summary: original.summary ?? `Ticket #${original.id}`,
            });
            triageEnqueued++;
          }
        } catch {
          // Non-critical
        }
      }
    }
  }

  // Update existing tickets with fresh Halo data (status, agent, etc.)
  const existingToUpdate = openTickets.filter((t) => existingMap.has(t.id));

  for (const ticket of existingToUpdate) {
    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        summary: ticket.summary,
        client_name: ticket.client_name ?? null,
        halo_status: resolveStatusName(ticket),
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: getResolvedAgentName(ticket),
        last_tech_action_at: ticket.lastactiondate ?? null,
        last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
        updated_at: now,
      })
      .eq("halo_id", ticket.id);

    if (!updateError) updated++;
  }

  console.log(
    `[TICKET-SYNC] Complete: ${openTickets.length} pulled, ${created} created, ${updated} updated, ${triageEnqueued} enqueued for triage`,
  );

  return { pulled: openTickets.length, created, updated, triageEnqueued };
}

// Simplified status resolver (worker-side doesn't have the full status map fetch)
function resolveStatusName(ticket: HaloTicket): string {
  const name =
    (ticket as Record<string, unknown>).statusname ??
    (ticket as Record<string, unknown>).status_name ??
    null;

  if (name && typeof name === "string" && /[a-zA-Z]/.test(name)) {
    return name;
  }

  const STATUS_MAP: Record<number, string> = {
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
    32: "New",
  };

  return STATUS_MAP[ticket.status_id] ?? `Status ${ticket.status_id}`;
}
