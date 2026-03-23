import type { UnitrendsConfig } from "@triageit/shared";

/**
 * UnitrendsClient — Queries the Unitrends/Kaseya Unified Backup public API.
 *
 * Uses OAuth2 client_credentials flow via login.backup.net.
 * Provides backup job status, customer devices, and recovery points.
 *
 * API docs: https://apidoc-public-api.backup.net/swagger-ui-v2/index.html
 */

interface OAuthToken {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export interface UnitrendsCustomer {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
}

export interface UnitrendsDevice {
  readonly id: number;
  readonly name: string;
  readonly customerId: number;
  readonly customerName: string;
  readonly os: string;
  readonly status: string;
  readonly lastBackupStatus: string;
  readonly lastBackupTime: string | null;
  readonly lastSuccessfulBackup: string | null;
  readonly alertCount: number;
  readonly protectedData: string | null;
}

export interface UnitrendsBackupJob {
  readonly id: number;
  readonly deviceId: number;
  readonly deviceName: string;
  readonly status: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly errorMessage: string | null;
  readonly dataType: string | null;
  readonly sizeBytes: number;
}

const TOKEN_URL = "https://login.backup.net/connect/token";
const API_BASE = "https://public-api.backup.net/v1";

export class UnitrendsClient {
  private readonly config: UnitrendsConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: UnitrendsConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const basicAuth = Buffer.from(
      `${this.config.client_id}:${this.config.client_secret}`,
    ).toString("base64");

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Unitrends OAuth failed (${response.status}): ${text}`);
    }

    const token = (await response.json()) as OAuthToken;
    this.accessToken = token.access_token;
    this.tokenExpiry = Date.now() + token.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.authenticate();

    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Unitrends API error ${response.status} on ${path}: ${text.slice(0, 500)}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /** List all managed customers. */
  async listCustomers(): Promise<ReadonlyArray<UnitrendsCustomer>> {
    const raw = await this.request<unknown>("/customers");
    const items = extractArray(raw);
    return items.map((o) => ({
      id: (o.id ?? o.customerId ?? 0) as number,
      name: (o.name ?? o.customerName ?? "Unknown") as string,
      isActive: o.isActive !== false,
    }));
  }

  /** List backup devices for a specific customer. */
  async getDevices(
    customerId: number,
  ): Promise<ReadonlyArray<UnitrendsDevice>> {
    const raw = await this.request<unknown>(
      `/customers/${customerId}/devices`,
    );
    const items = extractArray(raw);
    return items.map((o) => ({
      id: (o.id ?? o.deviceId ?? 0) as number,
      name: (o.name ?? o.deviceName ?? "Unknown") as string,
      customerId: (o.customerId ?? customerId) as number,
      customerName: (o.customerName ?? "") as string,
      os: (o.os ?? o.operatingSystem ?? "") as string,
      status: (o.status ?? "unknown") as string,
      lastBackupStatus: (o.lastBackupStatus ?? o.lastSessionStatus ?? "unknown") as string,
      lastBackupTime: (o.lastBackupTime ?? o.lastSessionTimestamp ?? null) as string | null,
      lastSuccessfulBackup: (o.lastSuccessfulBackup ?? o.lastSuccessfulSessionTimestamp ?? null) as string | null,
      alertCount: (o.alertCount ?? o.alerts ?? 0) as number,
      protectedData: (o.protectedData ?? null) as string | null,
    }));
  }

  /** List recent backup jobs for a specific customer. */
  async getBackupJobs(
    customerId: number,
  ): Promise<ReadonlyArray<UnitrendsBackupJob>> {
    try {
      const raw = await this.request<unknown>(
        `/customers/${customerId}/jobs`,
      );
      const items = extractArray(raw);
      return items.map((o) => ({
        id: (o.id ?? o.jobId ?? 0) as number,
        deviceId: (o.deviceId ?? 0) as number,
        deviceName: (o.deviceName ?? "") as string,
        status: (o.status ?? "unknown") as string,
        startTime: (o.startTime ?? o.startTimestamp ?? null) as string | null,
        endTime: (o.endTime ?? o.endTimestamp ?? null) as string | null,
        errorMessage: (o.errorMessage ?? o.error ?? null) as string | null,
        dataType: (o.dataType ?? o.type ?? null) as string | null,
        sizeBytes: (o.sizeBytes ?? o.size ?? 0) as number,
      }));
    } catch {
      return [];
    }
  }

  /** Health check — verifies auth and basic API access. */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listCustomers();
      return true;
    } catch {
      return false;
    }
  }

  /** Find a customer by name (fuzzy). */
  async findCustomerByName(
    name: string,
  ): Promise<UnitrendsCustomer | null> {
    const customers = await this.listCustomers();
    const lower = name.toLowerCase();
    const norm = normalizeName(name);

    // Exact match
    const exact = customers.find(
      (c) => c.name.toLowerCase() === lower,
    );
    if (exact) return exact;

    // Normalized match
    const normalized = customers.find(
      (c) => normalizeName(c.name) === norm && norm.length > 2,
    );
    if (normalized) return normalized;

    // Contains match
    const contains = customers.find(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        lower.includes(c.name.toLowerCase()),
    );
    return contains ?? null;
  }
}

/** Extract array from flexible API response shapes. */
function extractArray(
  raw: unknown,
): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  const obj = raw as Record<string, unknown>;
  const arr =
    obj.items ?? obj.data ?? obj.devices ?? obj.customers ?? obj.jobs ?? [];
  return Array.isArray(arr)
    ? (arr as ReadonlyArray<Record<string, unknown>>)
    : [];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
