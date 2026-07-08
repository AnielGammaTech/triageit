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
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: ThreeCxConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
    this.apiKey = config.api_key;
    this.clientId = config.client_id ?? null;
    this.clientSecret = config.client_secret ?? null;
  }

  /**
   * V20 XAPI auth: exchange the service-principal client_id/client_secret
   * for a bearer token at /connect/token (verified live on
   * gammatech.fl.3cx.us 2026-07-08). Tokens last 3600s; refresh at 50 min.
   */
  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (!this.clientId || !this.clientSecret) {
      // Legacy mode — the raw api_key is used as the bearer directly
      return this.apiKey;
    }

    const res = await fetch(`${this.baseUrl}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`3CX token exchange failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("3CX token exchange returned no access_token");
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + Math.min((data.expires_in ?? 3600) - 600, 3000) * 1000;
    return this.token;
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
      Authorization: `Bearer ${await this.getAccessToken()}`,
    };

    const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(30_000) });

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

  // ── Recordings (V20 XAPI — includes built-in transcription) ────────

  /**
   * Recordings newer than the given Id, oldest first. Each row carries the
   * transcript inline (3CX transcribes calls within minutes). Returns null
   * when the LOOKUP FAILED — never "no calls".
   */
  async getRecordingsSince(minId: number, top = 50): Promise<ReadonlyArray<ThreeCxRecording> | null> {
    try {
      const result = await this.request<{ value?: ThreeCxRecording[] }>(
        "/xapi/v1/Recordings",
        {
          $filter: `Id gt ${Math.floor(minId)}`,
          $orderby: "Id asc",
          $top: String(top),
        },
      );
      return result.value ?? [];
    } catch (error) {
      console.warn("[3CX] getRecordingsSince failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** Highest recording Id on the PBX (cursor seed). Null = lookup failed. */
  async getMaxRecordingId(): Promise<number | null> {
    try {
      const result = await this.request<{ value?: ThreeCxRecording[] }>(
        "/xapi/v1/Recordings",
        { $orderby: "Id desc", $top: "1" },
      );
      return result.value?.[0]?.Id ?? 0;
    } catch (error) {
      console.warn("[3CX] getMaxRecordingId failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

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

export interface ThreeCxRecording {
  readonly Id: number;
  readonly CallType?: string;
  readonly StartTime?: string;
  readonly EndTime?: string;
  readonly FromCallerNumber?: string;
  readonly ToCallerNumber?: string;
  readonly FromDisplayName?: string;
  readonly ToDisplayName?: string;
  readonly FromDn?: string;
  readonly ToDn?: string;
  readonly FromDnType?: number | string;
  readonly ToDnType?: number | string;
  readonly RecordingUrl?: string;
  readonly IsTranscribed?: boolean;
  readonly Transcription?: string;
  readonly Summary?: string;
  readonly SentimentScore?: number;
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
