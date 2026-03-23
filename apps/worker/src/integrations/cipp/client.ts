import type { CippConfig } from "@triageit/shared";

/**
 * CIPPClient — Queries the CyberDrain Improved Partner Portal API.
 *
 * Uses OAuth2 client credentials flow to authenticate against
 * the CIPP Azure Functions backend. Provides M365 tenant data:
 * users, mailboxes, MFA status, licenses, conditional access,
 * device compliance, and tenant alerts.
 *
 * Used by Darryl Philbin to pull real Microsoft 365 data per client.
 */

interface OAuthToken {
  readonly access_token: string;
  readonly expires_in: number;
}

export interface CippUser {
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly accountEnabled: boolean;
  readonly mail: string | null;
  readonly assignedLicenses: ReadonlyArray<{ skuId: string }>;
  readonly onPremisesSyncEnabled: boolean | null;
  readonly createdDateTime: string | null;
  readonly lastSignInDateTime?: string | null;
}

export interface CippMailbox {
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly recipientType: string;
  readonly recipientTypeDetails: string;
  readonly primarySmtpAddress: string;
  readonly forwardingAddress?: string | null;
  readonly forwardingSmtpAddress?: string | null;
}

export interface CippMfaStatus {
  readonly userPrincipalName: string;
  readonly displayName: string;
  readonly accountEnabled: boolean;
  readonly perUser: string;
  readonly mfaMethods: ReadonlyArray<string>;
  readonly coveredByCA: string;
  readonly coveredBySD: boolean;
}

export interface CippDevice {
  readonly displayName: string;
  readonly deviceName: string;
  readonly complianceState: string;
  readonly operatingSystem: string;
  readonly osVersion: string;
  readonly lastSyncDateTime: string | null;
  readonly userPrincipalName: string | null;
}

export interface CippConditionalAccessPolicy {
  readonly displayName: string;
  readonly state: string;
  readonly conditions: Record<string, unknown>;
  readonly grantControls: Record<string, unknown> | null;
}

export interface CippAlert {
  readonly title: string;
  readonly severity: string;
  readonly category: string;
  readonly status: string;
  readonly createdDateTime: string;
  readonly tenantId: string;
}

export class CippClient {
  private readonly config: CippConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: CippConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.cippAuthClientId,
      client_secret: this.config.cippAuthClientSecret,
      scope: this.config.cippAuthScope,
    });

    const response = await fetch(this.config.cippAuthTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CIPP OAuth failed (${response.status}): ${text}`);
    }

    const token = (await response.json()) as OAuthToken;
    this.accessToken = token.access_token;
    this.tokenExpiry = Date.now() + token.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.authenticate();

    const baseUrl = this.config.cippApiUrl.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}/api${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CIPP API error ${response.status} on ${path}: ${text.slice(0, 500)}`);
    }

    return response.json() as Promise<T>;
  }

  /** List all tenants managed in CIPP */
  async listTenants(): Promise<ReadonlyArray<{ customerId: string; displayName: string; defaultDomainName: string }>> {
    return this.request("/ListTenants");
  }

  /** Get users for a tenant */
  async getUsers(tenantFilter: string): Promise<ReadonlyArray<CippUser>> {
    return this.request("/ListUsers", { TenantFilter: tenantFilter });
  }

  /** Get mailboxes for a tenant */
  async getMailboxes(tenantFilter: string): Promise<ReadonlyArray<CippMailbox>> {
    return this.request("/ListMailboxes", { TenantFilter: tenantFilter });
  }

  /** Get MFA status per user for a tenant */
  async getMfaStatus(tenantFilter: string): Promise<ReadonlyArray<CippMfaStatus>> {
    return this.request("/ListMFAUsers", { TenantFilter: tenantFilter });
  }

  /** Get device compliance for a tenant */
  async getDevices(tenantFilter: string): Promise<ReadonlyArray<CippDevice>> {
    return this.request("/ListDevices", { TenantFilter: tenantFilter });
  }

  /** Get conditional access policies for a tenant */
  async getConditionalAccess(tenantFilter: string): Promise<ReadonlyArray<CippConditionalAccessPolicy>> {
    return this.request("/ListConditionalAccessPolicies", { TenantFilter: tenantFilter });
  }

  /** Get recent alerts for a tenant */
  async getAlerts(tenantFilter: string): Promise<ReadonlyArray<CippAlert>> {
    return this.request("/ListAlertsQueue", { TenantFilter: tenantFilter });
  }

  /** Health check — verifies auth and basic API access */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listTenants();
      return true;
    } catch {
      return false;
    }
  }

  /** Find a user by email or UPN within a tenant */
  async findUser(tenantFilter: string, email: string): Promise<CippUser | null> {
    try {
      const users = await this.getUsers(tenantFilter);
      const emailLower = email.toLowerCase();
      return users.find((u) =>
        u.userPrincipalName.toLowerCase() === emailLower ||
        u.mail?.toLowerCase() === emailLower,
      ) ?? null;
    } catch {
      return null;
    }
  }

  /** Find MFA status for a specific user */
  async findUserMfa(tenantFilter: string, email: string): Promise<CippMfaStatus | null> {
    try {
      const mfaList = await this.getMfaStatus(tenantFilter);
      const emailLower = email.toLowerCase();
      return mfaList.find((m) =>
        m.userPrincipalName.toLowerCase() === emailLower,
      ) ?? null;
    } catch {
      return null;
    }
  }
}
