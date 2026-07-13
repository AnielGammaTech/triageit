import { createHmac, randomBytes } from "node:crypto";
import { secureTokenEqual } from "./secure-token";

export const TV_SESSION_COOKIE = "triageit_tv_session";
export const TV_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TV_LINK_MAX_AGE_SECONDS = 15 * 60;

/**
 * Shared-key auth for the TV wallboard. The key lives in TV_DASHBOARD_KEY on
 * the web service — no Supabase session needed, so a TV browser can hold a
 * bookmarked URL forever. Fails closed when the env var is unset.
 */
export function isValidTvKey(candidate: string | null | undefined): boolean {
  const expected = process.env.TV_DASHBOARD_KEY;
  return secureTokenEqual(candidate, expected);
}

export function tvKeyConfigured(): boolean {
  return Boolean(process.env.TV_DASHBOARD_KEY);
}

type TvTokenKind = "link" | "session";

function createToken(kind: TvTokenKind, ttlSeconds: number, now = Date.now()): string {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!key) throw new Error("TV_DASHBOARD_KEY is not configured");
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const payload = `${kind}.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidToken(candidate: string | null | undefined, kind: TvTokenKind, now = Date.now()): boolean {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!candidate || !key) return false;
  const parts = candidate.split(".");
  if (parts.length !== 4 || parts[0] !== kind) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  return secureTokenEqual(parts[3], expected);
}

export function createTvLinkToken(now = Date.now()): string {
  return createToken("link", TV_LINK_MAX_AGE_SECONDS, now);
}

export function isValidTvLinkToken(candidate: string | null | undefined, now = Date.now()): boolean {
  return isValidToken(candidate, "link", now);
}

export function createTvSessionToken(now = Date.now()): string {
  return createToken("session", TV_SESSION_MAX_AGE_SECONDS, now);
}

export function isValidTvSessionToken(candidate: string | null | undefined, now = Date.now()): boolean {
  return isValidToken(candidate, "session", now);
}
