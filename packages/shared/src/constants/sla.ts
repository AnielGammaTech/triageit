/**
 * SLA breach determination.
 *
 * Halo's `fixtargetmet` / `responsetargetmet` are NOT breach flags — they can
 * be `false` simply because the target has not been reached YET on a healthy
 * open ticket. Declaring "SLA BREACHED" from `targetmet === false` alone put
 * a false red breach banner (naming the assigned tech) on fresh tickets.
 *
 * A target only counts as breached when Halo says it was not met AND the
 * corresponding by-date exists and is actually in the past.
 */
export function isSlaTargetBreached(
  targetMet: boolean | null | undefined,
  byDate: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (targetMet !== false) return false;
  if (!byDate) return false;
  const due = new Date(byDate).getTime();
  if (Number.isNaN(due)) return false;
  return due < nowMs;
}
