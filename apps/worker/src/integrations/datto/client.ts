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
  private siteUidCache: Map<string, string> | null = null;
  private siteUidCacheAt = 0;

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

    // Datto RMM OAuth: the Basic auth header is the fixed public client
    // ("public-client:public") — the API key/secret only go in the form body.
    // Sending key:secret as Basic auth gets a 302 redirect to an HTML login
    // page, which then fails JSON parsing.
    const credentials = Buffer.from("public-client:public").toString("base64");

    const tokenResponse = await fetch(`${this.baseUrl}/auth/oauth/token`, {
      method: "POST",
      redirect: "manual",
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
      throw new Error(`Datto RMM auth failed (${tokenResponse.status}): ${text.slice(0, 300)}`);
    }

    const contentType = tokenResponse.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new Error(
        `Datto RMM auth returned non-JSON response (${tokenResponse.status}, ${contentType}) — check that api_url points at the platform's -api host`,
      );
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
    const result = await this.request<unknown>("/api/v2/account/sites");
    return extractArray<DattoSite>(result, ["sites", "items", "data", "results"]).map(normalizeSite);
  }

  /**
   * The v2 /site/{ref} endpoints take the site UID (a GUID), but integration
   * mappings store the numeric site id — resolve via the account sites list.
   */
  private async resolveSiteRef(siteId: number | string): Promise<string> {
    const ref = String(siteId);
    if (!/^\d+$/.test(ref)) return ref;

    const CACHE_MS = 10 * 60 * 1000;
    if (!this.siteUidCache || Date.now() - this.siteUidCacheAt > CACHE_MS) {
      const result = await this.request<unknown>("/api/v2/account/sites");
      const sites = extractArray<Record<string, unknown>>(result, ["sites", "items", "data", "results"]);
      const map = new Map<string, string>();
      for (const site of sites) {
        const uid = (site.uid ?? site.siteUid) as string | undefined;
        if (uid && site.id !== undefined) map.set(String(site.id), uid);
      }
      this.siteUidCache = map;
      this.siteUidCacheAt = Date.now();
    }

    const uid = this.siteUidCache.get(ref);
    if (!uid) console.warn(`[DATTO] No UID found for numeric site id ${ref}; using it as-is`);
    return uid ?? ref;
  }

  async getSite(siteId: number | string): Promise<DattoSite> {
    const ref = await this.resolveSiteRef(siteId);
    const result = await this.request<unknown>(`/api/v2/site/${ref}`);
    return normalizeSite(unwrapRecord<DattoSite>(result, ["site", "data", "result"]));
  }

  // ── Devices ───────────────────────────────────────────────────────

  async getDevices(siteId?: number | string): Promise<ReadonlyArray<DattoDevice>> {
    if (siteId) {
      try {
        const siteRef = await this.resolveSiteRef(siteId);
        const siteResult = await this.request<unknown>(`/api/v2/site/${siteRef}/devices`);
        const siteDevices = extractArray<DattoDevice>(siteResult, ["devices", "items", "data", "results"]).map(normalizeDevice);
        if (siteDevices.length > 0) return siteDevices;
      } catch (error) {
        console.warn(`[DATTO] Site device endpoint failed for site ${siteId}; falling back to account devices:`, error);
      }

      const accountDevices = await this.getDevices();
      const filtered = accountDevices.filter((device) => dattoIdEquals(device.siteId, siteId));
      return filtered.length > 0 ? filtered : accountDevices.filter((device) => dattoIdEquals(device.site?.id, siteId));
    }

    const result = await this.request<unknown>("/api/v2/account/devices");
    return extractArray<DattoDevice>(result, ["devices", "items", "data", "results"]).map(normalizeDevice);
  }

  async getDevice(deviceId: string): Promise<DattoDevice> {
    const result = await this.request<unknown>(`/api/v2/device/${deviceId}`);
    return normalizeDevice(unwrapRecord<DattoDevice>(result, ["device", "data", "result"]));
  }

  async searchDevices(hostname: string, siteId?: number | string): Promise<ReadonlyArray<DattoDevice>> {
    const devices = await this.getDevices(siteId);
    const lower = hostname.toLowerCase();
    return devices.filter(
      (d) =>
        d.hostname?.toLowerCase().includes(lower) ||
        d.description?.toLowerCase().includes(lower),
    );
  }

  /**
   * Find devices where the last logged-in user matches (partial, case-insensitive).
   */
  async findDevicesByUser(
    userName: string,
    siteId?: number | string,
  ): Promise<ReadonlyArray<DattoDevice>> {
    const devices = await this.getDevices(siteId);
    const nameLower = userName.toLowerCase();
    return devices.filter((d) => {
      const lastUser = (d.lastLoggedInUser ?? d.lastUser ?? "").toLowerCase();
      return lastUser.includes(nameLower) || nameLower.includes(lastUser);
    });
  }

  /**
   * Build a direct link to a device in the Datto RMM console.
   */
  static deviceUrl(baseUrl: string, deviceUid: string): string {
    // Datto RMM web console URL pattern
    return `${baseUrl.replace('/api/v2', '')}/device/${deviceUid}/quickview`;
  }

  // ── Alerts ────────────────────────────────────────────────────────

  async getAlerts(params?: {
    readonly siteId?: number | string;
    readonly deviceId?: string;
    readonly resolved?: boolean;
  }): Promise<ReadonlyArray<DattoAlert>> {
    // The v2 API has no bare /alerts resource — alerts live under
    // /alerts/open and /alerts/resolved on account, site, and device
    const state = params?.resolved ? "resolved" : "open";

    let scope = "/api/v2/account";
    if (params?.deviceId) scope = `/api/v2/device/${params.deviceId}`;
    else if (params?.siteId) scope = `/api/v2/site/${await this.resolveSiteRef(params.siteId)}`;

    const result = await this.request<unknown>(`${scope}/alerts/${state}`);
    return extractArray<DattoAlert>(result, ["alerts", "items", "data", "results"]).map(normalizeAlert);
  }

  async getOpenAlerts(siteId?: number | string): Promise<ReadonlyArray<DattoAlert>> {
    return this.getAlerts({ siteId, resolved: false });
  }

  // ── Patch Management ──────────────────────────────────────────────

  async getDevicePatchStatus(deviceId: string): Promise<DattoPatchStatus | null> {
    // There is no /patch-status resource in the v2 API — patch state rides
    // on the device object's patchManagement field
    try {
      const device = await this.getDevice(deviceId);
      const patch = (device as Record<string, unknown>).patchManagement;
      return isRecord(patch) ? (patch as DattoPatchStatus) : null;
    } catch {
      return null;
    }
  }

  // ── Software Audit ────────────────────────────────────────────────

  async getDeviceSoftware(deviceId: string): Promise<ReadonlyArray<DattoSoftware>> {
    try {
      const result = await this.request<unknown>(
        `/api/v2/audit/device/${deviceId}/software`,
      );
      return extractArray<DattoSoftware>(result, ["software", "items", "data", "results"]);
    } catch {
      return [];
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapRecord<T>(value: unknown, keys: ReadonlyArray<string>): T {
  if (isRecord(value)) {
    for (const key of keys) {
      const nested = value[key];
      if (isRecord(nested)) return nested as T;
    }
  }
  return value as T;
}

function extractArray<T>(value: unknown, keys: ReadonlyArray<string>): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!isRecord(value)) return [];

  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested as T[];
    if (isRecord(nested)) {
      const deeper = extractArray<T>(nested, keys);
      if (deeper.length > 0) return deeper;
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) return nested as T[];
  }

  return [];
}

function dattoIdEquals(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

function normalizeSite(raw: DattoSite): DattoSite {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    id: (record.id ?? record.siteId ?? record.siteUid ?? record.uid) as number | string,
    name: (record.name ?? record.siteName ?? record.description ?? "") as string,
  };
}

function normalizeDevice(raw: DattoDevice): DattoDevice {
  const record = raw as Record<string, unknown>;
  const site = isRecord(record.site) ? record.site : undefined;
  return {
    ...raw,
    uid: (record.uid ?? record.deviceUid ?? record.deviceId ?? record.id) as string | undefined,
    id: (record.id ?? record.deviceId ?? record.uid ?? record.deviceUid) as string | undefined,
    hostname: (record.hostname ?? record.name ?? record.deviceName ?? record.description) as string | undefined,
    siteId: (record.siteId ?? record.site_id ?? site?.id ?? site?.siteId) as number | string | undefined,
    siteName: (record.siteName ?? record.site_name ?? site?.name ?? site?.siteName) as string | undefined,
    operatingSystem: (record.operatingSystem ?? record.os ?? record.osName) as string | undefined,
    lastSeen: (record.lastSeen ?? record.lastSeenDate ?? record.lastOnline ?? record.lastAuditDate) as string | undefined,
    online: (record.online ?? record.isOnline ?? record.status === "Online") as boolean | undefined,
    lastLoggedInUser: (record.lastLoggedInUser ?? record.lastUser ?? record.loggedInUser) as string | undefined,
    intIpAddress: (record.intIpAddress ?? record.ipAddress ?? record.internalIpAddress) as string | undefined,
  };
}

function normalizeAlert(raw: DattoAlert): DattoAlert {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    alertUid: (record.alertUid ?? record.uid ?? record.id) as string | undefined,
    alertMessage: (record.alertMessage ?? record.message ?? record.description) as string | undefined,
    hostname: (record.hostname ?? record.deviceName) as string | undefined,
    siteName: (record.siteName ?? record.site_name) as string | undefined,
  };
}

// ── Datto Types ───────────────────────────────────────────────────────

export interface DattoSite {
  readonly id: number | string;
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
  readonly siteId?: number | string;
  readonly siteName?: string;
  readonly site?: {
    readonly id?: number | string;
    readonly siteId?: number | string;
    readonly name?: string;
    readonly siteName?: string;
  };
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
  readonly lastLoggedInUser?: string;
  readonly lastUser?: string;
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
