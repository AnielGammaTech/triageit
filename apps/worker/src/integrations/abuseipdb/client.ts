/**
 * AbuseIPDB v2 client — community abuse reports for IP addresses. Used by
 * Angela to turn "sign-in from 203.0.113.7" into "IP with 400 abuse reports,
 * 98% confidence, hosting-provider ISP".
 *
 * Free tier: 1,000 checks/day.
 *
 * Accuracy contract: returns a report when the API answered, null when the
 * LOOKUP FAILED — callers must treat null as "could not check", never as
 * "clean IP".
 */

const ABUSEIPDB_BASE = "https://api.abuseipdb.com/api/v2";

export interface AbuseIpReport {
  readonly ip: string;
  readonly abuseConfidenceScore: number;
  readonly totalReports: number;
  readonly countryCode: string | null;
  readonly isp: string | null;
  readonly usageType: string | null;
  readonly isTor: boolean;
  readonly lastReportedAt: string | null;
}

interface AbuseIpdbResponse {
  readonly data?: {
    readonly ipAddress?: string;
    readonly abuseConfidenceScore?: number;
    readonly totalReports?: number;
    readonly countryCode?: string;
    readonly isp?: string;
    readonly usageType?: string;
    readonly isTor?: boolean;
    readonly lastReportedAt?: string;
  };
}

export class AbuseIpdbClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static fromEnv(): AbuseIpdbClient | null {
    const key = process.env.ABUSEIPDB_API_KEY;
    return key ? new AbuseIpdbClient(key) : null;
  }

  async checkIp(ip: string): Promise<AbuseIpReport | null> {
    try {
      const url = new URL(`${ABUSEIPDB_BASE}/check`);
      url.searchParams.set("ipAddress", ip);
      url.searchParams.set("maxAgeInDays", "90");

      const res = await fetch(url.toString(), {
        headers: { Key: this.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.warn(`[ABUSEIPDB] check ${ip} returned ${res.status}`);
        return null;
      }

      const body = (await res.json()) as AbuseIpdbResponse;
      const d = body.data;
      if (!d) return null;

      return {
        ip: d.ipAddress ?? ip,
        abuseConfidenceScore: d.abuseConfidenceScore ?? 0,
        totalReports: d.totalReports ?? 0,
        countryCode: d.countryCode ?? null,
        isp: d.isp ?? null,
        usageType: d.usageType ?? null,
        isTor: d.isTor === true,
        lastReportedAt: d.lastReportedAt ?? null,
      };
    } catch (error) {
      console.warn(`[ABUSEIPDB] Lookup failed for ${ip}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }
}
