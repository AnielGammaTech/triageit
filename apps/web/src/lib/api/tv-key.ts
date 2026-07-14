import { createHash, createHmac, randomBytes } from "node:crypto";
import { secureTokenEqual } from "./secure-token";

export const TV_SESSION_COOKIE = "triageit_tv_session";
export const TV_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const TV_LINK_MAX_AGE_SECONDS = 15 * 60;
const TV_ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TV_ACCESS_CODE_LENGTH = 8;

/**
 * TV_DASHBOARD_KEY signs device sessions. One-time access codes are random,
 * secret stays server-side and is never accepted directly from a browser.
 */
export function tvKeyConfigured(): boolean {
  return Boolean(process.env.TV_DASHBOARD_KEY);
}

export function normalizeTvAccessCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createTvAccessCode(): string {
  const bytes = randomBytes(TV_ACCESS_CODE_LENGTH);
  const raw = Array.from(bytes, (byte) => TV_ACCESS_CODE_ALPHABET[byte & 31]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function hashTvAccessCode(code: string): string {
  return createHash("sha256").update(normalizeTvAccessCode(code)).digest("hex");
}

export function isValidTvAccessCode(code: string | null | undefined): code is string {
  if (!code) return false;
  const normalized = normalizeTvAccessCode(code);
  return normalized.length === TV_ACCESS_CODE_LENGTH
    && [...normalized].every((character) => TV_ACCESS_CODE_ALPHABET.includes(character));
}

function createSessionToken(now = Date.now()): string {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!key) throw new Error("TV_DASHBOARD_KEY is not configured");
  const expiresAt = Math.floor(now / 1000) + TV_SESSION_MAX_AGE_SECONDS;
  const payload = `session.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidSessionToken(candidate: string | null | undefined, now = Date.now()): boolean {
  const key = process.env.TV_DASHBOARD_KEY;
  if (!candidate || !key) return false;
  const parts = candidate.split(".");
  if (parts.length !== 4 || parts[0] !== "session") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  return secureTokenEqual(parts[3], expected);
}

export function createTvSessionToken(now = Date.now()): string {
  return createSessionToken(now);
}

export function isValidTvSessionToken(candidate: string | null | undefined, now = Date.now()): boolean {
  return isValidSessionToken(candidate, now);
}
