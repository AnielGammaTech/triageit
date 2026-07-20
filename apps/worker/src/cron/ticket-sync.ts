import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient, HALO_STATUS_FALLBACK } from "../integrations/halo/client.js";
import { enqueueTriageJob } from "../queue/producer.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import {
  deriveWorkflowOwnerRole,
  deriveWorkflowStatusFromHalo,
  isHelpdeskTechnicianName,
  type HaloTicket,
} from "@triageit/shared";
import { syncTechnicianActivityForTicket } from "../technician-activity/activity.js";

interface TicketSyncResult {
  readonly pulled: number;
  readonly created: number;
  readonly updated: number;
  readonly triageEnqueued: number;
  readonly closed: number;
}

const GAMMA_DEFAULT_TYPE_ID = 31;

// Verify at most this many missing-from-open-list tickets per run; the
// rest carry over to the next run (cron fires every minute).
const MAX_CLOSE_CHECKS_PER_RUN = 40;

/**
 * Periodic ticket sync — pulls all open tickets from Halo, upserts them
 * into the local DB, and closes local tickets Halo no longer has open.
 * Catches tickets that missed the webhook.
 *
 * Runs every minute via BullMQ cron to keep TriageIt in sync with Halo.
 */
export async function syncTicketsFromHalo(): Promise<TicketSyncResult> {
  const supabase = createSupabaseClient();

  const haloConfig = await getCachedHaloConfig(supabase);

  if (!haloConfig) {
    console.log("[TICKET-SYNC] Halo not configured — skipping");
    return { pulled: 0, created: 0, updated: 0, triageEnqueued: 0, closed: 0 };
  }

  const halo = new HaloClient(haloConfig);
  const statusMap = await halo.getStatusNameMap();

  // Only sync "Gamma Default" tickets (type id=31)
  console.log("[TICKET-SYNC] Fetching Gamma Default open tickets from Halo...");
  const openTickets = await halo.getOpenTickets(GAMMA_DEFAULT_TYPE_ID);
  console.log(`[TICKET-SYNC] Got ${openTickets.length} open tickets from Halo`);

  if (openTickets.length === 0) {
    // Empty is more likely a Halo API hiccup than a genuinely empty board —
    // skip entirely rather than close everything.
    return { pulled: 0, created: 0, updated: 0, triageEnqueued: 0, closed: 0 };
  }

  // Find which tickets already exist locally
  const haloIds = openTickets.map((t) => t.id);
  const { data: existingTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, status, workflow_past_due, resolution_time_at, onsite_visit_alerted_at, last_tech_action_at")
    .in("halo_id", haloIds);

  const existingMap = new Map(
    (existingTickets ?? []).map((t) => [t.halo_id, t]),
  );

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let triageEnqueued = 0;
  const activityCandidates = new Map<number, string | null>();

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

  // Halo uses 1900-01-01 as a "not set" sentinel for date fields.
  const slaDate = (v: unknown): string | null => {
    if (typeof v !== "string" || !v) return null;
    if (v.startsWith("1900-01-01")) return null;
    return v;
  };

  function getWorkflowFields(ticket: HaloTicket): {
    workflow_status: ReturnType<typeof deriveWorkflowStatusFromHalo>;
    workflow_owner_role: ReturnType<typeof deriveWorkflowOwnerRole>;
    resolution_time_at: string | null;
    workflow_past_due: boolean;
    sla_fix_by: string | null;
    sla_respond_by: string | null;
    sla_on_hold: boolean;
  } {
    const agentName = getResolvedAgentName(ticket);
    const hasAssignedTech = isHelpdeskTechnicianName(agentName);
    const workflowStatus = deriveWorkflowStatusFromHalo(resolveStatusName(ticket, statusMap), hasAssignedTech);
    return {
      workflow_status: workflowStatus,
      workflow_owner_role: deriveWorkflowOwnerRole(workflowStatus, hasAssignedTech),
      resolution_time_at: ticket.deadlinedate ?? null,
      workflow_past_due: workflowStatus === "PAST_DUE",
      // SLA fix/respond deadlines from the open-ticket list (includeslainfo) —
      // fixbydate is the SLA engine's breach deadline (deadlinedate is the
      // workflow resolution time). Used for the SLA Hunter "At Risk" view.
      sla_fix_by: slaDate((ticket as Record<string, unknown>).fixbydate),
      sla_respond_by: slaDate((ticket as Record<string, unknown>).respondbydate),
      sla_on_hold: (ticket as Record<string, unknown>).onhold === true,
    };
  }

  // Insert new tickets (ones not in local DB)
  const newTickets = openTickets.filter((t) => !existingMap.has(t.id));

  if (newTickets.length > 0) {
    const insertRows = newTickets.map((ticket) => {
      const workflowFields = getWorkflowFields(ticket);
      return {
        halo_id: ticket.id,
        summary: ticket.summary ?? `Ticket #${ticket.id}`,
        details: ticket.details ?? null,
        client_name: ticket.client_name ?? null,
        client_id: ticket.client_id ?? null,
        user_name: ticket.user_name ?? null,
        user_email: ticket.user_emailaddress ?? null,
        original_priority: ticket.priority_id ?? null,
        status: "pending" as const,
        halo_status: resolveStatusName(ticket, statusMap),
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: getResolvedAgentName(ticket),
        tickettype_id: ticket.tickettype_id ?? null,
        halo_is_open: true,
        last_tech_action_at: ticket.lastactiondate ?? null,
        last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
        created_at: ticket.datecreated ?? now,
        updated_at: now,
        ...workflowFields,
      };
    });

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
            activityCandidates.set(original.id, original.lastactiondate ?? null);
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

  let visitsRecorded = 0;
  for (const ticket of existingToUpdate) {
    const workflowFields = getWorkflowFields(ticket);
    const existing = existingMap.get(ticket.id);
    if ((ticket.lastactiondate ?? null) !== (existing?.last_tech_action_at ?? null)) {
      activityCandidates.set(ticket.id, ticket.lastactiondate ?? null);
    }

    // Preserve the workflow scan's past-due flag. getWorkflowFields derives
    // it from the Halo STATUS NAME only, so a deadline-based flag set by the
    // workflow scan was reset within a minute — repeating first-miss alerts
    // and firing the second-miss ownership transfer after hours instead of an
    // actual second miss. Clear it only when Halo shows a FRESH (future)
    // deadline — per the workflow doc, a new resolution_time resumes the flow.
    const freshDeadline = ticket.deadlinedate
      ? new Date(ticket.deadlinedate).getTime() > Date.now()
      : false;
    const workflowPastDue =
      workflowFields.workflow_past_due || (freshDeadline ? false : existing?.workflow_past_due === true);

    const statusNameNow = resolveStatusName(ticket, statusMap);
    // Site-visit ledger (user 2026-07-09: backend-only — no alerts, but
    // "when I ask it's there"): first time a ticket enters Scheduled
    // status, stamp it. Prison Mike and the unbilled-onsite check read it.
    const scheduledNow =
      /sched/i.test(statusNameNow ?? "") &&
      !(existing as { onsite_visit_alerted_at?: string | null })?.onsite_visit_alerted_at;
    if (scheduledNow) visitsRecorded++;

    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        ...(scheduledNow ? { onsite_visit_alerted_at: new Date().toISOString() } : {}),
        summary: ticket.summary,
        client_name: ticket.client_name ?? null,
        halo_status: statusNameNow,
        halo_status_id: ticket.status_id,
        halo_team: ticket.team_name ?? ticket.team ?? null,
        halo_agent: getResolvedAgentName(ticket),
        halo_is_open: true,
        last_tech_action_at: ticket.lastactiondate ?? null,
        last_customer_reply_at: ticket.lastcustomeractiondate ?? null,
        // updated_at deliberately NOT set here. This sync touches every open
        // ticket every minute — stamping updated_at made the triage in-flight
        // guard (updated_at < 10 min → "still running"), the stuck-triage
        // sweep (> 30 min), and the errored-ticket scan (> 1h) all see every
        // open ticket as perpetually fresh, so nothing was ever recovered.
        ...workflowFields,
        workflow_past_due: workflowPastDue,
      })
      .eq("halo_id", ticket.id);

    if (!updateError) updated++;
  }

  // Reuse the one-minute Halo ticket sync as the live activity trigger. Only
  // tickets whose last-action watermark changed are read, so management
  // reporting stays current without re-fetching every ticket on every cycle.
  if (activityCandidates.size > 0) {
    const pending = [...activityCandidates.entries()];
    let cursor = 0;
    let storedActions = 0;
    const activityWorkers = Array.from({ length: Math.min(6, pending.length) }, async () => {
      while (cursor < pending.length) {
        const [haloTicketId, lastActionAt] = pending[cursor++];
        try {
          storedActions += await syncTechnicianActivityForTicket(supabase, halo, haloTicketId, lastActionAt);
        } catch (activityError) {
          console.warn(`[TECH-ACTIVITY] Live sync failed #${haloTicketId}:`, activityError instanceof Error ? activityError.message : activityError);
        }
      }
    });
    await Promise.all(activityWorkers);
    console.log(`[TECH-ACTIVITY] Live sync: ${pending.length} changed ticket(s), ${storedActions} technician action(s) stored`);
  }

  const closed = await reconcileClosedTickets(supabase, halo, haloIds, now, statusMap);

  console.log(
    `[TICKET-SYNC] Complete: ${openTickets.length} pulled, ${created} created, ${updated} updated, ${closed} closed, ${triageEnqueued} enqueued for triage`,
  );

  if (visitsRecorded > 0) console.log(`[SYNC] Recorded ${visitsRecorded} newly scheduled site visit(s)`);

  return { pulled: openTickets.length, created, updated, triageEnqueued, closed };
}

/**
 * Close local tickets that are no longer open in Halo.
 *
 * Halo's open_only filter occasionally omits genuinely open tickets, so a
 * ticket missing from the open list is never closed on absence alone — each
 * candidate is verified individually against Halo first. A 404/410 means the
 * ticket was deleted or merged in Halo, which also counts as closed.
 */
async function reconcileClosedTickets(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  openHaloIds: ReadonlyArray<number>,
  now: string,
  statusMap: ReadonlyMap<number, string>,
): Promise<number> {
  const openIdSet = new Set(openHaloIds);

  const { data: localOpen, error: lookupError } = await supabase
    .from("tickets")
    .select("id, halo_id")
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
    .eq("halo_is_open", true);

  if (lookupError) {
    console.error("[TICKET-SYNC] Local open lookup failed:", lookupError.message);
    return 0;
  }

  const candidates = (localOpen ?? []).filter((t) => !openIdSet.has(t.halo_id));
  if (candidates.length === 0) return 0;

  if (candidates.length > MAX_CLOSE_CHECKS_PER_RUN) {
    console.log(
      `[TICKET-SYNC] ${candidates.length} close candidates, checking first ${MAX_CLOSE_CHECKS_PER_RUN} (rest next run)`,
    );
  }

  let closed = 0;

  for (const candidate of candidates.slice(0, MAX_CLOSE_CHECKS_PER_RUN)) {
    try {
      const full = await halo.getTicket(candidate.halo_id);
      const statusName = resolveStatusName(full, statusMap);

      if (isResolvedStatusName(statusName)) {
        const { error: closeError } = await supabase
          .from("tickets")
          .update({
            halo_is_open: false,
            halo_status: statusName,
            halo_status_id: full.status_id,
            workflow_status: "RESOLVED" as const,
            workflow_owner_role: null,
            workflow_past_due: false,
            updated_at: now,
          })
          .eq("id", candidate.id);

        if (closeError) {
          console.error(`[TICKET-SYNC] Failed to close #${candidate.halo_id}: ${closeError.message}`);
        } else {
          closed++;
        }
      } else if (full.tickettype_id != null && full.tickettype_id !== GAMMA_DEFAULT_TYPE_ID) {
        // Reclassified in Halo (e.g. moved to Alerts) — record the new type
        // so it leaves the Gamma Default open view
        await supabase
          .from("tickets")
          .update({
            tickettype_id: full.tickettype_id,
            halo_status: statusName,
            halo_status_id: full.status_id,
            updated_at: now,
          })
          .eq("id", candidate.id);
        console.log(`[TICKET-SYNC] #${candidate.halo_id} reclassified to type ${full.tickettype_id}`);
      }
      // Still an open Gamma Default ticket (open_only filter missed it) — leave as-is
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/\((?:404|410)\)/.test(message)) {
        const { error: closeError } = await supabase
          .from("tickets")
          .update({
            halo_is_open: false,
            workflow_status: "RESOLVED" as const,
            workflow_owner_role: null,
            workflow_past_due: false,
            updated_at: now,
          })
          .eq("id", candidate.id);

        if (!closeError) {
          closed++;
          console.log(`[TICKET-SYNC] #${candidate.halo_id} gone from Halo (deleted/merged) — closed`);
        }
      } else {
        console.warn(`[TICKET-SYNC] Close check failed for #${candidate.halo_id}: ${message}`);
      }
    }
  }

  if (closed > 0) {
    console.log(`[TICKET-SYNC] Closed ${closed} tickets no longer open in Halo`);
  }

  return closed;
}

const RESOLVED_STATUS_PATTERNS = ["closed", "resolved", "cancelled", "completed"];

function isResolvedStatusName(status: string): boolean {
  const normalized = status.toLowerCase();
  return RESOLVED_STATUS_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/** Prefer the ticket's own statusname, then the live map, then the fallback. */
function resolveStatusName(ticket: HaloTicket, statusMap: ReadonlyMap<number, string>): string {
  const name =
    (ticket as Record<string, unknown>).statusname ??
    (ticket as Record<string, unknown>).status_name ??
    null;

  if (name && typeof name === "string" && /[a-zA-Z]/.test(name)) {
    return name;
  }

  return (
    statusMap.get(ticket.status_id) ??
    HALO_STATUS_FALLBACK[ticket.status_id] ??
    `Status ${ticket.status_id}`
  );
}
