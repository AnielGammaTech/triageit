import {
  CALENDARS_READWRITE_ROLE_ID,
  GRAPH_BASE_URL,
  GRAPH_RESOURCE_APP_ID,
  PROVISIONED_APP_DISPLAY_NAME,
  SECRET_LIFETIME_MONTHS,
} from "./constants.js";
import { decodeJwtClaimArray, requestClientCredentialsToken } from "./auth.js";

export type ProvisionStepKey =
  | "create_app"
  | "add_secret"
  | "service_principal"
  | "admin_consent"
  | "verify";

export type ProvisionStepStatus = "active" | "done" | "error";

export interface ProvisionDeps {
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onStep?: (
    key: ProvisionStepKey,
    status: ProvisionStepStatus,
    detail?: string,
  ) => void;
}

export interface ProvisionedApp {
  readonly tenant_id: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly app_object_id: string;
  readonly consented_at: string;
}

/** Consent/secret propagation can lag — retry the verify token for ≤60s. */
const VERIFY_ATTEMPTS = 12;
const VERIFY_RETRY_MS = 5_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function graphRequest<T>(
  fetchFn: typeof fetch,
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetchFn(`${GRAPH_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = payload?.error?.code ?? `HTTP ${response.status}`;
    const message = payload?.error?.message ?? "Graph request failed";
    throw new Error(`${method} ${path} failed (${code}): ${message}`);
  }
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

/**
 * Provision the "TriageIT Calendar" app in the customer tenant using the
 * admin's delegated token: app registration → client secret → service
 * principal → programmatic admin consent → verified client-credentials login.
 * The delegated token is used only inside this call and never persisted.
 */
export async function provisionGraphApp(
  delegatedToken: string,
  tenantId: string,
  deps: ProvisionDeps = {},
): Promise<ProvisionedApp> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const onStep = deps.onStep ?? (() => undefined);

  const step = async <T>(
    key: ProvisionStepKey,
    run: () => Promise<T>,
    doneDetail: (result: T) => string,
  ): Promise<T> => {
    onStep(key, "active");
    try {
      const result = await run();
      onStep(key, "done", doneDetail(result));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onStep(key, "error", message);
      throw err;
    }
  };

  const app = await step(
    "create_app",
    async () => {
      // Idempotent: a failed earlier run may have already created the app —
      // reuse it instead of piling up duplicate registrations.
      const existing = await graphRequest<{ value: ReadonlyArray<{ id: string; appId: string }> }>(
        fetchFn,
        delegatedToken,
        "GET",
        `/applications?$filter=displayName eq '${PROVISIONED_APP_DISPLAY_NAME}'&$select=id,appId`,
      );
      const found = existing.value[0];
      if (found) return { ...found, reused: true };
      const created = await graphRequest<{ id: string; appId: string }>(
        fetchFn,
        delegatedToken,
        "POST",
        "/applications",
        {
          displayName: PROVISIONED_APP_DISPLAY_NAME,
          signInAudience: "AzureADMyOrg",
          requiredResourceAccess: [
            {
              resourceAppId: GRAPH_RESOURCE_APP_ID,
              resourceAccess: [
                { id: CALENDARS_READWRITE_ROLE_ID, type: "Role" },
              ],
            },
          ],
        },
      );
      return { ...created, reused: false };
    },
    (result) =>
      result.reused
        ? `Reusing the existing app registration (client id ${result.appId})`
        : `App registration created (client id ${result.appId})`,
  );

  const secretEnd = new Date();
  secretEnd.setMonth(secretEnd.getMonth() + SECRET_LIFETIME_MONTHS);
  const secret = await step(
    "add_secret",
    () =>
      graphRequest<{ secretText: string }>(
        fetchFn,
        delegatedToken,
        "POST",
        `/applications/${app.id}/addPassword`,
        {
          passwordCredential: {
            displayName: "TriageIT worker",
            endDateTime: secretEnd.toISOString(),
          },
        },
      ),
    () => `Client secret issued (expires ${secretEnd.toISOString().slice(0, 10)})`,
  );

  const servicePrincipal = await step(
    "service_principal",
    async () => {
      try {
        return await graphRequest<{ id: string }>(fetchFn, delegatedToken, "POST", "/servicePrincipals", {
          appId: app.appId,
        });
      } catch (createError) {
        // Reused app → the SP likely already exists; find it before failing.
        const existing = await graphRequest<{ value: ReadonlyArray<{ id: string }> }>(
          fetchFn,
          delegatedToken,
          "GET",
          `/servicePrincipals?$filter=appId eq '${app.appId}'&$select=id`,
        );
        const sp = existing.value[0];
        if (sp) return sp;
        throw createError;
      }
    },
    () => "Service principal ready in your tenant",
  );

  await step(
    "admin_consent",
    async () => {
      const graphSp = await graphRequest<{ value: ReadonlyArray<{ id: string }> }>(
        fetchFn,
        delegatedToken,
        "GET",
        `/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id`,
      );
      const graphSpId = graphSp.value[0]?.id;
      if (!graphSpId) {
        throw new Error("Microsoft Graph service principal not found in tenant");
      }
      try {
        return await graphRequest(
          fetchFn,
          delegatedToken,
          "POST",
          `/servicePrincipals/${graphSpId}/appRoleAssignedTo`,
          {
            principalId: servicePrincipal.id,
            resourceId: graphSpId,
            appRoleId: CALENDARS_READWRITE_ROLE_ID,
          },
        );
      } catch (assignError) {
        // Consent from an earlier run is still valid — Graph reports the
        // duplicate assignment as an error, but for us it means "done".
        const message = assignError instanceof Error ? assignError.message : String(assignError);
        if (/already exists/i.test(message)) return { alreadyGranted: true };
        throw assignError;
      }
    },
    () => "Admin consent granted for Calendars.ReadWrite",
  );

  const credentials = {
    tenant_id: tenantId,
    client_id: app.appId,
    client_secret: secret.secretText,
  };

  await step(
    "verify",
    async () => {
      // Calendars.ReadWrite is the app's ONLY permission — a directory read
      // like GET /users is correctly denied, so it can't be the probe
      // (that's exactly how the first live run failed, 2026-07-10). The
      // token's `roles` claim proves both the secret AND the consent: the
      // role only appears once the appRoleAssignment is effective.
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
        try {
          const appToken = await requestClientCredentialsToken(credentials, fetchFn);
          const roles = decodeJwtClaimArray(appToken, "roles");
          if (roles.includes("Calendars.ReadWrite")) return true;
          lastError = new Error("Token issued, but Calendars.ReadWrite is not in its roles yet");
        } catch (err) {
          lastError = err;
        }
        // New secrets and fresh consent can take up to a minute to
        // propagate across AAD — keep retrying until the budget runs out.
        if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_RETRY_MS);
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`App sign-in never succeeded after provisioning: ${message}`);
    },
    () => "Verified: the app signs in and its token carries Calendars.ReadWrite",
  );

  return {
    ...credentials,
    app_object_id: app.id,
    consented_at: new Date().toISOString(),
  };
}
