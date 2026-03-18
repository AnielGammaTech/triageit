import type { JumpCloudConfig } from "@triageit/shared";

/**
 * JumpCloudClient — Queries JumpCloud for identity & access data.
 *
 * Used by Jim Halpert to pull real user accounts, MFA status,
 * device associations, group memberships, and system info.
 */
export class JumpCloudClient {
  private static readonly BASE_URL = "https://console.jumpcloud.com/api";
  private static readonly V2_URL = "https://console.jumpcloud.com/api/v2";
  private readonly apiKey: string;

  constructor(config: JumpCloudConfig) {
    this.apiKey = config.api_key;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `JumpCloud API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── Users ─────────────────────────────────────────────────────────

  async getUsers(limit = 100): Promise<ReadonlyArray<JumpCloudUser>> {
    const result = await this.request<{ results: JumpCloudUser[] }>(
      JumpCloudClient.BASE_URL,
      "/systemusers",
      { limit: String(limit) },
    );
    return result.results ?? [];
  }

  async getUser(userId: string): Promise<JumpCloudUser> {
    return this.request<JumpCloudUser>(
      JumpCloudClient.BASE_URL,
      `/systemusers/${userId}`,
    );
  }

  async searchUsers(query: string): Promise<ReadonlyArray<JumpCloudUser>> {
    const users = await this.getUsers(200);
    const lower = query.toLowerCase();
    return users.filter(
      (u) =>
        u.username?.toLowerCase().includes(lower) ||
        u.email?.toLowerCase().includes(lower) ||
        u.displayname?.toLowerCase().includes(lower) ||
        u.firstname?.toLowerCase().includes(lower) ||
        u.lastname?.toLowerCase().includes(lower),
    );
  }

  // ── Systems (Devices) ─────────────────────────────────────────────

  async getSystems(limit = 100): Promise<ReadonlyArray<JumpCloudSystem>> {
    const result = await this.request<{ results: JumpCloudSystem[] }>(
      JumpCloudClient.BASE_URL,
      "/systems",
      { limit: String(limit) },
    );
    return result.results ?? [];
  }

  async searchSystems(query: string): Promise<ReadonlyArray<JumpCloudSystem>> {
    const systems = await this.getSystems(200);
    const lower = query.toLowerCase();
    return systems.filter(
      (s) =>
        s.hostname?.toLowerCase().includes(lower) ||
        s.displayName?.toLowerCase().includes(lower),
    );
  }

  // ── User Groups ───────────────────────────────────────────────────

  async getUserGroups(): Promise<ReadonlyArray<JumpCloudGroup>> {
    return this.request<JumpCloudGroup[]>(
      JumpCloudClient.V2_URL,
      "/usergroups",
      { limit: "100" },
    );
  }

  async getUserGroupMembership(
    userId: string,
  ): Promise<ReadonlyArray<JumpCloudGroup>> {
    return this.request<JumpCloudGroup[]>(
      JumpCloudClient.V2_URL,
      `/users/${userId}/memberof`,
      { limit: "100" },
    );
  }

  // ── User Devices (bound systems) ──────────────────────────────────

  async getUserSystems(
    userId: string,
  ): Promise<ReadonlyArray<JumpCloudSystemBinding>> {
    return this.request<JumpCloudSystemBinding[]>(
      JumpCloudClient.V2_URL,
      `/users/${userId}/systems`,
      { limit: "100" },
    );
  }
}

// ── JumpCloud Types ───────────────────────────────────────────────────

export interface JumpCloudUser {
  readonly _id?: string;
  readonly id?: string;
  readonly username?: string;
  readonly email?: string;
  readonly displayname?: string;
  readonly firstname?: string;
  readonly lastname?: string;
  readonly activated?: boolean;
  readonly suspended?: boolean;
  readonly account_locked?: boolean;
  readonly mfa?: {
    readonly configured?: boolean;
    readonly exclusion?: boolean;
    readonly exclusionUntil?: string;
  };
  readonly totp_enabled?: boolean;
  readonly enable_user_portal_multifactor?: boolean;
  readonly state?: string;
  readonly created?: string;
  readonly lastLogin?: string;
  readonly passwordExpirationDate?: string;
  readonly password_expired?: boolean;
  readonly [key: string]: unknown;
}

export interface JumpCloudSystem {
  readonly _id?: string;
  readonly id?: string;
  readonly hostname?: string;
  readonly displayName?: string;
  readonly os?: string;
  readonly osFamily?: string;
  readonly version?: string;
  readonly arch?: string;
  readonly active?: boolean;
  readonly lastContact?: string;
  readonly serialNumber?: string;
  readonly remoteIP?: string;
  readonly agentVersion?: string;
  readonly [key: string]: unknown;
}

export interface JumpCloudGroup {
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface JumpCloudSystemBinding {
  readonly id?: string;
  readonly type?: string;
  readonly [key: string]: unknown;
}
