/**
 * Halo action timestamps are UTC but its API commonly omits the trailing Z.
 * Browsers parse an offset-less ISO timestamp as local time, creating a
 * four/five-hour display error in Eastern. Preserve explicit offsets and mark
 * Halo's otherwise complete date-time values as UTC.
 */
export function normalizeHaloUtcTimestamp(value: string | null | undefined): string {
  const timestamp = value?.trim() ?? "";
  if (!timestamp) return "";
  const hasTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return hasTime && !hasZone ? `${timestamp}Z` : timestamp;
}
