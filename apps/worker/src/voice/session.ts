import { generateBeep, synthesizeSpeechPcm8k, BYTES_PER_SECOND } from "./audio.js";
import { buildCallerContext, composeStatusScript, type CallerContext } from "./status-script.js";
import { processVoicemail, MAX_RECORDING_SECONDS, type VoicemailDeps } from "./voicemail.js";

/**
 * Per-call handler abstraction.
 *
 * Stage 1 is the keypad menu (DtmfMenuHandler). Stage 2 can swap in a
 * realtime speech bridge by implementing the same interface — the
 * listener only speaks in terms of these four hooks plus the context's
 * audio primitives, so nothing above this layer changes.
 */

export interface VoiceCallContext {
  /** Raw caller ID as delivered by 3CX (party_caller_id). */
  readonly callerNumber: string;
  /** Queue 8 kHz 16-bit mono PCM for paced playback to the caller. */
  sendAudio(pcm8k: Buffer): void;
  /** Barge-in: drop all queued playback immediately. */
  stopAudio(): void;
  /** Drop our participant (ends the call). */
  hangup(): Promise<void>;
}

export interface VoiceCallHandler {
  onCallStart(ctx: VoiceCallContext): Promise<void>;
  /** One DTMF digit (0-9, *, #) from the caller. */
  onDtmf(digit: string): void;
  /** One chunk of caller audio (8 kHz 16-bit mono PCM). */
  onAudioFrame(pcm8k: Buffer): void;
  /** Call torn down (hangup or drop) — always invoked exactly once. */
  onCallEnd(): Promise<void>;
}

type MenuState = "starting" | "menu" | "recording" | "ended";

const MAX_RECORDING_BYTES = MAX_RECORDING_SECONDS * BYTES_PER_SECOND;
const RECORD_PROMPT = "Please leave your message after the tone. Hang up when you are done.";

/**
 * Stage-1 state machine: play greeting + ticket status (interruptible),
 * wait for keypad input, and on 1 record a message until hangup or the
 * 120-second cap.
 */
export class DtmfMenuHandler implements VoiceCallHandler {
  private ctx: VoiceCallContext | null = null;
  private state: MenuState = "starting";
  private callerContext: CallerContext | null = null;
  private recordedFrames: Buffer[] = [];
  private recordedBytes = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(private readonly deps: VoicemailDeps) {}

  async onCallStart(ctx: VoiceCallContext): Promise<void> {
    this.ctx = ctx;
    try {
      this.callerContext = await buildCallerContext(this.deps.supabase, this.deps.halo, ctx.callerNumber);
      const script = composeStatusScript(this.callerContext);
      console.log(`[VOICE] Call from ${ctx.callerNumber} (${this.callerContext.knownCaller ? "known" : "unknown"} caller, ${this.callerContext.spokenTickets.length} open tickets)`);
      // A digit may already have arrived (barge-in) — don't talk over the menu
      if (this.state === "starting") {
        this.state = "menu";
        const speech = await synthesizeSpeechPcm8k(script);
        if (speech && (this.state as MenuState) === "menu") ctx.sendAudio(speech);
      }
    } catch (error) {
      console.error("[VOICE] onCallStart failed:", error instanceof Error ? error.message : error);
      if (this.state === "starting") this.state = "menu";
    }
  }

  onDtmf(digit: string): void {
    if (!this.ctx || this.state === "ended") return;
    // Barge-in contract: any keypress silences whatever is playing
    this.ctx.stopAudio();
    if (digit === "1" && this.state !== "recording") {
      void this.startRecording();
    }
  }

  onAudioFrame(pcm8k: Buffer): void {
    if (this.state !== "recording" || this.recordedBytes >= MAX_RECORDING_BYTES) return;
    this.recordedFrames.push(pcm8k);
    this.recordedBytes += pcm8k.length;
    if (this.recordedBytes >= MAX_RECORDING_BYTES) {
      console.log(`[VOICE] Recording cap reached for ${this.ctx?.callerNumber ?? "?"} — hanging up`);
      void this.finishRecordingAndHangup();
    }
  }

  async onCallEnd(): Promise<void> {
    if (this.capTimer) clearTimeout(this.capTimer);
    const wasRecording = this.state === "recording";
    this.state = "ended";
    if (wasRecording) await this.finalizeMessage();
  }

  private async startRecording(): Promise<void> {
    if (!this.ctx || this.state === "ended") return;
    this.state = "recording";
    // Wall-clock cap as a backstop: caller audio arrives ~realtime, but a
    // stalled stream must not leave the call parked forever.
    this.capTimer = setTimeout(() => {
      console.log(`[VOICE] Recording time cap reached for ${this.ctx?.callerNumber ?? "?"} — hanging up`);
      void this.finishRecordingAndHangup();
    }, (MAX_RECORDING_SECONDS + 10) * 1000);
    this.capTimer.unref?.();

    const prompt = await synthesizeSpeechPcm8k(RECORD_PROMPT);
    if (this.state !== "recording" || !this.ctx) return;
    if (prompt) this.ctx.sendAudio(prompt);
    this.ctx.sendAudio(generateBeep());
    // Recording starts immediately; the prompt/beep overlap is trimmed by
    // whisper being robust to leading prompt audio picked up mid-frame.
  }

  private async finishRecordingAndHangup(): Promise<void> {
    if (this.state !== "recording") return;
    this.state = "ended";
    if (this.capTimer) clearTimeout(this.capTimer);
    await this.finalizeMessage();
    try {
      await this.ctx?.hangup();
    } catch (error) {
      console.warn("[VOICE] Hangup failed:", error instanceof Error ? error.message : error);
    }
  }

  private async finalizeMessage(): Promise<void> {
    if (this.finished || !this.ctx) return;
    this.finished = true;
    const pcm = Buffer.concat(this.recordedFrames);
    this.recordedFrames = [];
    await processVoicemail(this.deps, {
      callerNumber: this.ctx.callerNumber,
      pcm,
      ticket: this.callerContext?.voicemailTicket ?? null,
    });
  }
}
