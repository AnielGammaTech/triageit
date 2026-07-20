import { BUSINESS_TIME_ZONE, isBusinessTime } from "@triageit/shared";

const MINUTE_MS = 60_000;

export function isResponseBusinessTime(date: Date = new Date()): boolean {
  return isBusinessTime(date);
}

/** Add elapsed business minutes while pausing nights and weekends. */
export function addResponseBusinessMinutes(start: Date, minutes: number): Date {
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid business-time start");
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error("Business minutes must be a non-negative integer");

  let remaining = minutes;
  let cursor = start.getTime();
  while (remaining > 0) {
    if (isResponseBusinessTime(new Date(cursor))) remaining--;
    cursor += MINUTE_MS;
  }
  return new Date(cursor);
}

export function responseBusinessMinutesBetween(start: Date, end: Date): number {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return 0;
  let elapsed = 0;
  let cursor = start.getTime();
  while (cursor < end.getTime()) {
    if (isResponseBusinessTime(new Date(cursor))) elapsed++;
    cursor += MINUTE_MS;
  }
  return elapsed;
}

export function formatResponseDeadline(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
