import type { VultrConfig } from "@triageit/shared";

/**
 * VultrClient — Queries Vultr for cloud infrastructure data.
 *
 * Used by Stanley Hudson to pull real instance status, bandwidth,
 * DNS records, firewall rules, and backup information.
 */
export class VultrClient {
  private static readonly BASE_URL = "https://api.vultr.com/v2";
  private readonly apiKey: string;

  constructor(config: VultrConfig) {
    this.apiKey = config.api_key;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${VultrClient.BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Vultr API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── Instances ─────────────────────────────────────────────────────

  async getInstances(): Promise<ReadonlyArray<VultrInstance>> {
    const result = await this.request<{ instances: VultrInstance[] }>(
      "/instances",
      { per_page: "100" },
    );
    return result.instances ?? [];
  }

  async getInstance(instanceId: string): Promise<VultrInstance> {
    const result = await this.request<{ instance: VultrInstance }>(
      `/instances/${instanceId}`,
    );
    return result.instance;
  }

  async searchInstances(
    query: string,
  ): Promise<ReadonlyArray<VultrInstance>> {
    const instances = await this.getInstances();
    const lower = query.toLowerCase();
    return instances.filter(
      (i) =>
        i.label?.toLowerCase().includes(lower) ||
        i.hostname?.toLowerCase().includes(lower) ||
        i.main_ip?.includes(query) ||
        i.internal_ip?.includes(query),
    );
  }

  // ── Instance Bandwidth ────────────────────────────────────────────

  async getInstanceBandwidth(
    instanceId: string,
  ): Promise<VultrBandwidth | null> {
    try {
      const result = await this.request<{ bandwidth: VultrBandwidth }>(
        `/instances/${instanceId}/bandwidth`,
      );
      return result.bandwidth ?? null;
    } catch {
      return null;
    }
  }

  // ── DNS Domains ───────────────────────────────────────────────────

  async getDomains(): Promise<ReadonlyArray<VultrDomain>> {
    const result = await this.request<{ domains: VultrDomain[] }>("/domains");
    return result.domains ?? [];
  }

  async getDomainRecords(
    domain: string,
  ): Promise<ReadonlyArray<VultrDnsRecord>> {
    const result = await this.request<{ records: VultrDnsRecord[] }>(
      `/domains/${domain}/records`,
      { per_page: "200" },
    );
    return result.records ?? [];
  }

  async searchDomains(
    query: string,
  ): Promise<ReadonlyArray<VultrDomain>> {
    const domains = await this.getDomains();
    const lower = query.toLowerCase();
    return domains.filter((d) => d.domain?.toLowerCase().includes(lower));
  }

  // ── Firewalls ─────────────────────────────────────────────────────

  async getFirewallGroups(): Promise<ReadonlyArray<VultrFirewallGroup>> {
    const result = await this.request<{
      firewall_groups: VultrFirewallGroup[];
    }>("/firewalls");
    return result.firewall_groups ?? [];
  }

  async getFirewallRules(
    groupId: string,
  ): Promise<ReadonlyArray<VultrFirewallRule>> {
    const result = await this.request<{
      firewall_rules: VultrFirewallRule[];
    }>(`/firewalls/${groupId}/rules`);
    return result.firewall_rules ?? [];
  }

  // ── Backups ───────────────────────────────────────────────────────

  async getBackups(
    instanceId?: string,
  ): Promise<ReadonlyArray<VultrBackup>> {
    const params: Record<string, string> = { per_page: "50" };
    if (instanceId) params.instance_id = instanceId;

    const result = await this.request<{ backups: VultrBackup[] }>(
      "/backups",
      params,
    );
    return result.backups ?? [];
  }
}

// ── Vultr Types ───────────────────────────────────────────────────────

export interface VultrInstance {
  readonly id?: string;
  readonly label?: string;
  readonly hostname?: string;
  readonly status?: string;
  readonly power_status?: string;
  readonly server_status?: string;
  readonly main_ip?: string;
  readonly internal_ip?: string;
  readonly v6_main_ip?: string;
  readonly region?: string;
  readonly plan?: string;
  readonly os?: string;
  readonly os_id?: number;
  readonly ram?: number;
  readonly disk?: number;
  readonly vcpu_count?: number;
  readonly date_created?: string;
  readonly allowed_bandwidth?: number;
  readonly firewall_group_id?: string;
  readonly [key: string]: unknown;
}

export interface VultrBandwidth {
  readonly [date: string]: {
    readonly incoming_bytes?: number;
    readonly outgoing_bytes?: number;
  };
}

export interface VultrDomain {
  readonly domain?: string;
  readonly date_created?: string;
  readonly dns_sec?: string;
  readonly [key: string]: unknown;
}

export interface VultrDnsRecord {
  readonly id?: string;
  readonly type?: string;
  readonly name?: string;
  readonly data?: string;
  readonly priority?: number;
  readonly ttl?: number;
  readonly [key: string]: unknown;
}

export interface VultrFirewallGroup {
  readonly id?: string;
  readonly description?: string;
  readonly date_created?: string;
  readonly date_modified?: string;
  readonly instance_count?: number;
  readonly rule_count?: number;
  readonly max_rule_count?: number;
  readonly [key: string]: unknown;
}

export interface VultrFirewallRule {
  readonly id?: number;
  readonly type?: string;
  readonly ip_type?: string;
  readonly action?: string;
  readonly protocol?: string;
  readonly port?: string;
  readonly subnet?: string;
  readonly subnet_size?: number;
  readonly source?: string;
  readonly notes?: string;
  readonly [key: string]: unknown;
}

export interface VultrBackup {
  readonly id?: string;
  readonly date_created?: string;
  readonly description?: string;
  readonly size?: number;
  readonly status?: string;
  readonly [key: string]: unknown;
}
