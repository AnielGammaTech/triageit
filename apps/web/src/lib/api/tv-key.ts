import { timingSafeEqual } from "crypto";

/**
 * Shared-key auth for the TV wallboard. The key lives in TV_DASHBOARD_KEY on
 * the web service — no Supabase session needed, so a TV browser can hold a
 * bookmarked URL forever. Fails closed when the env var is unset.
 */
export function isValidTvKey(candidate: string | null): boolean {
  const expected = process.env.TV_DASHBOARD_KEY;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tvKeyConfigured(): boolean {
  return Boolean(process.env.TV_DASHBOARD_KEY);
}
