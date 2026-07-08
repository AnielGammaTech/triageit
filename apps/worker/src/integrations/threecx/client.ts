import type { ThreeCxConfig } from "@triageit/shared";

/**
 * ThreeCxClient — Queries 3CX phone system API.
 *
 * Used by Kelly Kapoor to pull system status, extensions,
 * trunk configurations, active calls, and SIP logs.
 *
 * 3CX V18/V20 uses a REST API with token-based auth.
 *
 * Accuracy contract: list methods return [] only for a successful empty
 * response, and null when the LOOKUP FAILED (auth/network/API error) —
 * callers must treat null as "could not check", NEVER as "no issues".
 */
export class ThreeCxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private token: string | null = null;

  constructor(config: ThreeCxConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Try API key first, then token auth
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `3CX API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── System Status ──────────────────────────────────────────────────

  async getSystemStatus(): Promise<ThreeCxSystemStatus> {
    return this.request<ThreeCxSystemStatus>("/api/SystemStatus");
  }

  // ── Trunks ─────────────────────────────────────────────────────────

  async getTrunks(): Promise<ReadonlyArray<ThreeCxTrunk>> {
    const result = await this.request<{ list?: ThreeCxTrunk[]; value?: ThreeCxTrunk[] }>(
      "/api/TrunkList",
    );
    return result.list ?? result.value ?? [];
  }

  async getTrunkStatus(): Promise<ReadonlyArray<ThreeCxTrunkStatus> | null> {
    try {
      const result = await this.request<{ list?: ThreeCxTrunkStatus[]; value?: ThreeCxTrunkStatus[] }>(
        "/api/TrunkRegistrarStatus",
      );
      return result.list ?? result.value ?? [];
    } catch {
      return null;
    }
  }

  // ── Extensions ─────────────────────────────────────────────────────

  async getExtensions(): Promise<ReadonlyArray<ThreeCxExtension>> {
    const result = await this.request<{ list?: ThreeCxExtension[]; value?: ThreeCxExtension[] }>(
      "/api/ExtensionList",
    );
    return result.list ?? result.value ?? [];
  }

  async searchExtension(
    query: string,
  ): Promise<ReadonlyArray<ThreeCxExtension>> {
    const extensions = await this.getExtensions();
    const lower = query.toLowerCase();
    return extensions.filter(
      (e) =>
        e.Number?.toLowerCase().includes(lower) ||
        e.Name?.toLowerCase().includes(lower) ||
        e.FirstName?.toLowerCase().includes(lower) ||
        e.LastName?.toLowerCase().includes(lower),
    );
  }

  // ── Active Calls ───────────────────────────────────────────────────

  async getActiveCalls(): Promise<ReadonlyArray<ThreeCxActiveCall> | null> {
    try {
      const result = await this.request<{ list?: ThreeCxActiveCall[]; value?: ThreeCxActiveCall[] }>(
        "/api/activeCalls",
      );
      return result.list ?? result.value ?? [];
    } catch {
      return null;
    }
  }

  // ── Call Logs ──────────────────────────────────────────────────────

  async getCallLogs(params?: {
    readonly count?: number;
    readonly filter?: string;
  }): Promise<ReadonlyArray<ThreeCxCallLog> | null> {
    const queryParams: Record<string, string> = {};
    if (params?.count) queryParams.count = String(params.count);
    if (params?.filter) queryParams.$filter = params.filter;

    try {
      const result = await this.request<{ list?: ThreeCxCallLog[]; value?: ThreeCxCallLog[] }>(
        "/api/CallLog",
        queryParams,
      );
      return result.list ?? result.value ?? [];
    } catch {
      return null;
    }
  }

  // ── DIDs / Inbound Rules ───────────────────────────────────────────

  async getInboundRules(): Promise<ReadonlyArray<ThreeCxInboundRule> | null> {
    try {
      const result = await this.request<{ list?: ThreeCxInboundRule[]; value?: ThreeCxInboundRule[] }>(
        "/api/InboundRulesList",
      );
      return result.list ?? result.value ?? [];
    } catch {
      return null;
    }
  }

  // ── Search helpers ──────────────────────────────────────────────────

  async findTrunkByName(name: string): Promise<ThreeCxTrunk | null> {
    const trunks = await this.getTrunks();
    const lower = name.toLowerCase();
    return (
      trunks.find(
        (t) =>
          t.Name?.toLowerCase().includes(lower) ||
          t.ProviderName?.toLowerCase().includes(lower),
      ) ?? null
    );
  }

  async findDid(did: string): Promise<ThreeCxInboundRule | null> {
    const rules = await this.getInboundRules();
    // null = rule lookup failed — can't say the DID isn't configured
    if (rules === null) return null;
    const normalized = did.replace(/\D/g, "");
    return (
      rules.find(
        (r) =>
          r.DID?.replace(/\D/g, "").includes(normalized) ||
          r.Name?.includes(did),
      ) ?? null
    );
  }
}

// ── 3CX Types ───────────────────────────────────────────────────────

export interface ThreeCxSystemStatus {
  readonly Version?: string;
  readonly Activated?: boolean;
  readonly MaxSimCalls?: number;
  readonly MaxSimMeetingParticipants?: number;
  readonly CallHistoryCount?: number;
  readonly ChatMessagesCount?: number;
  readonly ExtensionsRegistered?: number;
  readonly TrunksRegistered?: number;
  readonly TrunksTotal?: number;
  readonly HasUnregisteredSystemExtensions?: boolean;
  readonly HasNotRunningServices?: boolean;
  readonly Ip?: string;
  readonly FQDN?: string;
  readonly CurrentLocalTime?: string;
  readonly [key: string]: unknown;
}

export interface ThreeCxTrunk {
  readonly Id?: number;
  readonly Name?: string;
  readonly ProviderName?: string;
  readonly Host?: string;
  readonly Port?: number;
  readonly Type?: string;
  readonly NumberOfSimCalls?: number;
  readonly RegistrarStatus?: string;
  readonly IsRegistered?: boolean;
  readonly ExternalNumber?: string;
  readonly [key: string]: unknown;
}

export interface ThreeCxTrunkStatus {
  readonly TrunkId?: number;
  readonly TrunkName?: string;
  readonly Status?: string;
  readonly RegistrarStatus?: string;
  readonly IsRegistered?: boolean;
  readonly LastError?: string;
  readonly [key: string]: unknown;
}

export interface ThreeCxExtension {
  readonly Id?: number;
  readonly Number?: string;
  readonly Name?: string;
  readonly FirstName?: string;
  readonly LastName?: string;
  readonly Email?: string;
  readonly IsRegistered?: boolean;
  readonly CurrentProfile?: string;
  readonly QueueStatus?: string;
  readonly [key: string]: unknown;
}

export interface ThreeCxActiveCall {
  readonly Id?: number;
  readonly Caller?: string;
  readonly Callee?: string;
  readonly Status?: string;
  readonly Duration?: string;
  readonly LastChangeTime?: string;
  readonly [key: string]: unknown;
}

export interface ThreeCxCallLog {
  readonly Id?: number;
  readonly CallTime?: string;
  readonly From?: string;
  readonly To?: string;
  readonly Duration?: string;
  readonly Status?: string;
  readonly TalkingDur?: string;
  readonly RingDur?: string;
  readonly Reason?: string;
  readonly Segments?: ReadonlyArray<{
    readonly From?: string;
    readonly To?: string;
    readonly Duration?: string;
    readonly Status?: string;
  }>;
  readonly [key: string]: unknown;
}

export interface ThreeCxInboundRule {
  readonly Id?: number;
  readonly Name?: string;
  readonly DID?: string;
  readonly Trunk?: string;
  readonly Destination?: string;
  readonly DestinationType?: string;
  readonly [key: string]: unknown;
}
