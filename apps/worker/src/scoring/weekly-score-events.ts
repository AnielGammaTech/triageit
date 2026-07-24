import type { SupabaseClient } from "@supabase/supabase-js";

export type WeeklyScoreEventType = "sla_breach" | "overdue_customer_reply";

export interface WeeklyScoreEventInput {
  readonly eventKey: string;
  readonly eventType: WeeklyScoreEventType;
  readonly haloTicketId: number;
  readonly technicianName: string;
  readonly points: -3 | -2;
  readonly occurredAt: string;
  readonly summary: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Monday date in Eastern Time, used only as an idempotency-key component. */
export function easternScoreWeekKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Idempotently records a score deduction. The event key represents the actual
 * incident, so frequent scans and concurrent worker runs cannot double-charge
 * the same SLA breach or overdue reply.
 */
export async function recordWeeklyScoreEvent(
  supabase: SupabaseClient,
  input: WeeklyScoreEventInput,
): Promise<void> {
  const technicianName = input.technicianName.trim();
  if (!technicianName) return;

  const { error } = await supabase
    .from("weekly_score_events")
    .upsert({
      event_key: input.eventKey,
      event_type: input.eventType,
      halo_ticket_id: input.haloTicketId,
      technician_name: technicianName,
      points: input.points,
      occurred_at: input.occurredAt,
      summary: input.summary,
      metadata: input.metadata ?? {},
    }, { onConflict: "event_key", ignoreDuplicates: true });

  if (error) {
    console.warn(
      `[SCOREBOARD] Could not persist ${input.eventType} for #${input.haloTicketId}: ${error.message}`,
    );
  }
}
