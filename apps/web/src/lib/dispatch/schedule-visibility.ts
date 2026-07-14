interface ScheduleEventWindow {
  readonly day: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
}

export function etDateKey(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isCurrentEtDay(day: string, nowMs: number): boolean {
  return day === etDateKey(nowMs);
}

/** Future dates show the full day; today hides only events whose end time has passed. */
export function isActiveOrUpcomingEvent(event: ScheduleEventWindow, nowMs: number): boolean {
  if (!isCurrentEtDay(event.day, nowMs) || event.allDay) return true;

  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  const cutoff = Number.isFinite(endsAt) && endsAt > startsAt ? endsAt : startsAt;
  return !Number.isFinite(cutoff) || cutoff > nowMs;
}

export function formatEtTime(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}
