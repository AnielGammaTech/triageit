import WebSocket from "ws";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pcm16ToUlaw, ulawToPcm16 } from "./ulaw.js";
import type { VoiceCallContext, VoiceCallHandler } from "./session.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MODEL = process.env.VOICE_REALTIME_MODEL ?? "gpt-realtime";
const VOICE = process.env.VOICE_REALTIME_VOICE ?? "marin";
const INPUT_CHUNK_BYTES = 1600;
const MAX_CALL_MS = 20 * 60_000;
const VAD_THRESHOLD = Number(process.env.VOICE_VAD_THRESHOLD ?? "0.85");
const VAD_SILENCE_MS = Number(process.env.VOICE_VAD_SILENCE_MS ?? "800");
const VAD_PREFIX_MS = Number(process.env.VOICE_VAD_PREFIX_MS ?? "300");

export interface ScreeningCallContext {
  readonly requestId: string;
  readonly candidateId: string;
  readonly inviteToken: string;
  readonly candidateName: string;
  readonly positionTitle: string;
  readonly questions: ReadonlyArray<{ readonly prompt: string; readonly reason?: string }>;
}

export class ScreeningVoiceHandler implements VoiceCallHandler {
  private ctx: VoiceCallContext | null = null;
  private ws: WebSocket | null = null;
  private inputBuffer = Buffer.alloc(0);
  private transcript: Array<{ speaker: "ScreenIT" | "Candidate"; text: string }> = [];
  private ended = false;
  private maxCallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly screening: ScreeningCallContext,
  ) {}

  async onCallStart(ctx: VoiceCallContext): Promise<void> {
    this.ctx = ctx;
    await this.supabase.from("screenit_call_requests").update({ status: "connected", answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", this.screening.requestId);
    try {
      this.ws = await this.connect();
      this.sendSessionUpdate();
      this.send({
        type: "response.create",
        response: {
          instructions: `The candidate just answered. In two short sentences, say: "Hi ${this.firstName()}, this is ScreenIT calling on behalf of Gamma Tech about your application for the ${this.screening.positionTitle} position. This is an AI-assisted screening call that will be transcribed for a human recruiter—are you comfortable continuing, and is now a good time?" Then stop and listen.`,
        },
      });
      this.maxCallTimer = setTimeout(() => void this.hangup(), MAX_CALL_MS);
      this.maxCallTimer.unref?.();
      console.log(`[SCREENIT-CALL] Live screening call for ${this.screening.candidateName} (${ctx.callerNumber})`);
    } catch (error) {
      console.error("[SCREENIT-CALL] Realtime connection failed:", error instanceof Error ? error.message : error);
      await this.supabase.from("screenit_call_requests").update({ status: "failed", error: "AI voice connection failed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", this.screening.requestId);
      await this.hangup();
    }
  }

  onDtmf(): void {}

  onAudioFrame(pcm8k: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.inputBuffer = Buffer.concat([this.inputBuffer, pcm8k]);
    while (this.inputBuffer.length >= INPUT_CHUNK_BYTES) {
      const chunk = this.inputBuffer.subarray(0, INPUT_CHUNK_BYTES);
      this.inputBuffer = this.inputBuffer.subarray(INPUT_CHUNK_BYTES);
      this.send({ type: "input_audio_buffer.append", audio: pcm16ToUlaw(Buffer.from(chunk)).toString("base64") });
    }
  }

  async onCallEnd(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.maxCallTimer) clearTimeout(this.maxCallTimer);
    this.ws?.close();
    this.ws = null;
    const completedAt = new Date().toISOString();
    if (!this.transcript.some((line) => line.speaker === "Candidate")) {
      await this.supabase.from("screenit_call_requests").update({ status: "no_answer", error: "No candidate response was captured", completed_at: completedAt, updated_at: completedAt }).eq("id", this.screening.requestId);
      return;
    }

    try {
      const baseUrl = (process.env.SCREENIT_BASE_URL ?? "https://screenit-production.up.railway.app").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/api/interviews/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.screening.inviteToken, transcript: this.transcript }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`Report endpoint returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
      await this.supabase.from("screenit_call_requests").update({ status: "completed", completed_at: completedAt, updated_at: completedAt }).eq("id", this.screening.requestId);
      console.log(`[SCREENIT-CALL] Screening report saved for ${this.screening.candidateName} (${this.transcript.length} transcript lines)`);
    } catch (error) {
      console.error("[SCREENIT-CALL] Report persistence failed:", error instanceof Error ? error.message : error);
      await this.supabase.from("screenit_call_requests").update({ status: "failed", error: "Call completed but report generation failed", completed_at: completedAt, updated_at: completedAt }).eq("id", this.screening.requestId);
    }
  }

  private connect(): Promise<WebSocket> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Promise.reject(new Error("OPENAI_API_KEY not set"));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${REALTIME_URL}?model=${encodeURIComponent(MODEL)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("Realtime connection timed out")); }, 7_000);
      ws.on("open", () => { clearTimeout(timer); resolve(ws); });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
      ws.on("message", (raw) => this.handleServerEvent(raw.toString()));
      ws.on("close", () => { if (!this.ended) void this.hangup(); });
    });
  }

  private sendSessionUpdate(): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: this.instructions(),
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            noise_reduction: { type: "far_field" },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: { type: "server_vad", threshold: VAD_THRESHOLD, prefix_padding_ms: VAD_PREFIX_MS, silence_duration_ms: VAD_SILENCE_MS, interrupt_response: true, create_response: true },
          },
          output: { format: { type: "audio/pcmu" }, voice: VOICE },
        },
        tools: [{ type: "function", name: "finish_screening", description: "End the call only after the candidate has answered the screening questions or declined consent, and after you have thanked them.", parameters: { type: "object", properties: {} } }],
        tool_choice: "auto",
      },
    });
  }

  private instructions(): string {
    const questions = this.screening.questions.map((question, index) => `${index + 1}. ${question.prompt}${question.reason ? `\nWhy this is asked: ${question.reason}` : ""}`).join("\n\n");
    return `You are ScreenIT, a warm, natural phone interviewer calling ${this.screening.candidateName} about the ${this.screening.positionTitle} role.

CONVERSATION STYLE:
- The human candidate should speak about 80 percent of the call. Your job is to ask and listen.
- Ask exactly one question at a time, using one short sentence whenever possible.
- Never give a long speech, restate their whole answer, or stack multiple questions.
- Use brief natural acknowledgements such as "Got it" or "Thank you," then move to the next question.
- Allow pauses. Do not interrupt. If the candidate interrupts you, stop speaking immediately and listen.
- Ask at most one short neutral follow-up when an answer is vague or misses the reason for the question.
- Sound conversational and respectful, not like you are reading a form.
- Listen to the substance of each answer and ask one smart, neutral follow-up when it would verify a resume claim, clarify a gap, or produce a concrete work example.

TOPIC AND RESPECT BOUNDARIES:
- If the candidate changes to an unrelated topic, briefly say you need to keep the screening focused on the role, then ask the current job-related question again in simpler words.
- Never argue, shame, or match hostility. If the candidate uses clearly abusive, threatening, discriminatory, or sexual language toward you, give one calm boundary: "I want to continue respectfully. This call is being transcribed for management review, so let's keep it focused on the role."
- If the abuse continues after that warning, say "I'm ending the screening now. A member of management can follow up with you," then call finish_screening.
- Do not call ordinary disagreement, nervousness, profanity not aimed at you, accent, pauses, or communication style abusive.

CONSENT:
- Before any screening question, disclose that you are an AI assistant, the call is transcribed, and a human recruiter reviews the report.
- Get a clear yes. If they decline or it is a bad time, thank them, say a recruiter can follow up, and call finish_screening.

SCREENING QUESTIONS:
${questions || "Ask the candidate to describe the most relevant job experience for this role."}

BOUNDARIES:
- Discuss only job duties, skills, explicit resume experience, work examples, and role logistics.
- Never ask about or infer protected traits, medical history, family status, age, nationality, religion, disability, or other sensitive information.
- Never score accent, emotion, personality, honesty, enthusiasm, or culture fit.
- Do not make a hiring decision or tell the candidate whether they passed.
- After the questions, ask whether they want to add job-related context. Then thank them in one short sentence and call finish_screening.`;
  }

  private handleServerEvent(raw: string): void {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = String(event.type ?? "");
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (typeof event.delta === "string") this.ctx?.sendAudio(ulawToPcm16(Buffer.from(event.delta, "base64")));
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string" && event.transcript.trim()) {
      this.transcript.push({ speaker: "Candidate", text: event.transcript.trim() });
      return;
    }
    if ((type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") && typeof event.transcript === "string" && event.transcript.trim()) {
      this.transcript.push({ speaker: "ScreenIT", text: event.transcript.trim() });
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.ctx?.stopAudio();
      return;
    }
    if (type === "response.function_call_arguments.done" && event.name === "finish_screening") {
      this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: String(event.call_id ?? ""), output: JSON.stringify({ ok: true }) } });
      setTimeout(() => void this.hangup(), 2_500).unref?.();
      return;
    }
    if (type === "error") console.error("[SCREENIT-CALL] Realtime error:", JSON.stringify(event.error ?? event).slice(0, 300));
  }

  private send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private firstName(): string {
    return this.screening.candidateName.trim().split(/\s+/)[0] || "there";
  }

  private async hangup(): Promise<void> {
    await this.ctx?.hangup();
  }
}
