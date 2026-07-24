import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";

export const SATURDAY_SUPPORT_CALENDAR_NAME = "Saturday Support Schedule V2";

export interface SaturdaySupportAssignment {
  readonly technician: string;
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

const SUPPORT_SUBJECT_RE = /^\s*Saturday Support\s*[-–—:]\s*(.+?)\s*$/i;

export function technicianFromSaturdaySupportSubject(subject: string | null): string | null {
  if (!subject) return null;
  const match = SUPPORT_SUBJECT_RE.exec(subject);
  const technician = match?.[1]?.trim() ?? "";
  return technician || null;
}

/** The active shift, or the next future shift when none is active. */
export function nextSaturdaySupportAssignment(
  events: ReadonlyArray<MsGraphCalendarEvent>,
  now = new Date(),
): SaturdaySupportAssignment | null {
  const nowMs = now.getTime();
  return events
    .map((event) => ({
      event,
      technician: technicianFromSaturdaySupportSubject(event.subject),
    }))
    .filter((entry): entry is { event: MsGraphCalendarEvent; technician: string } =>
      entry.technician !== null &&
      Number.isFinite(Date.parse(entry.event.startsAt)) &&
      Date.parse(entry.event.endsAt) > nowMs,
    )
    .sort((a, b) => Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt))
    .map(({ event, technician }) => ({
      technician,
      subject: event.subject ?? `Saturday Support - ${technician}`,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    }))[0] ?? null;
}
