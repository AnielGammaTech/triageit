import type { UnifiConfig } from "@triageit/shared";

// ── Types ────────────────────────────────────────────────────────────

export interface UnifiSite {
  readonly hostId: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly hostName: string;
  readonly isOnline: boolean;
  readonly meta?: {
    readonly name?: string;
    readonly desc?: string;
    readonly timezone?: string;
  };
  readonly statistics?: {
    readonly counts?: {
      readonly totalDevice?: number;
      readonly offlineDevice?: number;
      readonly activeClient?: number;
    };
    readonly percentages?: {
      readonly txRetry?: number;
      readonly wifiScore?: number;
    };
    readonly averages?: {
      readonly latency?: number;
    };
    readonly isp?: {
      readonly name?: string;
      readonly download?: number;
      readonly upload?: number;
    };
  };
}

export interface UnifiDevice {
  readonly id: string;
  readonly mac: string;
  readonly name: string;
  readonly model: string;
  readonly type: string; // uap, usw, ugw, uxg, etc.
  readonly ip: string;
  readonly status: string; // online, offline, adopting, etc.
  readonly firmwareVersion?: string;
  readonly uptimeSeconds?: number;
  readonly hostId?: string;
  readonly siteId?: string;
  readonly features?: Record<string, unknown>;
}

export interface UnifiHost {
  readonly id: string;
  readonly hardwareId?: string;
  readonly type: string;
  readonly ipAddress?: string;
  readonly firmwareVersion?: string;
  readonly isBlocked: boolean;
  readonly lastConnectionStateChange?: string;
  readonly reportedState?: {
    readonly name?: string;
    readonly hostname?: string;
    readonly firmwareVersion?: string;
    readonly releaseChannel?: string;
    readonly controllers?: ReadonlyArray<{
      readonly name?: string;
      readonly version?: string;
      readonly status?: string;
      readonly statusMessage?: string;
    }>;
  };
  readonly userData?: {
    readonly name?: string;
  };
}

// ── Client ───────────────────────────────────────────────────────────

const BASE_URL = "https://api.ui.com";

export class UnifiClient {
  private readonly apiKey: string;

  constructor(config: UnifiConfig) {
    this.apiKey = config.api_key;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`UniFi API ${path} failed (${res.status}): ${text.substring(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Get all sites across all hosts.
   */
  async getSites(): Promise<ReadonlyArray<UnifiSite>> {
    const data = await this.request<{ data?: ReadonlyArray<Record<string, unknown>> }>("/ea/sites");
    return (data.data ?? []).map(normalizeSite);
  }

  /**
   * Get all hosts (consoles/controllers).
   */
  async getHosts(): Promise<ReadonlyArray<UnifiHost>> {
    const data = await this.request<{ data?: ReadonlyArray<UnifiHost> }>("/ea/hosts");
    return data.data ?? [];
  }

  /**
   * Get all devices across all sites (APs, switches, gateways).
   */
  async getDevices(): Promise<ReadonlyArray<UnifiDevice>> {
    const data = await this.request<{ data?: ReadonlyArray<Record<string, unknown>> }>("/ea/devices");
    return (data.data ?? []).map(normalizeDevice);
  }

  /**
   * Get devices for a specific host.
   */
  async getDevicesByHost(hostId: string): Promise<ReadonlyArray<UnifiDevice>> {
    const allDevices = await this.getDevices();
    return allDevices.filter((d) => d.hostId === hostId);
  }

  /**
   * Get a site by host ID.
   */
  async getSiteByHostId(hostId: string): Promise<UnifiSite | null> {
    const sites = await this.getSites();
    return sites.find((s) => s.hostId === hostId) ?? null;
  }
}

// ── Normalizers ──────────────────────────────────────────────────────

function normalizeSite(raw: Record<string, unknown>): UnifiSite {
  const meta = raw.meta as Record<string, unknown> | undefined;
  const statistics = raw.statistics as Record<string, unknown> | undefined;
  const counts = statistics?.counts as Record<string, unknown> | undefined;
  const percentages = statistics?.percentages as Record<string, unknown> | undefined;
  const averages = statistics?.averages as Record<string, unknown> | undefined;
  const isp = statistics?.isp as Record<string, unknown> | undefined;

  return {
    hostId: (raw.hostId ?? "") as string,
    siteId: (raw.siteId ?? "") as string,
    siteName: (meta?.desc ?? meta?.name ?? "") as string,
    hostName: (raw.hostName ?? "") as string,
    isOnline: raw.isOnline !== false,
    meta: meta ? {
      name: meta.name as string | undefined,
      desc: meta.desc as string | undefined,
      timezone: meta.timezone as string | undefined,
    } : undefined,
    statistics: statistics ? {
      counts: counts ? {
        totalDevice: counts.totalDevice as number | undefined,
        offlineDevice: counts.offlineDevice as number | undefined,
        activeClient: counts.activeClient as number | undefined,
      } : undefined,
      percentages: percentages ? {
        txRetry: percentages.txRetry as number | undefined,
        wifiScore: percentages.wifiScore as number | undefined,
      } : undefined,
      averages: averages ? {
        latency: averages.latency as number | undefined,
      } : undefined,
      isp: isp ? {
        name: isp.name as string | undefined,
        download: isp.download as number | undefined,
        upload: isp.upload as number | undefined,
      } : undefined,
    } : undefined,
  };
}

function normalizeDevice(raw: Record<string, unknown>): UnifiDevice {
  return {
    id: (raw.id ?? raw._id ?? "") as string,
    mac: (raw.mac ?? "") as string,
    name: (raw.name ?? raw.hostname ?? "Unnamed") as string,
    model: (raw.model ?? raw.shortname ?? "Unknown") as string,
    type: (raw.type ?? "unknown") as string,
    ip: (raw.ip ?? "") as string,
    status: (raw.status ?? "unknown") as string,
    firmwareVersion: (raw.firmwareVersion ?? raw.version ?? undefined) as string | undefined,
    uptimeSeconds: (raw.uptimeSeconds ?? raw.uptime ?? undefined) as number | undefined,
    hostId: (raw.hostId ?? undefined) as string | undefined,
    siteId: (raw.siteId ?? undefined) as string | undefined,
    features: (raw.features ?? undefined) as Record<string, unknown> | undefined,
  };
}
