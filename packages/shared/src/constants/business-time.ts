export const BUSINESS_TIME_ZONE = "America/New_York";
export const BUSINESS_START_MINUTE = 8 * 60;
export const BUSINESS_END_MINUTE = 17 * 60;

interface EasternBusinessParts {
  readonly weekday: string;
  readonly minutesOfDay: number;
}

function easternBusinessParts(date: Date): EasternBusinessParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
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

/** Gamma Tech business time: Monday-Friday, 8:00 AM-5:00 PM Eastern. */
export function isBusinessTime(date: Date = new Date()): boolean {
  const parts = easternBusinessParts(date);
  return !["Sat", "Sun"].includes(parts.weekday)
    && parts.minutesOfDay >= BUSINESS_START_MINUTE
    && parts.minutesOfDay < BUSINESS_END_MINUTE;
}
