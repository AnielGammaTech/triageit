import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TV_SESSION_COOKIE = "triageit_tv_session";
export const TV_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const TV_PAIRING_MAX_AGE_SECONDS = 10 * 60;

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

export function createTvPairingSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTvPairingSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function isValidTvPairingSecret(secret: string | null | undefined): secret is string {
  return Boolean(secret && /^[A-Za-z0-9_-]{40,64}$/.test(secret));
}

export function createTvSessionToken(now = Date.now()): string {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!key) throw new Error("TV_DASHBOARD_KEY is not configured");
  const expiresAt = Math.floor(now / 1000) + TV_SESSION_MAX_AGE_SECONDS;
  const payload = `session.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function isValidTvSessionToken(candidate: string | null | undefined, now = Date.now()): boolean {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!candidate || !key) return false;
  const parts = candidate.split(".");
  if (parts.length !== 4 || parts[0] !== "session") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  const actualBytes = Buffer.from(parts[3]);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
