import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TwilioConfig } from "@triageit/shared";
import { getCached, setCached } from "../../cache/integration-cache.js";
import { normalizeNorthAmericanPhoneNumber, TwilioClient } from "./client.js";

export interface CnamIdentity {
  readonly name: string;
  readonly type: "BUSINESS" | "CONSUMER" | null;
  readonly source: "twilio_cnam";
}

interface CachedCnamResult {
  readonly status: "found" | "not_found";
  readonly name: string | null;
  readonly type: "BUSINESS" | "CONSUMER" | null;
}

const FOUND_TTL_SECONDS = 30 * 24 * 60 * 60;
const NOT_FOUND_TTL_SECONDS = 7 * 24 * 60 * 60;
const inFlight = new Map<string, Promise<CnamIdentity | null>>();
let configCache: { readonly value: TwilioConfig | null; readonly expiresAt: number } | null = null;

function cacheKey(e164: string): string {
  return createHash("sha256").update(e164).digest("hex");
}

async function getTwilioConfig(supabase: SupabaseClient): Promise<TwilioConfig | null> {
  if (configCache && configCache.expiresAt > Date.now()) return configCache.value;
  const { data, error } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "twilio")
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.warn("[CNAM] Could not read Twilio integration config:", error.message);
    return null;
  }
  const candidate = data?.config as Partial<TwilioConfig> | undefined;
  const value = candidate?.account_sid && candidate.auth_token
    ? candidate as TwilioConfig
    : null;
  configCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function fetchCnamIdentity(
  supabase: SupabaseClient,
  e164: string,
  key: string,
): Promise<CnamIdentity | null> {
  const cached = await getCached<CachedCnamResult>("twilio", "caller-name", key);
  if (cached) {
    return cached.status === "found" && cached.name
      ? { name: cached.name, type: cached.type, source: "twilio_cnam" }
      : null;
  }

  const config = await getTwilioConfig(supabase);
  if (!config) return null;

  try {
    const result = await new TwilioClient(config).lookupCallerName(e164);
    const value: CachedCnamResult = result.callerName
      ? { status: "found", name: result.callerName, type: result.callerType }
      : { status: "not_found", name: null, type: result.callerType };
    await setCached(
      "twilio",
      "caller-name",
      value,
      result.callerName ? FOUND_TTL_SECONDS : NOT_FOUND_TTL_SECONDS,
      key,
    );
    return result.callerName
      ? { name: result.callerName, type: result.callerType, source: "twilio_cnam" }
      : null;
  } catch (error) {
    console.warn(
      `[CNAM] Twilio caller-name lookup failed for phone hash ${key.slice(0, 10)}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Paid CNAM enrichment for numbers Halo cannot identify. Cache keys are
 * hashes so Redis does not receive an additional copy of the phone number.
 */
export async function resolveCnamIdentity(
  supabase: SupabaseClient,
  phoneNumber: string,
): Promise<CnamIdentity | null> {
  const e164 = normalizeNorthAmericanPhoneNumber(phoneNumber);
  if (!e164) return null;
  const key = cacheKey(e164);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = fetchCnamIdentity(supabase, e164, key).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, lookup);
  return lookup;
}
