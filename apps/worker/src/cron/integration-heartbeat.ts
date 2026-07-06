import type { HealthStatus } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { DattoClient } from "../integrations/datto/client.js";
import { DattoEdrClient } from "../integrations/datto-edr/client.js";
import { HuduClient } from "../integrations/hudu/client.js";
import { JumpCloudClient } from "../integrations/jumpcloud/client.js";
import { Pax8Client } from "../integrations/pax8/client.js";
import { UnifiClient } from "../integrations/unifi/client.js";

interface IntegrationRow {
  readonly id: string;
  readonly service: string;
  readonly display_name: string;
  readonly config: Record<string, unknown> | null;
  readonly health_status?: HealthStatus | null;
  readonly last_health_check?: string | null;
  readonly is_active: boolean;
}

interface HeartbeatMeta {
  readonly checked_at: string;
  readonly message: string;
  readonly latency_ms: number | null;
  readonly consecutive_failures: number;
}

export interface IntegrationHeartbeatResult {
  readonly service: string;
  readonly display_name: string;
  readonly status: HealthStatus;
  readonly message: string;
  readonly latency_ms: number | null;
}

export interface IntegrationHeartbeatSummary {
  readonly checked: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly down: number;
  readonly unknown: number;
  readonly results: ReadonlyArray<IntegrationHeartbeatResult>;
}

interface CheckResult {
  readonly status: HealthStatus;
  readonly message: string;
}

type Checker = (config: Record<string, unknown>) => Promise<CheckResult>;

const REQUEST_TIMEOUT_MS = 10_000;

function text(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function required(config: Record<string, unknown>, keys: ReadonlyArray<string>): string | null {
  const missing = keys.filter((key) => !text(config, key));
  return missing.length > 0 ? `Missing required field(s): ${missing.join(", ")}` : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function statusFromResponse(service: string, response: Response, okMessage: string): CheckResult {
  if (response.ok) {
    return { status: "healthy", message: okMessage };
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return {
    status: retryable ? "degraded" : "down",
    message: `${service} returned HTTP ${response.status}`,
  };
}

function genericConfigured(service: string): CheckResult {
  return {
    status: "degraded",
    message: `${service} is active, but no safe lightweight heartbeat check is implemented yet.`,
  };
}

async function checkHalo(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["base_url", "client_id", "client_secret"]);
  if (missing) return { status: "down", message: missing };

  const baseUrl = normalizeBaseUrl(text(config, "base_url"));
  const tenant = text(config, "tenant");
  const tokenUrl = tenant ? `${baseUrl}/auth/token?tenant=${encodeURIComponent(tenant)}` : `${baseUrl}/auth/token`;
  const response = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: text(config, "client_id"),
      client_secret: text(config, "client_secret"),
      scope: "all",
    }),
  });
  return statusFromResponse("Halo PSA", response, "Halo auth token issued.");
}

async function checkHudu(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["base_url", "api_key"]);
  if (missing) return { status: "down", message: missing };

  const hudu = new HuduClient({
    base_url: normalizeBaseUrl(text(config, "base_url")),
    api_key: text(config, "api_key"),
  });
  await hudu.getCompanies();
  return { status: "healthy", message: "Hudu companies endpoint returned data." };
}

async function checkDatto(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["api_url", "api_key", "api_secret"]);
  if (missing) return { status: "down", message: missing };

  const datto = new DattoClient({
    api_url: text(config, "api_url"),
    api_key: text(config, "api_key"),
    api_secret: text(config, "api_secret"),
  });
  const sites = await datto.getSites();
  return {
    status: "healthy",
    message: `Datto authenticated and returned ${sites.length} site${sites.length === 1 ? "" : "s"}.`,
  };
}

async function checkJumpCloud(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["api_key", "provider_id"]);
  if (missing) return { status: "down", message: missing };

  const jumpCloud = new JumpCloudClient({
    api_key: text(config, "api_key"),
    provider_id: text(config, "provider_id"),
  });
  const organizations = await jumpCloud.getOrganizations();
  return {
    status: "healthy",
    message: `JumpCloud returned ${organizations.length} organization${organizations.length === 1 ? "" : "s"}.`,
  };
}

async function checkPax8(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["client_id", "client_secret"]);
  if (missing) return { status: "down", message: missing };

  const pax8 = new Pax8Client({
    client_id: text(config, "client_id"),
    client_secret: text(config, "client_secret"),
  });
  const companies = await pax8.getCompanies();
  return {
    status: "healthy",
    message: `Pax8 returned ${companies.length} compan${companies.length === 1 ? "y" : "ies"}.`,
  };
}

async function checkUnifi(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["api_key"]);
  if (missing) return { status: "down", message: missing };

  const unifi = new UnifiClient({ api_key: text(config, "api_key") });
  const hosts = await unifi.getHosts();
  return {
    status: "healthy",
    message: `UniFi returned ${hosts.length} host${hosts.length === 1 ? "" : "s"}.`,
  };
}

async function checkVultr(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["api_key"]);
  if (missing) return { status: "down", message: missing };

  const response = await fetchWithTimeout("https://api.vultr.com/v2/account", {
    headers: {
      Authorization: `Bearer ${text(config, "api_key")}`,
      Accept: "application/json",
    },
  });
  return statusFromResponse("Vultr", response, "Vultr account endpoint returned data.");
}

async function checkTwilio(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["account_sid", "auth_token"]);
  if (missing) return { status: "down", message: missing };

  const accountSid = text(config, "account_sid");
  const credentials = Buffer.from(`${accountSid}:${text(config, "auth_token")}`).toString("base64");
  const response = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });
  return statusFromResponse("Twilio", response, "Twilio account endpoint returned data.");
}

async function checkAiProvider(config: Record<string, unknown>): Promise<CheckResult> {
  const checks: string[] = [];
  const failures: string[] = [];

  const claudeKey = text(config, "claude_api_key");
  if (claudeKey) {
    checks.push("Claude");
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
    });
    if (!response.ok) failures.push(`Claude HTTP ${response.status}`);
  }

  const openaiKey = text(config, "openai_api_key");
  if (openaiKey) {
    checks.push("OpenAI");
    const response = await fetchWithTimeout("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) failures.push(`OpenAI HTTP ${response.status}`);
  }

  const moonshotKey = text(config, "moonshot_api_key");
  if (moonshotKey) {
    checks.push("Moonshot");
    const response = await fetchWithTimeout("https://api.moonshot.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${moonshotKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) failures.push(`Moonshot HTTP ${response.status}`);
  }

  if (checks.length === 0) {
    return { status: "down", message: "No AI provider API key is configured." };
  }
  if (failures.length === 0) {
    return { status: "healthy", message: `${checks.join(", ")} model endpoint${checks.length === 1 ? "" : "s"} reachable.` };
  }
  if (failures.length < checks.length) {
    return { status: "degraded", message: `Some AI providers failed: ${failures.join("; ")}` };
  }
  return { status: "down", message: failures.join("; ") };
}

async function checkCipp(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, [
    "cippApiUrl",
    "cippAuthScope",
    "cippAuthClientId",
    "cippAuthTokenUrl",
    "cippAuthClientSecret",
  ]);
  if (missing) return { status: "down", message: missing };

  const response = await fetchWithTimeout(text(config, "cippAuthTokenUrl"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: text(config, "cippAuthClientId"),
      client_secret: text(config, "cippAuthClientSecret"),
      scope: text(config, "cippAuthScope"),
      grant_type: "client_credentials",
    }),
  });
  return statusFromResponse("CIPP auth", response, "CIPP Azure auth token issued.");
}

async function checkTeams(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["webhook_url"]);
  if (missing) return { status: "down", message: missing };
  try {
    new URL(text(config, "webhook_url"));
  } catch {
    return { status: "down", message: "Teams webhook URL is not a valid URL." };
  }
  return {
    status: "healthy",
    message: "Webhook URL is configured. Delivery is not probed to avoid posting heartbeat noise into the channel.",
  };
}

async function checkDattoEdr(config: Record<string, unknown>): Promise<CheckResult> {
  const missing = required(config, ["api_url", "api_key"]);
  if (missing) return { status: "down", message: missing };

  const edr = new DattoEdrClient({
    api_url: text(config, "api_url"),
    api_key: text(config, "api_key"),
  });
  const health = await edr.checkHealth();
  return {
    status: "healthy",
    message: `Datto EDR authenticated (${health.organizations} organization${health.organizations === 1 ? "" : "s"}).`,
  };
}

const CHECKERS: Record<string, Checker> = {
  "ai-provider": checkAiProvider,
  cipp: checkCipp,
  datto: checkDatto,
  "datto-edr": checkDattoEdr,
  halo: checkHalo,
  hudu: checkHudu,
  jumpcloud: checkJumpCloud,
  pax8: checkPax8,
  teams: checkTeams,
  twilio: checkTwilio,
  unifi: checkUnifi,
  vultr: checkVultr,
};

function previousFailureCount(config: Record<string, unknown> | null): number {
  const heartbeat = config?.__heartbeat;
  if (!heartbeat || typeof heartbeat !== "object") return 0;
  const count = (heartbeat as Record<string, unknown>).consecutive_failures;
  return typeof count === "number" ? count : 0;
}

async function checkIntegration(row: IntegrationRow): Promise<IntegrationHeartbeatResult> {
  const startedAt = Date.now();
  const checker = CHECKERS[row.service];
  const config = row.config ?? {};

  try {
    const result = checker
      ? await checker(config)
      : genericConfigured(row.display_name || row.service);
    return {
      service: row.service,
      display_name: row.display_name,
      status: result.status,
      message: result.message,
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|network|fetch failed|5\d\d|429/i.test(message);
    return {
      service: row.service,
      display_name: row.display_name,
      status: retryable ? "degraded" : "down",
      message: message.slice(0, 500),
      latency_ms: Date.now() - startedAt,
    };
  }
}

async function persistResult(row: IntegrationRow, result: IntegrationHeartbeatResult): Promise<void> {
  const supabase = createSupabaseClient();
  const checkedAt = new Date().toISOString();
  const failures = result.status === "healthy" ? 0 : previousFailureCount(row.config) + 1;
  const nextConfig = {
    ...(row.config ?? {}),
    __heartbeat: {
      checked_at: checkedAt,
      message: result.message,
      latency_ms: result.latency_ms,
      consecutive_failures: failures,
    } satisfies HeartbeatMeta,
  };

  await supabase
    .from("integrations")
    .update({
      health_status: result.status,
      last_health_check: checkedAt,
      config: nextConfig,
      updated_at: checkedAt,
    })
    .eq("id", row.id);
}

export async function runIntegrationHeartbeat(options?: {
  readonly services?: ReadonlyArray<string>;
}): Promise<IntegrationHeartbeatSummary> {
  const supabase = createSupabaseClient();
  let query = supabase
    .from("integrations")
    .select("id, service, display_name, config, health_status, last_health_check, is_active")
    .eq("is_active", true);

  if (options?.services && options.services.length > 0) {
    query = query.in("service", [...options.services]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load integrations for heartbeat: ${error.message}`);

  const rows = (data ?? []) as IntegrationRow[];
  const results: IntegrationHeartbeatResult[] = [];

  for (const row of rows) {
    const result = await checkIntegration(row);
    results.push(result);
    await persistResult(row, result);
  }

  return {
    checked: results.length,
    healthy: results.filter((r) => r.status === "healthy").length,
    degraded: results.filter((r) => r.status === "degraded").length,
    down: results.filter((r) => r.status === "down").length,
    unknown: results.filter((r) => r.status === "unknown").length,
    results,
  };
}
