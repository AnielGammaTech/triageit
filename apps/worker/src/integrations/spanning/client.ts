/**
 * SpanningClient — M365 backup data via the Kaseya Unified Backup
 * (Unitrends MSP) v2 Spanning endpoints.
 *
 * The MSP portal exposes Spanning under the SAME OAuth credentials as
 * Unitrends: /v2/spanning/domains lists every protected M365 domain with
 * backup health, and /v2/spanning/domains/{id}/users returns per-user,
 * per-service (mail/contacts/calendar/drive) backup status. No separate
 * Spanning API token needed. (Endpoints confirmed from PortalIT's
 * working sync + verified live.)
 */

const AUTH_URL = "https://login.backup.net/connect/token";
const API_BASE = "https://public-api.backup.net";

export interface UnitrendsSpanningConfig {
  readonly client_id: string;
  readonly client_secret: string;
}

export interface SpanningTenant {
  readonly companyName?: string;
  readonly domain?: string;
  readonly region?: string;
  readonly [key: string]: unknown;
}

export interface SpanningTenantStatus {
  readonly totalUsers?: number;
  readonly totalProtectedUsers?: number;
  readonly lastBackup?: string;
  readonly licensesTotal?: number;
  readonly [key: string]: unknown;
}

export interface SpanningBackupSummary {
  readonly statusLastSevenDays?: unknown;
  readonly lastBackup?: string;
  readonly failedUsers?: number;
  // Domains whose per-user fetch FAILED — their users are missing from the
  // counts above, so callers must not report those domains as healthy
  readonly domainsFailed?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

export interface SpanningError {
  readonly errorCode?: string;
  readonly siteUrl?: string;
  readonly userEmail?: string;
  readonly service?: string;
  readonly message?: string;
  readonly timestamp?: string;
  readonly [key: string]: unknown;
}

export interface SpanningUser {
  readonly userPrincipalName?: string;
  readonly email?: string;
  readonly id?: string;
  readonly lastBackupStatusTotal?: string;
  readonly lastBackupTimestampTotal?: string;
  readonly [key: string]: unknown;
}

export interface SpanningUserBackup {
  readonly status?: string;
  readonly lastBackup?: string;
  readonly perService?: Record<string, string>;
  readonly [key: string]: unknown;
}

interface SpanningDomain {
  readonly id: string;
  readonly customerId?: string;
  readonly name?: string;
  readonly region?: string;
  readonly numberOfUsers?: number;
  readonly numberOfProtectedStandardUsers?: number;
  readonly numberOfStandardLicensesTotal?: number;
  readonly lastBackup?: string;
  readonly backupStatusLastSevenDays?: unknown;
  readonly [key: string]: unknown;
}

export class SpanningClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: { value: string; expiresAt: number } | null = null;
  private scopedDomains: SpanningDomain[] = [];
  private scopedUsers: SpanningUser[] | null = null;
  private failedDomains: string[] = [];

  constructor(config: UnitrendsSpanningConfig) {
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.value;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    if (!response.ok) {
      throw new Error(`Unitrends auth failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Unitrends API ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  private async getAllDomains(): Promise<SpanningDomain[]> {
    const data = await this.request<unknown>("/v2/spanning/domains?page_size=500");
    if (Array.isArray(data)) return data as SpanningDomain[];
    const record = data as Record<string, unknown>;
    return (record.items ?? record.data ?? record.domains ?? []) as SpanningDomain[];
  }

  /**
   * Scope the client to the ticket's customer — by the reporter's email
   * domain when available (exact), otherwise by fuzzy client-name match
   * against the Spanning domain names.
   */
  async resolveScope(params: {
    readonly userEmail?: string | null;
    readonly clientName?: string | null;
  }): Promise<boolean> {
    const domains = await this.getAllDomains();

    const emailDomain = params.userEmail?.split("@")[1]?.toLowerCase();
    if (emailDomain) {
      const hits = domains.filter((d) => d.name?.toLowerCase() === emailDomain);
      if (hits.length > 0) {
        // A customer may protect several domains — include siblings by customerId
        const customerIds = new Set(hits.map((h) => h.customerId).filter(Boolean));
        this.scopedDomains = domains.filter(
          (d) => hits.includes(d) || (d.customerId !== undefined && customerIds.has(d.customerId)),
        );
        return true;
      }
    }

    if (params.clientName) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const target = normalize(params.clientName);
      const hit = domains.find((d) => {
        const name = normalize(d.name ?? "");
        return name.length >= 4 && (target.includes(name) || name.includes(target));
      });
      if (hit) {
        this.scopedDomains = domains.filter((d) => d.customerId === hit.customerId);
        return true;
      }
    }

    this.scopedDomains = [];
    return false;
  }

  private async getScopedUsers(): Promise<SpanningUser[]> {
    if (this.scopedUsers) return this.scopedUsers;
    const users: SpanningUser[] = [];
    this.failedDomains = [];
    for (const domain of this.scopedDomains.slice(0, 3)) {
      try {
        const data = await this.request<unknown>(`/v2/spanning/domains/${domain.id}/users?page_size=1000`);
        const record = data as Record<string, unknown>;
        const list = Array.isArray(data) ? data : (record.users ?? record.items ?? []);
        for (const user of list as Record<string, unknown>[]) {
          users.push({ ...user, domainName: domain.name } as SpanningUser);
        }
      } catch (error) {
        // A failed domain must be surfaced — its users are absent from the
        // counts, which would otherwise read as "0 failed users" (healthy)
        this.failedDomains.push(domain.name ?? domain.id);
        console.warn(`[SPANNING] users fetch failed for ${domain.name}:`, error);
      }
    }
    this.scopedUsers = users;
    return users;
  }

  // ── Meredith's consumption surface ──────────────────────────────────

  async getTenantInfo(): Promise<SpanningTenant> {
    const domain = this.scopedDomains[0];
    if (!domain) throw new Error("No Spanning domain resolved for this client");
    return {
      companyName: domain.name,
      domain: domain.name,
      region: domain.region as string | undefined,
      allDomains: this.scopedDomains.map((d) => d.name),
    };
  }

  async getTenantStatus(): Promise<SpanningTenantStatus> {
    const totals = this.scopedDomains.reduce(
      (acc, d) => ({
        users: acc.users + (d.numberOfUsers ?? 0),
        protectedUsers: acc.protectedUsers + (d.numberOfProtectedStandardUsers ?? 0),
        licenses: acc.licenses + (d.numberOfStandardLicensesTotal ?? 0),
      }),
      { users: 0, protectedUsers: 0, licenses: 0 },
    );
    return {
      totalUsers: totals.users,
      totalProtectedUsers: totals.protectedUsers,
      licensesTotal: totals.licenses,
      lastBackup: this.scopedDomains[0]?.lastBackup as string | undefined,
    };
  }

  async getBackupSummary(): Promise<SpanningBackupSummary> {
    const users = await this.getScopedUsers();
    const failed = users.filter((u) => u.lastBackupStatusTotal === "failed");
    return {
      statusLastSevenDays: this.scopedDomains[0]?.backupStatusLastSevenDays,
      lastBackup: this.scopedDomains[0]?.lastBackup as string | undefined,
      failedUsers: failed.length,
      totalUsers: users.length,
      domainsFailed: [...this.failedDomains],
    };
  }

  /**
   * "Errors" = users whose most recent backup failed, per service.
   */
  async getRecentErrors(count: number = 20): Promise<ReadonlyArray<SpanningError>> {
    const users = await this.getScopedUsers();
    const errors: SpanningError[] = [];
    for (const user of users) {
      if (user.lastBackupStatusTotal !== "failed") continue;
      const perService = (user.lastBackupStatus ?? {}) as Record<string, string>;
      const failedServices = Object.entries(perService)
        .filter(([, status]) => status === "failed" || status === "error")
        .map(([service]) => service.replace(/^lastFor/, ""));
      errors.push({
        errorCode: "BACKUP_FAILED",
        userEmail: (user.email ?? user.userPrincipalName) as string | undefined,
        service: failedServices.join(", ") || "unknown",
        message: `Last backup failed${failedServices.length ? ` for ${failedServices.join(", ")}` : ""}`,
        timestamp: user.lastBackupTimestampTotal as string | undefined,
      });
      if (errors.length >= count) break;
    }
    return errors;
  }

  async searchUserByEmail(email: string): Promise<SpanningUser | null> {
    const users = await this.getScopedUsers();
    const lower = email.toLowerCase();
    return (
      users.find((u) => String(u.email ?? u.userPrincipalName ?? "").toLowerCase() === lower) ??
      null
    );
  }

  async getUserBackupSummary(userPrincipalName: string): Promise<SpanningUserBackup | null> {
    const user = await this.searchUserByEmail(userPrincipalName);
    if (!user) return null;
    return {
      status: user.lastBackupStatusTotal as string | undefined,
      lastBackup: user.lastBackupTimestampTotal as string | undefined,
      perService: (user.lastBackupStatus ?? {}) as Record<string, string>,
      storage: user.storageInformation,
    };
  }
}
