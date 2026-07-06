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
  // Cove returns visa at the top level of the envelope, not inside result
  readonly visa?: string;
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
  private partnerId: number | null = null;

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

    const data = (await res.json()) as JsonRpcResponse<{ PartnerId?: number }>;
    if (data.error) {
      throw new Error(`Cove login error: ${data.error.message}`);
    }

    const visa = data.visa ?? data.result?.visa;
    if (!visa) {
      throw new Error("Cove login: no visa token returned");
    }

    const partnerId = data.result?.result?.PartnerId;
    if (typeof partnerId === "number") {
      this.partnerId = partnerId;
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
        // Visa rides at the top level of the envelope — inside params the
        // API rejects it as "Visa is inconsistent/corrupted"
        visa: this.visa,
        method,
        params,
        id: method,
      }),
    });

    if (!res.ok) {
      throw new Error(`Cove API ${method} HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as JsonRpcResponse<T>;

    // Update visa if refreshed (top-level on real responses)
    const refreshedVisa = data.visa ?? data.result?.visa;
    if (refreshedVisa) {
      this.visa = refreshedVisa;
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
    // EnumeratePartners requires the authenticated partner's id as the
    // parent — with empty params the API fails "security reasons"
    if (!this.partnerId) {
      await this.login();
    }
    return this.call<ReadonlyArray<CovePartner>>("EnumeratePartners", {
      parentPartnerId: this.partnerId,
      fields: [0, 1],
    });
  }

  /**
   * Get all backup devices for a specific partner/customer account.
   */
  async getDevices(partnerId: number): Promise<ReadonlyArray<CoveDevice>> {
    const rows = await this.call<ReadonlyArray<Record<string, unknown>>>("EnumerateAccountStatistics", {
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
    return (rows ?? []).map(normalizeCoveRow);
  }

  /**
   * Get devices across all partners (for customer name matching).
   */
  async getAllDevices(): Promise<ReadonlyArray<CoveDevice>> {
    const rows = await this.call<ReadonlyArray<Record<string, unknown>>>("EnumerateAccountStatistics", {
      query: {
        StartRecordNumber: 0,
        RecordsCount: 500,
        Columns: ["AR", "AN", "MN", "OT", "CV", "TS", "LSS", "LSD", "LST", "US", "SS", "DS", "ER"],
      },
    });
    return (rows ?? []).map(normalizeCoveRow);
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

// ── Row normalizer ───────────────────────────────────────────────────
// EnumerateAccountStatistics returns rows as {Settings: [{"AN": ...}, {"AR": ...}]}
// — a LIST of single-key objects keyed by column code, not the flat
// friendly-named object the rest of the code consumes. Flatten + rename.

const COVE_COLUMN_NAMES: Record<string, string> = {
  AR: "CustomerName",
  AN: "AccountName",
  MN: "MachineName",
  OT: "OsType",
  CV: "ClientVersion",
  TS: "TimeStamp",
  LSS: "LastSessionStatus",
  LSD: "LastSessionTimestamp",
  LST: "LastSuccessfulSessionTimestamp",
  US: "UsedStorage",
  SS: "SelectedSize",
  DS: "DataSources",
  ER: "Errors",
};

// LastSessionStatus numeric codes per N-able docs
const COVE_SESSION_STATUS: Record<string, string> = {
  "0": "NoBackup",
  "1": "InProcess",
  "2": "Failed",
  "3": "Aborted",
  "5": "Completed",
  "6": "Interrupted",
  "7": "NotStarted",
  "8": "CompletedWithErrors",
  "9": "InProgressWithFaults",
  "10": "OverQuota",
  "11": "NoSelection",
  "12": "Restarted",
};

function normalizeCoveRow(row: Record<string, unknown>): CoveDevice {
  const flat: Record<string, unknown> = {};
  const settings = row.Settings;
  if (Array.isArray(settings)) {
    for (const entry of settings) {
      if (entry && typeof entry === "object") {
        for (const [code, value] of Object.entries(entry as Record<string, unknown>)) {
          flat[COVE_COLUMN_NAMES[code] ?? code] = value;
        }
      }
    }
  } else {
    Object.assign(flat, row);
  }
  // Aliases for consumers that use the older field names
  if (flat.MachineName && !flat.ComputerName) flat.ComputerName = flat.MachineName;
  if (!flat.DeviceName) flat.DeviceName = flat.MachineName ?? flat.AccountName ?? "";
  if (!flat.Status && flat.LastSessionStatus !== undefined) flat.Status = flat.LastSessionStatus;
  const lss = flat.LastSessionStatus;
  if (lss !== undefined && COVE_SESSION_STATUS[String(lss)]) {
    flat.LastSessionStatus = COVE_SESSION_STATUS[String(lss)];
  }
  return flat as unknown as CoveDevice;
}
