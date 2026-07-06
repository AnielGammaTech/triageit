/**
 * ApiNinjasClient — utility lookups from api-ninjas.com.
 *
 * Key comes from the API_NINJAS_KEY env var (set on the worker). Free
 * tier locks most field values behind "premium subscribers only" — the
 * helpers below filter those markers out so agents only see real data.
 */

const BASE = "https://api.api-ninjas.com/v1";
const LOCKED = "premium subscribers only";

export class ApiNinjasClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static fromEnv(): ApiNinjasClient | null {
    const key = process.env.API_NINJAS_KEY;
    return key ? new ApiNinjasClient(key) : null;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const response = await fetch(url.toString(), {
        headers: { "X-Api-Key": this.apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.warn(`[API-NINJAS] ${path} failed (${response.status})`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      console.warn(`[API-NINJAS] ${path} errored:`, error);
      return null;
    }
  }

  /** Strip premium-locked placeholder values so agents see only real data. */
  private static clean(record: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (typeof v === "string" && v.toLowerCase().includes(LOCKED)) continue;
      out[k] = v;
    }
    return out;
  }

  /** Geo/ISP context for an IP found in a ticket (sign-in locations, attackers). */
  async ipLookup(address: string): Promise<Record<string, unknown> | null> {
    const data = await this.request<Record<string, unknown>>("/iplookup", { address });
    if (!data || data.is_valid === false) return null;
    const cleaned = ApiNinjasClient.clean(data);
    return Object.keys(cleaned).length > 2 ? cleaned : null;
  }

  /** Threat/categorization data for a URL (phishing links in tickets). */
  async urlLookup(url: string): Promise<Record<string, unknown> | null> {
    const data = await this.request<Record<string, unknown>>("/urllookup", { url });
    return data ? ApiNinjasClient.clean(data) : null;
  }

  /** DNS records (premium unlocks values; free tier .com only). */
  async dnsLookup(domain: string): Promise<ReadonlyArray<Record<string, unknown>>> {
    const data = await this.request<Array<Record<string, unknown>>>("/dnslookup", { domain });
    if (!Array.isArray(data)) return [];
    return data.map(ApiNinjasClient.clean).filter((r) => r.value !== undefined);
  }

  async whois(domain: string): Promise<Record<string, unknown> | null> {
    const data = await this.request<Record<string, unknown>>("/whois", { domain });
    return data ? ApiNinjasClient.clean(data) : null;
  }
}

/** Public IPv4 addresses in free text — skips RFC1918 ranges. */
export function extractPublicIps(text: string): string[] {
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  const unique = [...new Set(matches)];
  return unique.filter((ip) => {
    const parts = ip.split(".").map(Number);
    if (parts.some((n) => n > 255)) return false;
    if (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168)) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    return true;
  }).slice(0, 3);
}

/** http(s) URLs in free text (deduped, capped). */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(matches)].slice(0, 3);
}

/** Bare domains from emails/URLs in text, excluding the client's own domain. */
export function extractForeignDomains(text: string, ownDomains: ReadonlyArray<string>): string[] {
  const own = new Set(ownDomains.map((d) => d.toLowerCase()));
  const found = new Set<string>();
  for (const m of text.match(/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi) ?? []) {
    const domain = m.toLowerCase().replace(/^www\./, "");
    // Keep registrable-looking domains only, skip client + common infra noise
    if (own.has(domain)) continue;
    if (/(microsoft|office|outlook|google|gamma)\.(com|net|tech)$/.test(domain)) continue;
    if (domain.split(".").length >= 2 && domain.length <= 60) found.add(domain);
  }
  return [...found].slice(0, 3);
}
