/**
 * DattoEdrClient — Queries Datto EDR (Infocyte) for endpoint threat data.
 *
 * The API is LoopBack-style: auth via the access_token query parameter and
 * queries via a JSON filter parameter. Alerts carry hostname, severity,
 * MITRE tactic, and targetGroupName (which matches the Halo client name).
 *
 * Used by Angela Martin to correlate what a customer reports against
 * actual EDR detections on their machines.
 */

export interface DattoEdrConfig {
  readonly api_url: string;
  readonly api_key: string;
}

export interface EdrAlert {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly severity?: string;
  readonly mitreId?: string;
  readonly mitreTactic?: string;
  readonly hostname?: string;
  readonly ip?: string;
  readonly createdOn?: string;
  readonly targetGroupName?: string;
  readonly organizationName?: string;
  readonly rmmSiteId?: string;
  readonly archived?: boolean;
  readonly [key: string]: unknown;
}

export interface EdrTarget {
  readonly id: string;
  readonly name: string;
  readonly agentCount?: number;
  readonly activeAgentCount?: number;
  readonly alertCount?: number;
  readonly lastScannedOn?: string;
  readonly [key: string]: unknown;
}

const ALERT_FIELDS = [
  "id",
  "name",
  "description",
  "severity",
  "mitreId",
  "mitreTactic",
  "hostname",
  "ip",
  "createdOn",
  "targetGroupName",
  "rmmSiteId",
  "archived",
] as const;

export class DattoEdrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: DattoEdrConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
    this.apiKey = config.api_key;
  }

  private async request<T>(path: string, filter?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("access_token", this.apiKey);
    if (filter) url.searchParams.set("filter", JSON.stringify(filter));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Datto EDR ${path} failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new Error(`Datto EDR ${path} returned non-JSON response (${contentType})`);
    }

    return (await response.json()) as T;
  }

  /**
   * Target groups are the EDR's customer list — names match Halo clients.
   */
  async getTargets(): Promise<ReadonlyArray<EdrTarget>> {
    return this.request<EdrTarget[]>("/api/targets", {
      fields: ["id", "name", "agentCount", "activeAgentCount", "alertCount", "lastScannedOn"],
      where: { deleted: { neq: true } },
      order: "name ASC",
      limit: 500,
    });
  }

  /**
   * Recent unarchived alerts for a client and/or specific hostnames.
   * Hostname matching is case-insensitive (EDR stores mixed case).
   */
  async getRecentAlerts(params: {
    readonly clientName?: string | null;
    readonly hostnames?: ReadonlyArray<string>;
    readonly days?: number;
    readonly limit?: number;
  }): Promise<ReadonlyArray<EdrAlert>> {
    const since = new Date(Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000).toISOString();

    const or: Array<Record<string, unknown>> = [];
    if (params.clientName) {
      // LoopBack regexp match, case-insensitive — client names differ in
      // case/punctuation between Halo and EDR
      or.push({ targetGroupName: { regexp: `/${escapeRegex(params.clientName)}/i` } });
    }
    for (const hostname of params.hostnames ?? []) {
      if (hostname.length >= 4) {
        or.push({ hostname: { regexp: `/^${escapeRegex(hostname)}$/i` } });
      }
    }
    if (or.length === 0) return [];

    const alerts = await this.request<EdrAlert[]>("/api/alerts", {
      where: {
        and: [
          { archived: { neq: true } },
          { createdOn: { gte: since } },
          { or },
        ],
      },
      fields: [...ALERT_FIELDS],
      order: "createdOn DESC",
      limit: params.limit ?? 50,
    });

    return alerts;
  }

  /**
   * Cheap connectivity check for the integration heartbeat.
   */
  async checkHealth(): Promise<{ readonly organizations: number }> {
    const orgs = await this.request<Array<{ id: string }>>("/api/organizations", {
      fields: ["id"],
      limit: 5,
    });
    return { organizations: orgs.length };
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Collapse duplicate detections (same rule + host) into one entry with a
 * count, keeping the newest — EDR fires the same rule repeatedly and the
 * raw feed would drown the useful signal.
 */
export function dedupeAlerts(alerts: ReadonlyArray<EdrAlert>): ReadonlyArray<EdrAlert & { readonly occurrences: number }> {
  const groups = new Map<string, { alert: EdrAlert; count: number }>();
  for (const alert of alerts) {
    const key = `${alert.hostname ?? ""}|${alert.description ?? alert.name ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { alert: existing.alert, count: existing.count + 1 });
    } else {
      groups.set(key, { alert, count: 1 });
    }
  }
  return [...groups.values()].map(({ alert, count }) => ({ ...alert, occurrences: count }));
}
