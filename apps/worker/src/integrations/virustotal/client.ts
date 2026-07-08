/**
 * VirusTotal v3 client — multi-engine reputation for URLs, domains, IPs,
 * and file hashes. Used by Angela for threat verdicts on security tickets.
 *
 * Free tier: 4 requests/minute, 500/day. Callers must cap lookups per
 * ticket; once a 429 is seen, this client stops issuing requests for the
 * rest of the process's current minute window.
 *
 * Accuracy contract: every method returns
 *   - a verdict object when VirusTotal answered,
 *   - { found: false } when VT genuinely does not know the artifact (404),
 *   - null when the LOOKUP FAILED (auth/network/rate limit) — callers must
 *     treat null as "could not check", NEVER as "clean".
 */

const VT_BASE = "https://www.virustotal.com/api/v3";

export interface VtVerdict {
  readonly found: boolean;
  readonly malicious: number;
  readonly suspicious: number;
  readonly harmless: number;
  readonly undetected: number;
  readonly totalEngines: number;
  readonly categories: ReadonlyArray<string>;
}

interface VtAnalysisStats {
  readonly malicious?: number;
  readonly suspicious?: number;
  readonly harmless?: number;
  readonly undetected?: number;
}

interface VtObjectResponse {
  readonly data?: {
    readonly attributes?: {
      readonly last_analysis_stats?: VtAnalysisStats;
      readonly categories?: Record<string, string>;
      readonly popular_threat_classification?: {
        readonly suggested_threat_label?: string;
      };
    };
  };
}

export class VirusTotalClient {
  private readonly apiKey: string;
  private rateLimited = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static fromEnv(): VirusTotalClient | null {
    const key = process.env.VIRUSTOTAL_API_KEY;
    return key ? new VirusTotalClient(key) : null;
  }

  /** URL verdict. VT identifies URLs by unpadded base64url of the raw URL. */
  async checkUrl(url: string): Promise<VtVerdict | null> {
    const id = Buffer.from(url).toString("base64url").replace(/=+$/, "");
    return this.fetchVerdict(`/urls/${id}`);
  }

  async checkDomain(domain: string): Promise<VtVerdict | null> {
    return this.fetchVerdict(`/domains/${encodeURIComponent(domain)}`);
  }

  async checkIp(ip: string): Promise<VtVerdict | null> {
    return this.fetchVerdict(`/ip_addresses/${encodeURIComponent(ip)}`);
  }

  /** File verdict by MD5/SHA-1/SHA-256 hash. */
  async checkFileHash(hash: string): Promise<VtVerdict | null> {
    return this.fetchVerdict(`/files/${encodeURIComponent(hash)}`);
  }

  private async fetchVerdict(path: string): Promise<VtVerdict | null> {
    if (this.rateLimited) return null;

    try {
      const res = await fetch(`${VT_BASE}${path}`, {
        headers: { "x-apikey": this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404) {
        return { found: false, malicious: 0, suspicious: 0, harmless: 0, undetected: 0, totalEngines: 0, categories: [] };
      }
      if (res.status === 429) {
        // Free tier is 4/min — stop hammering for the rest of this pipeline run
        this.rateLimited = true;
        console.warn("[VIRUSTOTAL] Rate limited (429) — skipping remaining lookups this run");
        return null;
      }
      if (!res.ok) {
        console.warn(`[VIRUSTOTAL] ${path} returned ${res.status}`);
        return null;
      }

      const body = (await res.json()) as VtObjectResponse;
      const attrs = body.data?.attributes;
      const stats = attrs?.last_analysis_stats;
      if (!stats) return null;

      const malicious = stats.malicious ?? 0;
      const suspicious = stats.suspicious ?? 0;
      const harmless = stats.harmless ?? 0;
      const undetected = stats.undetected ?? 0;

      const categories: string[] = [];
      const threatLabel = attrs?.popular_threat_classification?.suggested_threat_label;
      if (threatLabel) categories.push(threatLabel);
      for (const cat of new Set(Object.values(attrs?.categories ?? {}))) {
        if (categories.length >= 4) break;
        categories.push(cat);
      }

      return {
        found: true,
        malicious,
        suspicious,
        harmless,
        undetected,
        totalEngines: malicious + suspicious + harmless + undetected,
        categories,
      };
    } catch (error) {
      console.warn(`[VIRUSTOTAL] Lookup failed for ${path}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }
}

/** Extract MD5/SHA-1/SHA-256 hashes from ticket text (bounded, deduped). */
export function extractFileHashes(text: string, limit = 3): ReadonlyArray<string> {
  const matches = text.match(/\b[a-fA-F0-9]{64}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{32}\b/g) ?? [];
  return [...new Set(matches.map((h) => h.toLowerCase()))].slice(0, limit);
}
