import type { HaloConfig } from "@triageit/shared";

interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

let tokenCache: CachedToken | null = null;

export async function getHaloToken(config: HaloConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const authInfoUrl = `${config.base_url}/api/authinfo`;
  let tokenUrl: string;

  try {
    const authInfoRes = await fetch(authInfoUrl);
    const authInfo = (await authInfoRes.json()) as {
      token_endpoint?: string;
    };
    tokenUrl = authInfo.token_endpoint ?? `${config.base_url}/auth/token`;
  } catch {
    tokenUrl = `${config.base_url}/auth/token`;
  }

  if (config.tenant) {
    const separator = tokenUrl.includes("?") ? "&" : "?";
    tokenUrl = `${tokenUrl}${separator}tenant=${config.tenant}`;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Halo auth failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

export function clearTokenCache(): void {
  tokenCache = null;
}
