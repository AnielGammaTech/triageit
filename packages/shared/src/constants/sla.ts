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

/**
 * Timer-based breach test — the one that actually works on this Halo
 * instance. fixtargetmet/responsetargetmet are ALWAYS null here (verified
 * live 2026-07-09 across breached and healthy tickets), so the target
 * check above never fires. Halo's own "Breached SLA" view keys off the
 * SLA timer: fixtimeleft/slatimeleft go NEGATIVE (hours) on breach. The
 * timers are hold-adjusted, but never trust a frozen negative value
 * while a ticket is on hold.
 */
export function isSlaTimerBreached(
  timeLeftHours: number | null | undefined,
  onHold: boolean | null | undefined = false,
): boolean {
  if (onHold === true) return false;
  return typeof timeLeftHours === "number" && Number.isFinite(timeLeftHours) && timeLeftHours < 0;
}
