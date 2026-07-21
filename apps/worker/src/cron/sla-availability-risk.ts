import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDispatchBoard, type DispatchBoardTech } from "../dispatch/board.js";
import { namesMatch } from "../dispatch/board-sources.js";

const DEFAULT_WARNING_MINUTES = 10;
const MINIMUM_RECOVERY_BUFFER_MS = 5 * 60_000;

export interface AvailabilityRiskInput {
  readonly haloId: number;
  readonly dueAt: string;
  readonly nowMs: number;
  readonly tech: Pick<DispatchBoardTech, "status" | "statusTicketId" | "unavailableUntil">;
}

/**
 * A live presence signal becomes an SLA ownership risk only when it leaves no
 * credible time to act before the deadline. Unknown presence never triggers an
 * automated call; uncertainty is not treated as absence.
 */
export function availabilityRiskReason(input: AvailabilityRiskInput): string | null {
  const dueMs = Date.parse(input.dueAt);
  if (!Number.isFinite(dueMs) || dueMs <= input.nowMs) return null;

  const { state, detail } = input.tech.status;
  if (state === "available" || state === "after_hours" || state === "unknown") return null;
  if (state === "working" && input.tech.statusTicketId === input.haloId) return null;

  if (state === "meeting" || state === "onsite") {
    const unavailableUntilMs = input.tech.unavailableUntil ? Date.parse(input.tech.unavailableUntil) : NaN;
    // If the commitment ends with at least five minutes left, give the owner a
    // chance to handle the ticket without an interruption.
    if (Number.isFinite(unavailableUntilMs) && unavailableUntilMs < dueMs - MINIMUM_RECOVERY_BUFFER_MS) {
      return null;
    }
  }

  return detail?.trim() || state.replaceAll("_", " ");
}

function warningMinutes(): number {
  const parsed = Number(process.env.SLA_OWNER_UNAVAILABLE_WARNING_MINUTES ?? DEFAULT_WARNING_MINUTES);
  return Number.isFinite(parsed) && parsed >= 3 && parsed <= 60 ? parsed : DEFAULT_WARNING_MINUTES;
}

export async function queueUpcomingSlaAvailabilityCalls(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ checked: number; queued: number }> {
  const minutes = warningMinutes();
  const end = new Date(now.getTime() + minutes * 60_000);
  const { data: candidates, error } = await supabase
    .from("tickets")
    .select("halo_id, halo_agent, sla_fix_by")
    .eq("halo_is_open", true)
    .eq("sla_on_hold", false)
    .eq("sla_currently_breached", false)
    .gt("sla_fix_by", now.toISOString())
    .lte("sla_fix_by", end.toISOString())
    .order("sla_fix_by", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  if (!candidates?.length) return { checked: 0, queued: 0 };

  const board = await buildDispatchBoard();
  let queued = 0;
  const techsQueuedThisRun = new Set<string>();
  for (const candidate of candidates) {
    const haloId = Number(candidate.halo_id);
    const agent = String(candidate.halo_agent ?? "").trim();
    const dueAt = String(candidate.sla_fix_by ?? "");
    if (!haloId || !agent || agent.toLowerCase() === "unassigned" || !dueAt) continue;

    const tech = board.techs.find((row) => namesMatch(row.tech, agent));
    if (!tech) continue;
    const techKey = tech.tech.toLowerCase();
    if (techsQueuedThisRun.has(techKey)) continue;
    const reason = availabilityRiskReason({ haloId, dueAt, nowMs: now.getTime(), tech });
    if (!reason) continue;

    // Never originate overlapping robot calls to the same person. The next
    // scan can reconsider the remaining tickets after this warning is handled.
    const { data: recentForTech, error: recentError } = await supabase
      .from("sla_call_requests")
      .select("id")
      .eq("tech_name", agent)
      .in("status", ["pending", "calling"])
      .gte("created_at", new Date(now.getTime() - 15 * 60_000).toISOString())
      .limit(1);
    if (recentError) throw new Error(recentError.message);
    if (recentForTech?.length) continue;

    const normalizedDueAt = new Date(dueAt).toISOString();
    const dedupeKey = `pre_breach:${haloId}:${normalizedDueAt}`;
    const { error: insertError } = await supabase.from("sla_call_requests").insert({
      halo_id: haloId,
      phone: null,
      tech_name: agent,
      call_type: "pre_breach",
      due_at: normalizedDueAt,
      availability_detail: reason.slice(0, 500),
      dedupe_key: dedupeKey,
    });
    if (insertError?.code === "23505") continue;
    if (insertError) throw new Error(insertError.message);
    queued++;
    techsQueuedThisRun.add(techKey);
    const dueIn = Math.max(1, Math.ceil((Date.parse(normalizedDueAt) - now.getTime()) / 60_000));
    console.log(`[SLA-RISK] Queued availability call to ${agent} for #${haloId} (due in ${dueIn}m; ${reason})`);
  }
  return { checked: candidates.length, queued };
}
