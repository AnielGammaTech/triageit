const ET_TZ = "America/New_York";

/**
 * ET wall-clock ↔ UTC conversion helpers.
 *
 * Halo's /api/Appointment returns start_date/end_date as ET wall-clock
 * strings WITHOUT a timezone offset (verified live 2026-07-10 —
 * "2026-07-13T11:00:00" means 11 AM Eastern). Parsing them as UTC shifted
 * every appointment by 4-5 hours ("until 3:30 AM" on the board). The
 * conversion below uses the same server-local↔ET shift technique as
 * etTodayBounds and the MS Graph client, so it is correct in any server TZ
 * and across DST.
 */

/** ET wall-clock string ("YYYY-MM-DDTHH:mm[:ss]") → UTC epoch ms. Null = unparseable. */
export function etWallToUtcMs(wall: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall);
  if (!m) return null;
  const localMs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime();
  if (!Number.isFinite(localMs)) return null;
  const etWall = new Date(new Date(localMs).toLocaleString("en-US", { timeZone: ET_TZ }));
  return localMs + (localMs - etWall.getTime());
}

/** ET wall-clock string → UTC ISO. Null = unparseable. */
export function etWallToUtcIso(wall: string): string | null {
  const ms = etWallToUtcMs(wall);
  return ms !== null ? new Date(ms).toISOString() : null;
}

/**
 * Halo date string → UTC ISO. Halo's /api/Appointment returns UTC WITHOUT
 * a Z suffix — verified live against ticket #40930 (2026-07-10): the
 * appointment Halo displays as "7/14/2026 04:00 PM (-04:00)" comes back as
 * "2026-07-14T20:00:00". Treat offset-less values as UTC; honor explicit
 * offsets if an instance setting ever adds them.
 */
export function haloEtToUtcIso(value: string): string | null {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const ms = Date.parse(hasOffset ? value : `${value}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * UTC ISO instant → ET wall-clock "YYYY-MM-DDTHH:mm:ss" (the format MS Graph
 * expects alongside timeZone "Eastern Standard Time"). Null = unparseable.
 */
export function utcIsoToEtWall(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // sv-SE gives "YYYY-MM-DD HH:mm:ss" — exactly the wall format, T-separated.
  return new Date(ms).toLocaleString("sv-SE", { timeZone: ET_TZ }).replace(" ", "T");
}

/** Today's [midnight, midnight+24h) in ET, as UTC ISO strings. */
export function etTodayBounds(now: Date): { readonly start: string; readonly end: string } {
  const etWall = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
  const offsetMs = now.getTime() - etWall.getTime();
  const midnight = new Date(etWall.getFullYear(), etWall.getMonth(), etWall.getDate());
  const startMs = midnight.getTime() + offsetMs;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 3600_000).toISOString(),
  };
}
