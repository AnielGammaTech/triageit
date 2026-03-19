/**
 * Cove Data Protection (N-able Backup) — JSON-RPC API Client
 *
 * Uses the JSON-RPC API at https://api.backup.management/jsonapi
 * Authentication: Login → visa token → subsequent calls
 */

export interface CoveDevice {
  readonly AccountId: number;
  readonly AccountName: string;
  readonly ComputerName: string;
  readonly OsType: string;
  readonly ClientVersion: string;
  readonly MachineName: string;
  readonly TimeStamp: string;
  readonly LastSessionStatus: string;
  readonly LastSessionTimestamp: string;
  readonly LastSuccessfulSessionTimestamp: string;
  readonly SelectedSize: number;
  readonly UsedStorage: number;
  readonly DataSources: string;
  readonly Errors: string | null;
  readonly [key: string]: unknown;
}

export interface CovePartner {
  readonly Id: number;
  readonly Name: string;
  readonly Level: number;
  readonly [key: string]: unknown;
}

interface JsonRpcResponse<T> {
  readonly jsonrpc: string;
  readonly id: string;
  readonly result?: {
    readonly result?: T;
    readonly visa?: string;
    readonly [key: string]: unknown;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

export class CoveClient {
  private readonly apiUrl = "https://api.backup.management/jsonapi";
  private readonly partnerName: string;
  private readonly username: string;
  private readonly apiToken: string;
  private visa: string | null = null;

  constructor(config: {
    readonly partner_name: string;
    readonly api_username: string;
    readonly api_token: string;
  }) {
    this.partnerName = config.partner_name;
    this.username = config.api_username;
    this.apiToken = config.api_token;
  }

  /**
   * Authenticate and get a visa token for subsequent calls.
   */
  async login(): Promise<string> {
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "Login",
        params: {
          partner: this.partnerName,
          username: this.username,
          password: this.apiToken,
        },
        id: "login",
      }),
    });

    if (!res.ok) {
      throw new Error(`Cove login HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as JsonRpcResponse<{ visa: string }>;
    if (data.error) {
      throw new Error(`Cove login error: ${data.error.message}`);
    }

    const visa = data.result?.visa;
    if (!visa) {
      throw new Error("Cove login: no visa token returned");
    }

    this.visa = visa;
    return visa;
  }

  /**
   * Call a JSON-RPC method with the current visa.
   */
  private async call<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.visa) {
      await this.login();
    }

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: { ...params, visa: this.visa },
        id: method,
      }),
    });

    if (!res.ok) {
      throw new Error(`Cove API ${method} HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as JsonRpcResponse<T>;

    // Update visa if refreshed
    if (data.result?.visa) {
      this.visa = data.result.visa;
    }

    if (data.error) {
      throw new Error(`Cove API ${method} error: ${data.error.message}`);
    }

    return data.result?.result as T;
  }

  /**
   * Get all partner/customer accounts.
   */
  async getPartners(): Promise<ReadonlyArray<CovePartner>> {
    return this.call<ReadonlyArray<CovePartner>>("EnumeratePartners");
  }

  /**
   * Get all backup devices for a specific partner/customer account.
   */
  async getDevices(partnerId: number): Promise<ReadonlyArray<CoveDevice>> {
    return this.call<ReadonlyArray<CoveDevice>>("EnumerateAccountStatistics", {
      query: {
        PartnerId: partnerId,
        StartRecordNumber: 0,
        RecordsCount: 500,
        Columns: [
          "AR", // AccountId
          "AN", // AccountName
          "MN", // MachineName
          "OT", // OsType
          "CV", // ClientVersion
          "TS", // TimeStamp
          "LSS", // LastSessionStatus
          "LSD", // LastSessionTimestamp
          "LST", // LastSuccessfulSessionTimestamp
          "US", // UsedStorage
          "SS", // SelectedSize
          "DS", // DataSources
          "ER", // Errors
        ],
      },
    });
  }

  /**
   * Get devices across all partners (for customer name matching).
   */
  async getAllDevices(): Promise<ReadonlyArray<CoveDevice>> {
    return this.call<ReadonlyArray<CoveDevice>>("EnumerateAccountStatistics", {
      query: {
        StartRecordNumber: 0,
        RecordsCount: 500,
        Columns: ["AR", "AN", "MN", "OT", "CV", "TS", "LSS", "LSD", "LST", "US", "SS", "DS", "ER"],
      },
    });
  }

  /**
   * Find partner by name (fuzzy).
   */
  async findPartnerByName(name: string): Promise<CovePartner | null> {
    const partners = await this.getPartners();
    const lower = name.toLowerCase();

    // Exact match first
    const exact = partners.find((p) => p.Name.toLowerCase() === lower);
    if (exact) return exact;

    // Partial match
    const partial = partners.find(
      (p) =>
        p.Name.toLowerCase().includes(lower) ||
        lower.includes(p.Name.toLowerCase()),
    );
    return partial ?? null;
  }
}
