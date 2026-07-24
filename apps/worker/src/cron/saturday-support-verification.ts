import { createSupabaseClient } from "../db/supabase.js";
import { buildWeekData } from "../dispatch/week.js";
import { runSlaCallRequests } from "./sla-call.js";
import {
  buildSaturdaySupportObjective,
  SATURDAY_SUPPORT_MANAGER_PHONE,
  saturdaySupportDedupeKey,
  saturdaySupportEscalationDedupeKey,
} from "../voice/saturday-support-call.js";

function etParts(now: Date): {
  readonly day: string;
  readonly weekday: string;
  readonly hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
  };
}

function etDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function shiftLabel(startsAt: string, endsAt: string): string {
  const format = (iso: string) => new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${format(startsAt)}–${format(endsAt)} ET`;
}

export function isSaturdaySupportVerificationWindow(now: Date): boolean {
  const parts = etParts(now);
  return parts.weekday === "Sat" && parts.hour === 8;
}

async function queueMissingAssignmentEscalation(
  date: string,
  reason: string,
): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("sla_call_requests").insert({
    halo_id: 0,
    phone: SATURDAY_SUPPORT_MANAGER_PHONE,
    tech_name: "Aniel Reyes",
    objective: buildSaturdaySupportObjective({
      kind: "manager_escalation",
      technician: "No technician found",
      date,
      shift: "8:00 AM–5:00 PM ET",
      attempt: 3,
      reason,
    }),
    call_type: "info",
    due_at: new Date().toISOString(),
    availability_detail: reason,
    dedupe_key: saturdaySupportEscalationDedupeKey(date),
  });
  if (error?.code !== "23505" && error) throw new Error(error.message);
}

export async function runSaturdaySupportVerification(
  now = new Date(),
): Promise<{ queued: boolean; called: number; reason: string }> {
  if (!isSaturdaySupportVerificationWindow(now)) {
    return { queued: false, called: 0, reason: "outside_saturday_start_window" };
  }

  const { day } = etParts(now);
  const supabase = createSupabaseClient();
  const { count, error: lookupError } = await supabase
    .from("sla_call_requests")
    .select("id", { count: "exact", head: true })
    .like("dedupe_key", `saturday_support:${day}:%`);
  if (lookupError) throw new Error(lookupError.message);

  let queued = false;
  if ((count ?? 0) === 0) {
    const schedule = await buildWeekData(day);
    const assignment = schedule.saturdaySupport;
    if (!assignment || etDay(assignment.startsAt) !== day) {
      await queueMissingAssignmentEscalation(
        day,
        `No assignment for ${day} could be read from Saturday Support Schedule V2.`,
      );
      queued = true;
    } else {
      const shift = shiftLabel(assignment.startsAt, assignment.endsAt);
      const { error } = await supabase.from("sla_call_requests").insert({
        halo_id: 0,
        phone: null,
        tech_name: assignment.technician,
        objective: buildSaturdaySupportObjective({
          kind: "verification",
          technician: assignment.technician,
          date: day,
          shift,
          attempt: 1,
        }),
        call_type: "info",
        due_at: now.toISOString(),
        availability_detail: `${assignment.technician} · ${shift}`,
        dedupe_key: saturdaySupportDedupeKey(day, assignment.technician, 1),
      });
      if (error?.code !== "23505" && error) throw new Error(error.message);
      queued = !error;
    }
  }

  const result = await runSlaCallRequests();
  return {
    queued,
    called: result.called,
    reason: queued ? "verification_queued" : "existing_workflow_resumed",
  };
}
