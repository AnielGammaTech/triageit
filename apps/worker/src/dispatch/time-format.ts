const ET_TZ = "America/New_York";

/** Time-of-day in ET, e.g. "3:30 PM". */
export const fmtEt = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ET_TZ,
    hour: "numeric",
    minute: "2-digit",
  });

/** ET calendar-day key (YYYY-MM-DD) for an instant. */
const etDayKey = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: ET_TZ });

/**
 * Day-aware ET time. A commitment that crosses midnight would otherwise
 * render as "until 3:30 AM", which reads broken on the board — so when the
 * timestamp falls on a different ET calendar day than now, prefix the day:
 *   today        → "3:30 PM"
 *   tomorrow     → "tomorrow 3:30 AM"
 *   further out  → "Sat 3:30 AM"
 */
export function fmtEtDayAware(iso: string, now: Date = new Date()): string {
  const target = new Date(iso);
  const time = fmtEt(iso);
  if (Number.isNaN(target.getTime())) return time; // "Invalid Date", same as fmtEt

  const targetDay = etDayKey(target);
  if (targetDay === etDayKey(now)) return time;
  if (targetDay === etDayKey(new Date(now.getTime() + 24 * 3600_000))) return `tomorrow ${time}`;
  const weekday = target.toLocaleDateString("en-US", { timeZone: ET_TZ, weekday: "short" });
  return `${weekday} ${time}`;
}
