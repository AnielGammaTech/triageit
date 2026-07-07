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
    readonly state?: string; // "connected" | "disconnected"
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
   * Fetch every page of a Site Manager list endpoint. Responses carry a
   * nextToken when more pages exist — without following it, anything past
   * the first page is silently dropped as the fleet grows.
   */
  private async requestAllPages<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let nextToken: string | undefined;
    let pages = 0;

    do {
      const sep = path.includes("?") ? "&" : "?";
      const tokenParam = nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : "";
      const response = await this.request<{ data?: T[]; nextToken?: string }>(
        `${path}${sep}pageSize=200${tokenParam}`,
      );
      items.push(...(response.data ?? []));
      nextToken = response.nextToken;
      pages++;
    } while (nextToken && pages < 50);

    return items;
  }

  /**
   * Get all sites across all hosts.
   */
  async getSites(): Promise<ReadonlyArray<UnifiSite>> {
    const data = await this.requestAllPages<Record<string, unknown>>("/v1/sites");
    return data.map(normalizeSite);
  }

  /**
   * Get all hosts (consoles/controllers).
   */
  async getHosts(): Promise<ReadonlyArray<UnifiHost>> {
    return this.requestAllPages<UnifiHost>("/v1/hosts");
  }

  /**
   * Consoles that are not reporting to the UniFi cloud. Their sites and
   * devices are frozen at lastConnectionStateChange — the API physically
   * cannot return current data for them.
   */
  async getDisconnectedHosts(): Promise<ReadonlyArray<UnifiHost>> {
    const hosts = await this.getHosts();
    return hosts.filter((h) => h.reportedState?.state === "disconnected");
  }

  /**
   * Get all devices across all sites (APs, switches, gateways).
   *
   * /v1/devices returns entries GROUPED BY HOST — {hostId, hostName,
   * devices: [...]} — so flatten the groups and stamp each device with
   * its hostId. Normalizing the group wrapper itself produces one
   * "Unnamed" device per console with every field unknown.
   */
  async getDevices(): Promise<ReadonlyArray<UnifiDevice>> {
    const groups = await this.requestAllPages<Record<string, unknown>>("/v1/devices");
    const devices: UnifiDevice[] = [];
    for (const group of groups) {
      const hostId = (group.hostId ?? "") as string;
      const groupDevices = Array.isArray(group.devices) ? (group.devices as Record<string, unknown>[]) : [];
      for (const raw of groupDevices) {
        devices.push(normalizeDevice({ ...raw, hostId: raw.hostId ?? hostId }));
      }
    }
    return devices;
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
  async getSiteByHostId(externalId: string): Promise<UnifiSite | null> {
    const sites = await this.getSites();
    // Mappings store either the bare hostId or hostId:siteId — the latter
    // is required to disambiguate multi-site (self-hosted) consoles
    return (
      sites.find(
        (s) => s.hostId === externalId || `${s.hostId}:${s.siteId}` === externalId,
      ) ?? null
    );
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
