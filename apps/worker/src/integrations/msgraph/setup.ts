import { randomUUID } from "node:crypto";
import { createSupabaseClient } from "../../db/supabase.js";
import { decodeJwtClaim } from "./auth.js";
import {
  DEVICE_CODE_CLIENT_ID,
  LOGIN_BASE_URL,
  SETUP_SCOPES,
} from "./constants.js";
import { provisionGraphApp } from "./provision.js";
import type { ProvisionStepKey, ProvisionStepStatus } from "./provision.js";

export type SetupStepStatus = "pending" | "active" | "done" | "error";

export interface MsGraphSetupStep {
  readonly key: string;
  readonly label: string;
  readonly status: SetupStepStatus;
  readonly detail?: string;
}

export type MsGraphSetupState = "awaiting_signin" | "provisioning" | "done" | "error";

export interface MsGraphSetupView {
  readonly id: string;
  readonly status: MsGraphSetupState;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_at: string;
  readonly steps: ReadonlyArray<MsGraphSetupStep>;
  readonly error?: string;
}

const STEP_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: "signin", label: "Admin signs in with the device code" },
  { key: "create_app", label: "Create the TriageIT Calendar app registration" },
  { key: "add_secret", label: "Issue a client secret (24 months)" },
  { key: "service_principal", label: "Create the service principal" },
  { key: "admin_consent", label: "Grant admin consent for Calendars.ReadWrite" },
  { key: "verify", label: "Verify the app can sign in and reach Graph" },
  { key: "save", label: "Save the integration in TriageIT" },
];

interface DeviceCodeResponse {
  readonly device_code?: string;
  readonly user_code?: string;
  readonly verification_uri?: string;
  readonly expires_in?: number;
  readonly interval?: number;
  readonly error?: string;
  readonly error_description?: string;
}

interface DeviceTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

const sessions = new Map<string, MsGraphSetupView>();

/** Sessions linger 30 minutes after they stop mattering so the UI can
 *  finish rendering the outcome, then get swept on the next access. */
const SESSION_RETENTION_MS = 30 * 60 * 1000;
const sessionExpiry = new Map<string, number>();

function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const [id, expiresAt] of sessionExpiry) {
    if (expiresAt < now) {
      sessions.delete(id);
      sessionExpiry.delete(id);
    }
  }
}

function updateSession(id: string, patch: Partial<MsGraphSetupView>): void {
  const current = sessions.get(id);
  if (!current) return;
  sessions.set(id, { ...current, ...patch });
}

function updateStep(
  id: string,
  key: string,
  status: SetupStepStatus,
  detail?: string,
): void {
  const current = sessions.get(id);
  if (!current) return;
  const steps = current.steps.map((step) =>
    step.key === key ? { ...step, status, ...(detail ? { detail } : {}) } : step,
  );
  sessions.set(id, { ...current, steps });
}

function failSession(id: string, message: string): void {
  const current = sessions.get(id);
  if (!current) return;
  const steps = current.steps.map((step) =>
    step.status === "active" ? { ...step, status: "error" as const, detail: message } : step,
  );
  sessions.set(id, { ...current, status: "error", error: message, steps });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function pollForDeviceToken(
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  fetchFn: typeof fetch,
): Promise<string> {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let waitMs = Math.max(intervalSeconds, 1) * 1000;

  while (Date.now() < deadline) {
    await sleep(waitMs);
    const response = await fetchFn(
      `${LOGIN_BASE_URL}/organizations/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: DEVICE_CODE_CLIENT_ID,
          device_code: deviceCode,
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as DeviceTokenResponse;

    if (payload.access_token) return payload.access_token;
    if (payload.error === "authorization_pending") continue;
    if (payload.error === "slow_down") {
      waitMs += 5_000;
      continue;
    }
    const detail = payload.error_description?.split("\n")[0] ?? payload.error ?? "unknown error";
    throw new Error(
      payload.error === "authorization_declined"
        ? "Sign-in was declined in the Microsoft prompt"
        : payload.error === "expired_token"
          ? "The device code expired before sign-in completed"
          : `Device sign-in failed: ${detail}`,
    );
  }
  throw new Error("The device code expired before sign-in completed");
}

async function saveIntegrationRow(config: Record<string, string>): Promise<void> {
  const supabase = createSupabaseClient();
  const { data: existing } = await supabase
    .from("integrations")
    .select("id, config")
    .eq("service", "msgraph")
    .maybeSingle();

  const mergedConfig = {
    ...((existing?.config as Record<string, unknown> | null) ?? {}),
    ...config,
  };
  const payload = {
    service: "msgraph",
    display_name: "Microsoft 365 Calendar",
    config: mergedConfig,
    is_active: true,
    health_status: "healthy" as const,
    updated_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase.from("integrations").update(payload).eq("id", existing.id)
    : await supabase.from("integrations").insert(payload);
  if (error) throw new Error(`Could not save the integration: ${error.message}`);
}

async function runSetupFlow(
  sessionId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  fetchFn: typeof fetch,
): Promise<void> {
  const delegatedToken = await pollForDeviceToken(
    deviceCode,
    intervalSeconds,
    expiresInSeconds,
    fetchFn,
  );

  const tenantId = decodeJwtClaim(delegatedToken, "tid");
  if (!tenantId) throw new Error("Could not read the tenant id from the sign-in token");

  updateStep(sessionId, "signin", "done", "Signed in");
  updateSession(sessionId, { status: "provisioning" });

  const provisioned = await provisionGraphApp(delegatedToken, tenantId, {
    fetchFn,
    onStep: (key: ProvisionStepKey, status: ProvisionStepStatus, detail?: string) =>
      updateStep(sessionId, key, status, detail),
  });

  updateStep(sessionId, "save", "active");
  await saveIntegrationRow({ ...provisioned });
  updateStep(sessionId, "save", "done", "Integration saved and activated");
  updateSession(sessionId, { status: "done" });
}

/**
 * Start the one-button Microsoft 365 setup: request a device code, return it
 * for the UI to display, and continue sign-in + provisioning in the
 * background. Progress is exposed via getMsGraphSetupStatus.
 */
export async function startMsGraphSetup(
  fetchFn: typeof fetch = fetch,
): Promise<MsGraphSetupView> {
  sweepExpiredSessions();

  const response = await fetchFn(
    `${LOGIN_BASE_URL}/organizations/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DEVICE_CODE_CLIENT_ID,
        scope: SETUP_SCOPES,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as DeviceCodeResponse;
  if (!response.ok || !payload.device_code || !payload.user_code) {
    const detail = payload.error_description?.split("\n")[0] ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`Could not start Microsoft sign-in: ${detail}`);
  }

  const expiresIn = payload.expires_in ?? 900;
  const id = randomUUID();
  const session: MsGraphSetupView = {
    id,
    status: "awaiting_signin",
    user_code: payload.user_code,
    verification_uri: payload.verification_uri ?? "https://microsoft.com/devicelogin",
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    steps: STEP_ORDER.map((step, index) => ({
      ...step,
      status: index === 0 ? ("active" as const) : ("pending" as const),
    })),
  };
  sessions.set(id, session);
  sessionExpiry.set(id, Date.now() + expiresIn * 1000 + SESSION_RETENTION_MS);

  void runSetupFlow(id, payload.device_code, payload.interval ?? 5, expiresIn, fetchFn).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      failSession(id, message);
    },
  );

  return session;
}

export function getMsGraphSetupStatus(id: string): MsGraphSetupView | null {
  sweepExpiredSessions();
  return sessions.get(id) ?? null;
}
