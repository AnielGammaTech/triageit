import WebSocket from "ws";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import type { ClientRequest } from "node:http";
import type { ThreeCxConfig } from "@triageit/shared";

/**
 * Thin 3CX Call Control API client (V20).
 *
 * Endpoints confirmed against the official docs
 * (https://www.3cx.com/docs/call-control-api-endpoints/) and the official
 * TypeScript examples (github.com/3cx/call-control-examples):
 *
 * - Auth: POST /connect/token (client_credentials) → Bearer token, same
 *   exchange as ThreeCxClient.getAccessToken (private there, so copied).
 * - Events: WSS GET /callcontrol/ws with `Authorization: Bearer <token>`
 *   header. Messages: { sequence, event: { event_type, entity,
 *   attached_data } } where event_type 0=Upsert, 1=Remove, 2=DTMFstring
 *   (digits in attached_data.dtmf_input), 3=PromptPlaybackFinished,
 *   4=Response. Entity is a path like /callcontrol/{dn}/participants/{id}.
 * - State: GET /callcontrol/{dn}/participants/{id} → CallParticipant.
 * - Actions: POST /callcontrol/{dn}/participants/{id}/{action} with
 *   action "answer" (valid for RoutePoint participants) or "drop".
 * - Audio: GET /callcontrol/{dn}/participants/{id}/stream (caller → app)
 *   and chunked POST to the same path (app → caller), both raw PCM
 *   16-bit 8000 Hz mono at ~128 kbps.
 */

export interface CallControlParticipant {
  readonly id?: number;
  readonly status?: string | null; // "Ringing" | "Connected" | "Dialing" | ...
  readonly dn?: string | null;
  readonly party_caller_id?: string | null;
  readonly party_caller_name?: string | null;
  readonly party_dn?: string | null;
  readonly callid?: number;
  readonly [key: string]: unknown;
}

export interface CallControlEvent {
  readonly eventType: number;
  readonly entity: string;
  readonly dtmfInput: string | null;
}

export const EVENT_UPSERT = 0;
export const EVENT_REMOVE = 1;
export const EVENT_DTMF = 2;

export interface PlaybackStream {
  write(chunk: Buffer): void;
  end(): void;
}

export interface CallerAudioStream {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  cancel(): void;
}

const RECONNECT_MAX_DELAY_MS = 60_000;

export class CallControlClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;

  constructor(config: ThreeCxConfig) {
    this.baseUrl = config.api_url.replace(/\/$/, "");
    this.clientId = config.client_id ?? "";
    this.clientSecret = config.client_secret ?? "";
  }

  /** Local copy of ThreeCxClient.getAccessToken (private there). */
  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
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

  // ── REST actions ─────────────────────────────────────────────────────

  async getParticipant(dn: string, id: number): Promise<CallControlParticipant | null> {
    try {
      const res = await fetch(`${this.baseUrl}/callcontrol/${dn}/participants/${id}`, {
        headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[VOICE] getParticipant ${dn}/${id} failed (${res.status})`);
        return null;
      }
      return (await res.json()) as CallControlParticipant;
    } catch (error) {
      console.warn("[VOICE] getParticipant failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** POST /callcontrol/{dn}/participants/{id}/{action}. Returns success. */
  private async participantAction(dn: string, id: number, action: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/callcontrol/${dn}/participants/${id}/${action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.getAccessToken()}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[VOICE] ${action} on ${dn}/${id} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[VOICE] ${action} on ${dn}/${id} failed:`, error instanceof Error ? error.message : error);
      return false;
    }
  }

  answer(dn: string, id: number): Promise<boolean> {
    return this.participantAction(dn, id, "answer");
  }

  drop(dn: string, id: number): Promise<boolean> {
    return this.participantAction(dn, id, "drop");
  }

  // ── Audio streams ────────────────────────────────────────────────────

  /** Caller → app audio: chunked GET of raw PCM 16-bit 8kHz mono. */
  async openCallerAudio(dn: string, id: number): Promise<CallerAudioStream | null> {
    try {
      const controller = new AbortController();
      const res = await fetch(`${this.baseUrl}/callcontrol/${dn}/participants/${id}/stream`, {
        headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        console.warn(`[VOICE] openCallerAudio ${dn}/${id} failed (${res.status})`);
        controller.abort();
        return null;
      }
      const reader = res.body.getReader();
      return { reader, cancel: () => controller.abort() };
    } catch (error) {
      console.warn("[VOICE] openCallerAudio failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * App → caller audio: long-lived chunked POST of raw PCM 16-bit 8kHz
   * mono. Uses node:https directly — fetch cannot hold an open chunked
   * request body without duplex plumbing (the official examples do the
   * same).
   */
  async openPlaybackStream(dn: string, id: number): Promise<PlaybackStream | null> {
    try {
      const token = await this.getAccessToken();
      const url = new URL(`${this.baseUrl}/callcontrol/${dn}/participants/${id}/stream`);
      const req: ClientRequest = httpsRequest({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        agent: new HttpsAgent({ keepAlive: true }),
        headers: {
          "Content-Type": "application/octet-stream",
          "Transfer-Encoding": "chunked",
          Authorization: `Bearer ${token}`,
        },
      });
      req.on("error", (error) => {
        console.warn("[VOICE] Playback stream error:", error.message);
      });
      let ended = false;
      return {
        write: (chunk: Buffer) => {
          if (!ended) req.write(chunk);
        },
        end: () => {
          if (!ended) {
            ended = true;
            req.end();
          }
        },
      };
    } catch (error) {
      console.warn("[VOICE] openPlaybackStream failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ── Event websocket ──────────────────────────────────────────────────

  /**
   * Connects WSS /callcontrol/ws and keeps it connected (exponential
   * backoff, never throws out of the loop). Events for the app's own DN
   * arrive automatically once connected.
   */
  connectEvents(onEvent: (event: CallControlEvent) => void, onConnected?: () => void): { close(): void } {
    this.closedByUser = false;
    void this.connectLoop(onEvent, onConnected);
    return {
      close: () => {
        this.closedByUser = true;
        this.ws?.terminate();
        this.ws = null;
      },
    };
  }

  private async connectLoop(onEvent: (event: CallControlEvent) => void, onConnected?: () => void): Promise<void> {
    if (this.closedByUser) return;
    try {
      const token = await this.getAccessToken();
      const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/callcontrol/ws`;
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
      this.ws = ws;

      ws.on("open", () => {
        this.reconnectAttempts = 0;
        console.log("[VOICE] 3CX call-control websocket connected");
        onConnected?.();
      });

      ws.on("message", (raw) => {
        try {
          // Wire shape (from official TS examples): { sequence, event:
          // { event_type, entity, attached_data: { dtmf_input? } } }
          const msg = JSON.parse(raw.toString()) as {
            event?: { event_type?: number; entity?: string; attached_data?: { dtmf_input?: string } };
          };
          if (!msg.event || typeof msg.event.entity !== "string") return;
          onEvent({
            eventType: msg.event.event_type ?? -1,
            entity: msg.event.entity,
            dtmfInput: typeof msg.event.attached_data?.dtmf_input === "string" ? msg.event.attached_data.dtmf_input : null,
          });
        } catch (error) {
          console.warn("[VOICE] Bad websocket message:", error instanceof Error ? error.message : error);
        }
      });

      ws.on("error", (error) => {
        console.warn("[VOICE] Websocket error:", error.message);
      });

      ws.on("close", () => {
        if (this.closedByUser) return;
        this.scheduleReconnect(onEvent, onConnected);
      });
    } catch (error) {
      console.warn("[VOICE] Websocket connect failed:", error instanceof Error ? error.message : error);
      this.scheduleReconnect(onEvent, onConnected);
    }
  }

  private scheduleReconnect(onEvent: (event: CallControlEvent) => void, onConnected?: () => void): void {
    this.reconnectAttempts++;
    // A token that authenticated the LAST websocket is routinely rejected on
    // the next upgrade (observed live 2026-07-08: fresh connect OK, every
    // reconnect with the cached token → HTTP 401, forever — the voice line
    // answered calls with dead silence). Always mint a fresh token when
    // reconnecting.
    this.token = null;
    this.tokenExpiresAt = 0;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    console.warn(`[VOICE] Websocket disconnected — reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);
    const timer = setTimeout(() => void this.connectLoop(onEvent, onConnected), delay);
    timer.unref?.();
  }
}
