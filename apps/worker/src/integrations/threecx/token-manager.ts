/**
 * Process-wide 3CX token manager.
 *
 * 3CX enforces ONE active token per API client: minting a new token
 * IMMEDIATELY invalidates the previous one (verified live 2026-07-09 —
 * token1 → 401 the moment token2 was issued). Any two clients holding
 * their own token cache therefore fight each other to death: the voice
 * listener's websocket drops whenever a cron mints, the cron 401s when
 * the websocket reconnects, forever.
 *
 * Every 3CX consumer in this process MUST get its token here so the
 * whole worker shares a single live token. Mints are single-flight so
 * concurrent 401 recoveries can't stampede and re-trigger the fight.
 */

interface TokenEntry {
  token: string | null;
  expiresAt: number;
  inflight: Promise<string> | null;
}

const entries = new Map<string, TokenEntry>();

function keyOf(baseUrl: string, clientId: string): string {
  return `${baseUrl.replace(/\/$/, "")}::${clientId}`;
}

async function mint(baseUrl: string, clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`3CX token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("3CX token exchange returned no access_token");
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

export async function getThreeCxToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const key = keyOf(baseUrl, clientId);
  let entry = entries.get(key);
  if (!entry) {
    entry = { token: null, expiresAt: 0, inflight: null };
    entries.set(key, entry);
  }

  if (!opts?.forceRefresh && entry.token && Date.now() < entry.expiresAt) {
    return entry.token;
  }

  // Single-flight: piggyback on an in-progress mint instead of racing it
  // (a second mint would instantly invalidate the first)
  if (entry.inflight) return entry.inflight;

  const e = entry;
  e.inflight = (async () => {
    try {
      const { token, expiresIn } = await mint(baseUrl, clientId, clientSecret);
      e.token = token;
      // Refresh 10 minutes early, capped at 50 minutes
      e.expiresAt = Date.now() + Math.min(expiresIn - 600, 3000) * 1000;
      return token;
    } finally {
      e.inflight = null;
    }
  })();
  return e.inflight;
}

/** Call after a 401 — the token was superseded by someone else's mint. */
export function invalidateThreeCxToken(baseUrl: string, clientId: string): void {
  const entry = entries.get(keyOf(baseUrl, clientId));
  if (entry) {
    entry.token = null;
    entry.expiresAt = 0;
  }
}
