import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import {
  CallControlClient,
  EVENT_DTMF,
  EVENT_REMOVE,
  EVENT_UPSERT,
  type CallControlEvent,
  type PlaybackStream,
} from "./call-control.js";
import { AudioPump } from "./audio.js";
import { DtmfMenuHandler, type VoiceCallHandler } from "./session.js";
import type { ThreeCxConfig } from "@triageit/shared";

/**
 * AI phone line listener — Stage 1.
 *
 * Watches the 3CX call-control websocket for calls arriving on the
 * 'triageit' route point (Wroutepoint DN, confirmed live via GET
 * /callcontrol), answers them, attaches bidirectional PCM audio, and
 * hands the call to a VoiceCallHandler (DTMF menu for now).
 */

const ROUTE_POINT_DN = process.env.VOICE_ROUTE_POINT_DN ?? "triageit";
const PARTICIPANT_ENTITY = /^\/callcontrol\/([^/]+)\/participants\/(\d+)$/;

interface ActiveSession {
  readonly handler: VoiceCallHandler;
  readonly pump: AudioPump;
  readonly playback: PlaybackStream;
  readonly cancelInbound: () => void;
  ended: boolean;
}

interface ListenerState {
  readonly cc: CallControlClient;
  readonly supabase: ReturnType<typeof createSupabaseClient>;
  readonly halo: HaloClient;
  readonly sessions: Map<number, ActiveSession>;
  readonly answering: Set<number>;
}

export async function startVoiceListener(): Promise<void> {
  let supabase: ReturnType<typeof createSupabaseClient>;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    console.warn("[VOICE] Supabase unavailable — voice listener disabled:", error instanceof Error ? error.message : error);
    return;
  }

  const { data: integration, error } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "threecx")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !integration) {
    console.log("[VOICE] 3CX not configured — voice listener disabled");
    return;
  }
  const config = integration.config as ThreeCxConfig;
  if (!config.api_url || !config.client_id || !config.client_secret) {
    console.log("[VOICE] 3CX client_id/client_secret missing — voice listener disabled");
    return;
  }

  const haloConfig = await getCachedHaloConfig(supabase);
  if (!haloConfig) {
    console.log("[VOICE] Halo not configured — voice listener disabled");
    return;
  }

  const state: ListenerState = {
    cc: new CallControlClient(config),
    supabase,
    halo: new HaloClient(haloConfig),
    sessions: new Map(),
    answering: new Set(),
  };

  state.cc.connectEvents((event) => {
    handleEvent(state, event).catch((err) => {
      console.error("[VOICE] Event handling failed:", err instanceof Error ? err.message : err);
    });
  });
  console.log(`[VOICE] Voice listener started — watching route point '${ROUTE_POINT_DN}'`);
}

async function handleEvent(state: ListenerState, event: CallControlEvent): Promise<void> {
  const match = PARTICIPANT_ENTITY.exec(event.entity);
  if (!match || match[1] !== ROUTE_POINT_DN) return;
  const participantId = Number(match[2]);

  switch (event.eventType) {
    case EVENT_UPSERT:
      await handleParticipantUpsert(state, participantId);
      break;
    case EVENT_DTMF: {
      const session = state.sessions.get(participantId);
      if (session && !session.ended && event.dtmfInput) {
        for (const digit of event.dtmfInput) session.handler.onDtmf(digit);
      }
      break;
    }
    case EVENT_REMOVE:
      await endSession(state, participantId);
      break;
  }
}

async function handleParticipantUpsert(state: ListenerState, participantId: number): Promise<void> {
  if (state.sessions.has(participantId)) return;

  const participant = await state.cc.getParticipant(ROUTE_POINT_DN, participantId);
  if (!participant) return;

  // Route-point participants must be answered by the controlling app
  // (POST .../answer — the docs list "answer" as valid for RoutePoint
  // participants). Once status flips to Connected a second Upsert event
  // arrives and the session starts.
  if (participant.status === "Connected") {
    await startSession(state, participantId, participant.party_caller_id ?? "unknown");
    return;
  }

  if (!state.answering.has(participantId)) {
    state.answering.add(participantId);
    console.log(`[VOICE] Incoming call on '${ROUTE_POINT_DN}' from ${participant.party_caller_id ?? "unknown"} (participant ${participantId}, status ${participant.status ?? "?"}) — answering`);
    const ok = await state.cc.answer(ROUTE_POINT_DN, participantId);
    if (!ok) state.answering.delete(participantId);
  }
}

async function startSession(state: ListenerState, participantId: number, callerNumber: string): Promise<void> {
  state.answering.delete(participantId);

  const playback = await state.cc.openPlaybackStream(ROUTE_POINT_DN, participantId);
  if (!playback) {
    console.error(`[VOICE] Could not open playback stream for participant ${participantId} — dropping call`);
    await state.cc.drop(ROUTE_POINT_DN, participantId);
    return;
  }

  const inbound = await state.cc.openCallerAudio(ROUTE_POINT_DN, participantId);
  if (!inbound) {
    console.error(`[VOICE] Could not open caller audio for participant ${participantId} — dropping call`);
    playback.end();
    await state.cc.drop(ROUTE_POINT_DN, participantId);
    return;
  }

  const pump = new AudioPump((chunk) => playback.write(chunk));
  const handler: VoiceCallHandler = new DtmfMenuHandler({ supabase: state.supabase, halo: state.halo });
  const session: ActiveSession = {
    handler,
    pump,
    playback,
    cancelInbound: () => inbound.cancel(),
    ended: false,
  };
  state.sessions.set(participantId, session);

  // Caller → handler audio loop (ends on hangup/stream close)
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await inbound.reader.read();
        if (done) break;
        if (value && !session.ended) handler.onAudioFrame(Buffer.from(value));
      }
    } catch (error) {
      if (!session.ended) {
        console.warn(`[VOICE] Caller audio stream ended abnormally (participant ${participantId}):`, error instanceof Error ? error.message : error);
      }
    }
    await endSession(state, participantId);
  })();

  await handler.onCallStart({
    callerNumber,
    sendAudio: (pcm) => pump.enqueue(pcm),
    stopAudio: () => pump.stop(),
    hangup: async () => {
      await state.cc.drop(ROUTE_POINT_DN, participantId);
    },
  });
}

async function endSession(state: ListenerState, participantId: number): Promise<void> {
  state.answering.delete(participantId);
  const session = state.sessions.get(participantId);
  if (!session || session.ended) return;
  session.ended = true;
  state.sessions.delete(participantId);

  session.pump.close();
  try {
    session.playback.end();
  } catch {
    // stream already torn down by the PBX
  }
  session.cancelInbound();

  try {
    await session.handler.onCallEnd();
  } catch (error) {
    console.error(`[VOICE] onCallEnd failed (participant ${participantId}):`, error instanceof Error ? error.message : error);
  }
  console.log(`[VOICE] Call ended (participant ${participantId})`);
}
