const TIME_ZONE = "America/New_York";
const BUSINESS_START_MINUTE = 8 * 60;
const BUSINESS_END_MINUTE = 17 * 60 + 15;
const MINUTE_MS = 60_000;

interface EasternParts {
  readonly weekday: string;
  readonly minutesOfDay: number;
}

function easternParts(date: Date): EasternParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour")) % 24;
  const minute = Number(value("minute"));
  return {
    weekday: value("weekday"),
    minutesOfDay: hour * 60 + minute,
  };
}

export function isResponseBusinessTime(date: Date = new Date()): boolean {
  const parts = easternParts(date);
  return !["Sat", "Sun"].includes(parts.weekday)
    && parts.minutesOfDay >= BUSINESS_START_MINUTE
    && parts.minutesOfDay < BUSINESS_END_MINUTE;
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
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

