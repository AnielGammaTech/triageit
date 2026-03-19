import type { DattoConfig } from "@triageit/shared";

/**
 * DattoClient — Queries Datto RMM for device monitoring data.
 *
 * Uses OAuth2 token flow: POST credentials to /auth/oauth/token,
 * then use Bearer token for all subsequent API calls.
 *
 * Used by Andy Bernard to pull real device status, alerts,
 * patch compliance, and software inventory.
 */
export class DattoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: DattoConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
    this.apiKey = config.api_key;
    this.apiSecret = config.api_secret;
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString("base64");

    const tokenResponse = await fetch(`${this.baseUrl}/auth/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: this.apiKey,
        password: this.apiSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Datto RMM auth failed (${tokenResponse.status}): ${text}`);
    }

    const data = (await tokenResponse.json()) as {
      access_token: string;
      expires_in?: number;
    };

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };

    return data.access_token;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const token = await this.getAccessToken();

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Datto API ${path} failed (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
  }

  // ── Sites (Clients) ──────────────────────────────────────────────

  async getSites(): Promise<ReadonlyArray<DattoSite>> {
    const result = await this.request<{ sites: DattoSite[] }>("/api/v2/account/sites");
    return result.sites ?? [];
  }

  async getSite(siteId: number): Promise<DattoSite> {
    const result = await this.request<DattoSite>(`/api/v2/site/${siteId}`);
    return result;
  }

  // ── Devices ───────────────────────────────────────────────────────

  async getDevices(siteId?: number): Promise<ReadonlyArray<DattoDevice>> {
    const path = siteId
      ? `/api/v2/site/${siteId}/devices`
      : "/api/v2/account/devices";
    const result = await this.request<{ devices: DattoDevice[] }>(path);
    return result.devices ?? [];
  }

  async getDevice(deviceId: string): Promise<DattoDevice> {
    return this.request<DattoDevice>(`/api/v2/device/${deviceId}`);
  }

  async searchDevices(hostname: string, siteId?: number): Promise<ReadonlyArray<DattoDevice>> {
    const devices = await this.getDevices(siteId);
    const lower = hostname.toLowerCase();
    return devices.filter(
      (d) =>
        d.hostname?.toLowerCase().includes(lower) ||
        d.description?.toLowerCase().includes(lower),
    );
  }

  // ── Alerts ────────────────────────────────────────────────────────

  async getAlerts(params?: {
    readonly siteId?: number;
    readonly deviceId?: string;
    readonly resolved?: boolean;
  }): Promise<ReadonlyArray<DattoAlert>> {
    const queryParams: Record<string, string> = {};
    if (params?.resolved !== undefined) queryParams.resolved = String(params.resolved);

    let path = "/api/v2/account/alerts";
    if (params?.deviceId) path = `/api/v2/device/${params.deviceId}/alerts`;
    else if (params?.siteId) path = `/api/v2/site/${params.siteId}/alerts`;

    const result = await this.request<{ alerts: DattoAlert[] }>(path, queryParams);
    return result.alerts ?? [];
  }

  async getOpenAlerts(siteId?: number): Promise<ReadonlyArray<DattoAlert>> {
    return this.getAlerts({ siteId, resolved: false });
  }

  // ── Patch Management ──────────────────────────────────────────────

  async getDevicePatchStatus(deviceId: string): Promise<DattoPatchStatus | null> {
    try {
      return await this.request<DattoPatchStatus>(
        `/api/v2/device/${deviceId}/patch-status`,
      );
    } catch {
      return null;
    }
  }

  // ── Software Audit ────────────────────────────────────────────────

  async getDeviceSoftware(deviceId: string): Promise<ReadonlyArray<DattoSoftware>> {
    try {
      const result = await this.request<{ software: DattoSoftware[] }>(
        `/api/v2/device/${deviceId}/software`,
      );
      return result.software ?? [];
    } catch {
      return [];
    }
  }
}

// ── Datto Types ───────────────────────────────────────────────────────

export interface DattoSite {
  readonly id: number;
  readonly name: string;
  readonly description?: string;
  readonly onDemand?: boolean;
  readonly devicesStatus?: {
    readonly numberOfDevices?: number;
    readonly numberOfOnlineDevices?: number;
    readonly numberOfOfflineDevices?: number;
  };
  readonly [key: string]: unknown;
}

export interface DattoDevice {
  readonly uid?: string;
  readonly id?: string;
  readonly hostname?: string;
  readonly description?: string;
  readonly siteId?: number;
  readonly siteName?: string;
  readonly deviceType?: {
    readonly category?: string;
    readonly type?: string;
  };
  readonly operatingSystem?: string;
  readonly lastSeen?: string;
  readonly online?: boolean;
  readonly lastAuditDate?: string;
  readonly warrantyDate?: string;
  readonly serialNumber?: string;
  readonly ipAddress?: string;
  readonly intIpAddress?: string;
  readonly patchStatus?: {
    readonly patchesMissing?: number;
    readonly patchesInstalled?: number;
    readonly patchesFailed?: number;
  };
  readonly antivirusProduct?: string;
  readonly [key: string]: unknown;
}

export interface DattoAlert {
  readonly alertUid?: string;
  readonly alertType?: string;
  readonly priority?: string;
  readonly alertMessage?: string;
  readonly alertContext?: string;
  readonly timestamp?: string;
  readonly resolved?: boolean;
  readonly resolvedAt?: string;
  readonly deviceUid?: string;
  readonly hostname?: string;
  readonly siteName?: string;
  readonly [key: string]: unknown;
}

export interface DattoPatchStatus {
  readonly patchesMissing?: number;
  readonly patchesInstalled?: number;
  readonly patchesFailed?: number;
  readonly lastScanDate?: string;
  readonly [key: string]: unknown;
}

export interface DattoSoftware {
  readonly name?: string;
  readonly version?: string;
  readonly installDate?: string;
  readonly publisher?: string;
  readonly [key: string]: unknown;
}
