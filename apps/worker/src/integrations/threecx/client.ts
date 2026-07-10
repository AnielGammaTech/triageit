import type { ThreeCxConfig } from "@triageit/shared";
import { getThreeCxToken, invalidateThreeCxToken } from "./token-manager.js";

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

  constructor(config: ThreeCxConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
    this.apiKey = config.api_key;
    this.clientId = config.client_id ?? null;
    this.clientSecret = config.client_secret ?? null;
  }

  /**
   * V20 XAPI auth via the PROCESS-WIDE token manager — 3CX keeps one live
   * token per API client and a mint invalidates the previous token
   * (verified live 2026-07-09), so private per-instance caches made every
   * 3CX consumer in the worker fight the others (the voice websocket
   * dropped whenever a cron minted, and vice versa).
   */
  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      // Legacy mode — the raw api_key is used as the bearer directly
      return this.apiKey;
    }
    return getThreeCxToken(this.baseUrl, this.clientId, this.clientSecret, { forceRefresh });
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

    const attempt = async (force: boolean) =>
      fetch(url.toString(), {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await this.getAccessToken(force)}`,
        },
        signal: AbortSignal.timeout(30_000),
      });

    let response = await attempt(false);
    // 401 = our token was superseded by a mint outside this process —
    // refresh once and retry
    if (response.status === 401 && this.clientId) {
      invalidateThreeCxToken(this.baseUrl, this.clientId);
      response = await attempt(true);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `3CX API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  /** All extension users (Number + name) — used to ring a tech by name. */
  async listExtensions(): Promise<ReadonlyArray<{ number: string; name: string }>> {
    const result = await this.request<{ value?: Array<{ Number?: string; FirstName?: string; LastName?: string }> }>(
      "/xapi/v1/Users",
      { "$select": "Number,FirstName,LastName", "$top": "100" },
    );
    return (result.value ?? [])
      .filter((u) => u.Number && /^\d{2,5}$/.test(u.Number))
      .map((u) => ({ number: String(u.Number), name: [u.FirstName, u.LastName].filter(Boolean).join(" ").trim() }));
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
    // V20 exposes XAPI /xapi/v1/ActiveCalls; the legacy /api/activeCalls
    // 404s there (verified live 2026-07-10) — try XAPI first.
    try {
      const result = await this.request<{ value?: ThreeCxActiveCall[] }>(
        "/xapi/v1/ActiveCalls",
      );
      return result.value ?? [];
    } catch {
      // fall through to the legacy endpoint
    }
    try {
      const result = await this.request<{ list?: ThreeCxActiveCall[]; value?: ThreeCxActiveCall[] }>(
        "/api/activeCalls",
      );
      return result.list ?? result.value ?? [];
    } catch {
      return null;
    }
  }

  /**
   * Per-user phone presence from XAPI: extension, registration, and the
   * 3CX profile status (Available / Away / Do Not Disturb / ...).
   * Verified live 2026-07-10 — the legacy /api/ExtensionList 404s on V20.
   */
  async listUsersPresence(): Promise<ReadonlyArray<ThreeCxUserPresence>> {
    const result = await this.request<{
      value?: Array<{
        Number?: string;
        FirstName?: string;
        LastName?: string;
        IsRegistered?: boolean;
        CurrentProfileName?: string;
      }>;
    }>("/xapi/v1/Users", {
      "$select": "Number,FirstName,LastName,IsRegistered,CurrentProfileName",
      "$top": "100",
    });
    return (result.value ?? [])
      .filter((u) => u.Number && /^\d{2,5}$/.test(u.Number))
      .map((u) => ({
        number: String(u.Number),
        name: [u.FirstName, u.LastName].filter(Boolean).join(" ").trim(),
        isRegistered: typeof u.IsRegistered === "boolean" ? u.IsRegistered : null,
        profileName: u.CurrentProfileName ?? null,
      }));
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

export interface ThreeCxUserPresence {
  readonly number: string;
  readonly name: string;
  readonly isRegistered: boolean | null;
  readonly profileName: string | null;
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
