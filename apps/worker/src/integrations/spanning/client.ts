import type { SpanningConfig } from "@triageit/shared";

/**
 * SpanningClient — Queries Spanning Backup for Office 365 data.
 *
 * Used by Meredith Palmer to pull backup status, user protection,
 * audit logs, and error details for tenant/site issues.
 *
 * API base: https://o365-api-{region}.spanning.com/external
 * Auth: Bearer token (api_key)
 */
export class SpanningClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: SpanningConfig) {
    const region = config.region.toLowerCase().trim();
    this.baseUrl = `https://o365-api-${region}.spanning.com/external`;
    this.apiKey = config.api_key;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
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
        `Spanning API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── Tenant / Admin ──────────────────────────────────────────────────

  async getTenantInfo(): Promise<SpanningTenant> {
    return this.request<SpanningTenant>("/admin");
  }

  async getTenantStatus(): Promise<SpanningTenantStatus> {
    return this.request<SpanningTenantStatus>("/admin/status");
  }

  // ── Users ───────────────────────────────────────────────────────────

  async getUsers(params?: {
    readonly size?: number;
  }): Promise<ReadonlyArray<SpanningUser>> {
    const queryParams: Record<string, string> = {};
    if (params?.size) queryParams.size = String(params.size);

    const result = await this.request<{ users: SpanningUser[] }>(
      "/users",
      queryParams,
    );
    return result.users ?? [];
  }

  async getUser(userPrincipalName: string): Promise<SpanningUser | null> {
    try {
      return await this.request<SpanningUser>(
        `/users/${encodeURIComponent(userPrincipalName)}`,
      );
    } catch {
      return null;
    }
  }

  async getUserBackupSummary(
    userPrincipalName: string,
  ): Promise<SpanningUserBackup | null> {
    try {
      return await this.request<SpanningUserBackup>(
        `/users/${encodeURIComponent(userPrincipalName)}/backups`,
      );
    } catch {
      return null;
    }
  }

  // ── Backups ─────────────────────────────────────────────────────────

  async getBackupSummary(): Promise<SpanningBackupSummary> {
    return this.request<SpanningBackupSummary>("/backups/summary");
  }

  // ── Audit / Events ─────────────────────────────────────────────────

  async getAuditLog(params?: {
    readonly startDate?: string;
    readonly endDate?: string;
    readonly size?: number;
  }): Promise<ReadonlyArray<SpanningAuditEvent>> {
    const queryParams: Record<string, string> = {};
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.size) queryParams.size = String(params.size);

    const result = await this.request<{ events: SpanningAuditEvent[] }>(
      "/audit",
      queryParams,
    );
    return result.events ?? [];
  }

  // ── Errors ──────────────────────────────────────────────────────────

  async getErrors(params?: {
    readonly size?: number;
  }): Promise<ReadonlyArray<SpanningError>> {
    const queryParams: Record<string, string> = {};
    if (params?.size) queryParams.size = String(params.size);

    try {
      const result = await this.request<{ errors: SpanningError[] }>(
        "/errors",
        queryParams,
      );
      return result.errors ?? [];
    } catch {
      return [];
    }
  }

  // ── Search helpers ──────────────────────────────────────────────────

  async searchUserByEmail(
    email: string,
  ): Promise<SpanningUser | null> {
    const users = await this.getUsers({ size: 100 });
    const lower = email.toLowerCase();
    return (
      users.find(
        (u) =>
          u.userPrincipalName?.toLowerCase() === lower ||
          u.email?.toLowerCase() === lower,
      ) ?? null
    );
  }

  async getRecentErrors(count: number = 20): Promise<ReadonlyArray<SpanningError>> {
    return this.getErrors({ size: count });
  }
}

// ── Spanning Types ──────────────────────────────────────────────────────

export interface SpanningTenant {
  readonly tenantId?: string;
  readonly companyName?: string;
  readonly adminEmail?: string;
  readonly subscriptionType?: string;
  readonly licensedUsers?: number;
  readonly assignedUsers?: number;
  readonly status?: string;
  readonly [key: string]: unknown;
}

export interface SpanningTenantStatus {
  readonly backupEnabled?: boolean;
  readonly lastBackupTime?: string;
  readonly nextBackupTime?: string;
  readonly totalProtectedUsers?: number;
  readonly totalUnprotectedUsers?: number;
  readonly status?: string;
  readonly errors?: number;
  readonly warnings?: number;
  readonly [key: string]: unknown;
}

export interface SpanningUser {
  readonly userPrincipalName?: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly isAdmin?: boolean;
  readonly isLicensed?: boolean;
  readonly isAssigned?: boolean;
  readonly backupEnabled?: boolean;
  readonly lastBackupStatus?: string;
  readonly lastBackupTime?: string;
  readonly totalMailItems?: number;
  readonly totalDriveItems?: number;
  readonly totalContactItems?: number;
  readonly totalCalendarItems?: number;
  readonly totalSharePointItems?: number;
  readonly [key: string]: unknown;
}

export interface SpanningUserBackup {
  readonly userPrincipalName?: string;
  readonly lastBackupTime?: string;
  readonly lastBackupStatus?: string;
  readonly mailBackupStatus?: string;
  readonly driveBackupStatus?: string;
  readonly sharePointBackupStatus?: string;
  readonly calendarBackupStatus?: string;
  readonly contactsBackupStatus?: string;
  readonly errors?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

export interface SpanningBackupSummary {
  readonly totalProtectedUsers?: number;
  readonly totalUnprotectedUsers?: number;
  readonly successCount?: number;
  readonly failureCount?: number;
  readonly partialCount?: number;
  readonly lastRunTime?: string;
  readonly nextRunTime?: string;
  readonly [key: string]: unknown;
}

export interface SpanningAuditEvent {
  readonly eventType?: string;
  readonly eventTime?: string;
  readonly adminEmail?: string;
  readonly description?: string;
  readonly userPrincipalName?: string;
  readonly details?: string;
  readonly [key: string]: unknown;
}

export interface SpanningError {
  readonly errorCode?: number;
  readonly errorMessage?: string;
  readonly userPrincipalName?: string;
  readonly siteUrl?: string;
  readonly timestamp?: string;
  readonly category?: string;
  readonly severity?: string;
  readonly details?: string;
  readonly [key: string]: unknown;
}
