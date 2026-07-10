import { LOGIN_BASE_URL } from "./constants.js";

export interface MsGraphCredentials {
  readonly tenant_id: string;
  readonly client_id: string;
  readonly client_secret: string;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/** Anything fetch-shaped — lets callers inject timeouts or test fakes. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Client-credentials token for the provisioned TriageIT Calendar app.
 * Throws with the AAD error code so callers can distinguish propagation
 * delays (invalid_client right after addPassword) from real failures.
 */
export async function requestClientCredentialsToken(
  credentials: MsGraphCredentials,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const response = await fetchFn(
    `${LOGIN_BASE_URL}/${encodeURIComponent(credentials.tenant_id)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    const code = payload.error ?? `HTTP ${response.status}`;
    const detail = payload.error_description?.split("\n")[0] ?? "token request failed";
    throw new Error(`msgraph token error (${code}): ${detail}`);
  }
  return payload.access_token;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract a claim from a JWT without verifying it — we only read claims
 *  from tokens Microsoft just handed us over TLS. */
export function decodeJwtClaim(token: string, claim: string): string | null {
  const value = decodeJwtPayload(token)?.[claim];
  return typeof value === "string" ? value : null;
}

/** Array claim (e.g. `roles` on an app token). Empty array when absent. */
export function decodeJwtClaimArray(token: string, claim: string): ReadonlyArray<string> {
  const value = decodeJwtPayload(token)?.[claim];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
