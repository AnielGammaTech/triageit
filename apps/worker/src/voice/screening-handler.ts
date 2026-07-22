import WebSocket from "ws";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pcm16ToUlaw, ulawToPcm16 } from "./ulaw.js";
import type { VoiceCallContext, VoiceCallHandler } from "./session.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MODEL = process.env.SCREENIT_REALTIME_MODEL ?? process.env.VOICE_REALTIME_MODEL ?? "gpt-realtime-2.1";
const VOICE = process.env.SCREENIT_REALTIME_VOICE ?? process.env.VOICE_REALTIME_VOICE ?? "marin";
const INPUT_CHUNK_BYTES = 1600;
const MAX_CALL_MS = 20 * 60_000;
const WRAP_UP_LEAD_MS = 30_000;
const VAD_MODE = process.env.SCREENIT_VAD_MODE === "server_vad" ? "server_vad" : "semantic_vad";
const VAD_EAGERNESS = ["low", "medium", "high", "auto"].includes(process.env.SCREENIT_VAD_EAGERNESS ?? "")
  ? process.env.SCREENIT_VAD_EAGERNESS
  : "medium";
const VAD_THRESHOLD = Number(process.env.SCREENIT_VAD_THRESHOLD ?? "0.92");
const VAD_SILENCE_MS = Number(process.env.SCREENIT_VAD_SILENCE_MS ?? "1000");
const VAD_PREFIX_MS = Number(process.env.SCREENIT_VAD_PREFIX_MS ?? "300");
const BARGE_IN_MIN_MS = Number(process.env.SCREENIT_BARGE_IN_MIN_MS ?? "1800");

export interface ScreeningCallContext {
  readonly requestId: string;
  readonly candidateId: string;
  readonly inviteToken: string;
  readonly candidateName: string;
  readonly positionTitle: string;
  readonly resumeFacts: readonly string[];
  readonly resumeClarifications: readonly string[];
  readonly questions: ReadonlyArray<{ readonly prompt: string; readonly reason?: string }>;
}

export function buildScreeningInstructions(screening: ScreeningCallContext): string {
  const questions = screening.questions.map((question) => `- ${question.prompt}${question.reason ? ` (${question.reason})` : ""}`).join("\n");
  const resumeFacts = screening.resumeFacts.map((fact) => `- ${fact}`).join("\n") || "- No reliable resume facts were extracted; ask the candidate to summarize their most recent role.";
  const resumeClarifications = screening.resumeClarifications.map((item) => `- ${item}`).join("\n") || "- None identified.";
  return `You are ScreenIT, a warm, perceptive phone interviewer calling ${screening.candidateName} about the ${screening.positionTitle} role.

YOUR JOB:
- Run a natural but thorough evidence-gathering conversation in which the candidate speaks most of the time.
- There is no fixed question count. Ask only as many questions as needed to cover the role-critical evidence without repetition, filler, or trivia.
- Ask exactly one short, plain-English question at a time. Never stack questions.
- Let the candidate finish. A pause, breath, cough, or moment of thinking is not an interruption.
- Use brief acknowledgements only when useful. Do not summarize every response.
- Keep a silent evidence ledger throughout the call. Before asking anything, check whether the candidate already answered it.
- Do not accept a broad claim as proof. Nicely ask for the candidate's own actions, the steps they took, the tool or workflow involved, and the result when those details matter.

SILENT EVIDENCE LEDGER:
Track each item as not asked, demonstrated, explicitly absent, or unresolved:
1. Responsibilities and concrete work shown in the explicit resume facts.
2. Remote support or device-management experience, including an RMM only if the candidate knows one.
3. Request tracking and ownership, including a PSA or ticketing system only if the candidate knows one.
4. Documentation, customer updates, and confirming resolution.
5. Relevant Windows, Microsoft 365, account, or endpoint troubleshooting.
6. A real troubleshooting example: problem, personal actions, reasoning, help sought, and result.
7. Why they entered IT, why this role interests them, and one concrete current learning activity.

EVIDENCE-DRIVEN QUESTIONING:
- Begin with a specific responsibility, project, employer, or tool only when it appears in EXPLICIT RESUME FACTS. Say what you saw, then ask what the candidate personally did.
- If a resume claim is broad, ask for one concrete example. Useful neutral follow-ups include: "What did you personally do?", "Can you walk me through the steps?", "Which tool or system did you use?", and "What happened in the end?"
- If the answer does not address a role-critical question, ask it again once in simpler words and explain the missing detail. If it is still vague, contradictory, or incomplete, use at most one final targeted clarification that asks for a concrete example or explicitly confirms they do not have that experience.
- After those targeted attempts, silently mark the item unresolved and move on. Never enter a loop and never ask a merely reworded version later.
- If an answer conflicts with an earlier answer or the resume, neutrally point out the exact difference and ask which version is accurate. Do not accuse the candidate of lying.
- If the candidate gives a polished slogan, unsupported claim, or answer about what "we" did, ask what they personally did and what result they observed.
- A clear "I have not used that" is a complete answer. Confirm transferable experience only when useful, then move on.
- Prepared prompts are evidence targets, not a script. Skip any prepared prompt already answered and adapt later questions to what the candidate actually said.
- End only after every role-critical ledger item is demonstrated, explicitly absent, or unresolved after targeted clarification. Then ask one final invitation: "Is there any job-related experience you want the recruiting team to know that we didn't cover?"

EXPLICIT RESUME FACTS:
${resumeFacts}

RESUME ITEMS TO CLARIFY:
${resumeClarifications}

OPTIONAL PREPARED EVIDENCE TARGETS:
${questions || "- None. Use the evidence ledger above."}

TOPIC AND RESPECT BOUNDARIES:
- If the candidate changes to an unrelated topic, briefly say you need to keep the screening focused on the role, then return to the unanswered job-related point in simpler words.
- Never argue, shame, or match hostility. If the candidate uses clearly abusive, threatening, discriminatory, or sexual language toward you, give one calm boundary: "I want to continue respectfully. This call is being transcribed for management review, so let's keep it focused on the role."
- If that conduct continues after the warning, say "I'm ending the screening now. A member of management can follow up with you," then call finish_screening.
- Do not call ordinary disagreement, nervousness, profanity not aimed at you, accent, pauses, or communication style abusive.

CONSENT:
- Before any screening question, disclose that you are an AI assistant, the call is transcribed, and a human recruiter reviews the report.
- Get a clear yes. If they decline or it is a bad time, thank them, say a recruiter can follow up, and call finish_screening.

BOUNDARIES:
- Discuss only job duties, skills, explicit resume experience, work examples, and role logistics.
- Never ask for employer names, dates, totals, or history that is not explicitly present in the resume facts or introduced by the candidate unless a role requirement truly needs it.
- Never ask about or infer protected traits, medical history, family status, age, nationality, religion, disability, or other sensitive information.
- Never score accent, emotion, personality, honesty, enthusiasm, or culture fit. Capture only observable words and conduct and motivation the candidate explicitly states.
- Do not make a hiring decision or tell the candidate whether they passed.
- After the final invitation, wait for the full answer. Then naturally thank them, say the recruiting team will review the conversation, say goodbye, and only then call finish_screening.`;
}

export class ScreeningVoiceHandler implements VoiceCallHandler {
  private ctx: VoiceCallContext | null = null;
  private ws: WebSocket | null = null;
  private inputBuffer = Buffer.alloc(0);
  private transcript: Array<{ speaker: "ScreenIT" | "Candidate"; text: string }> = [];
  private ended = false;
  private maxCallTimer: ReturnType<typeof setTimeout> | null = null;
  private wrapUpTimer: ReturnType<typeof setTimeout> | null = null;
  private hangupTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private candidateSpeechActive = false;
  private speechStartedDuringAssistant = false;
  private bargeInAccepted = false;
  private assistantResponseActive = false;
  private assistantAudibleUntil = 0;
  private pendingResponseAfterBargeIn = false;
  private wrapUpPending = false;
  private finishRequested = false;

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
          instructions: `The candidate just answered. Speak warmly and naturally, with a small pause between sentences. Say: "Hi ${this.firstName()}, this is ScreenIT calling for Gamma Tech about the ${this.screening.positionTitle} role. I'm an AI interviewer, and I'll transcribe our conversation for a recruiter to review. Is now a good time to continue?" Then stop completely and listen.`,
        },
      });
      this.wrapUpTimer = setTimeout(() => this.requestTimeLimitWrapUp(), MAX_CALL_MS - WRAP_UP_LEAD_MS);
      this.wrapUpTimer.unref?.();
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
    if (this.wrapUpTimer) clearTimeout(this.wrapUpTimer);
    if (this.hangupTimer) clearTimeout(this.hangupTimer);
    if (this.bargeInTimer) clearTimeout(this.bargeInTimer);
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
            // ScreenIT owns barge-in instead of letting a breath or brief line
            // noise cancel a response immediately. Medium semantic VAD reduces
            // dead air while the separate barge-in guard protects full answers.
            turn_detection: this.turnDetection(),
          },
          output: { format: { type: "audio/pcmu" }, voice: VOICE },
        },
        tools: [{ type: "function", name: "finish_screening", description: "End the call only after the candidate has answered the screening questions or declined consent, and after you have thanked them.", parameters: { type: "object", properties: {} } }],
        tool_choice: "auto",
      },
    });
  }

  private instructions(): string {
    return buildScreeningInstructions(this.screening);
  }

  private handleServerEvent(raw: string): void {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = String(event.type ?? "");
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (typeof event.delta === "string") {
        const pcm = ulawToPcm16(Buffer.from(event.delta, "base64"));
        this.ctx?.sendAudio(pcm);
        const startsAt = Math.max(Date.now(), this.assistantAudibleUntil);
        this.assistantAudibleUntil = startsAt + (pcm.length / 16);
      }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string" && event.transcript.trim()) {
      this.transcript.push({ speaker: "Candidate", text: event.transcript.trim() });
      return;
    }
    if ((type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") && typeof event.transcript === "string" && event.transcript.trim()) {
      const text = event.transcript.trim();
      this.transcript.push({ speaker: "ScreenIT", text });
      return;
    }
    if (type === "response.created") {
      this.assistantResponseActive = true;
      return;
    }
    if (type === "response.done") {
      this.assistantResponseActive = false;
      if (this.finishRequested) {
        this.scheduleHangupAfterAudio();
        return;
      }
      if (this.wrapUpPending && !this.candidateSpeechActive) {
        this.sendTimeLimitWrapUp();
        return;
      }
      if (this.pendingResponseAfterBargeIn) {
        this.pendingResponseAfterBargeIn = false;
        this.send({ type: "response.create" });
      }
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.candidateSpeechActive = true;
      this.bargeInAccepted = false;
      this.speechStartedDuringAssistant = this.isAssistantAudible();
      if (this.speechStartedDuringAssistant) {
        if (this.bargeInTimer) clearTimeout(this.bargeInTimer);
        this.bargeInTimer = setTimeout(() => this.acceptBargeIn(), BARGE_IN_MIN_MS);
        this.bargeInTimer.unref?.();
      }
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      this.candidateSpeechActive = false;
      if (this.bargeInTimer) clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
      const shouldAnswer = !this.speechStartedDuringAssistant || this.bargeInAccepted || !this.isAssistantAudible();
      if (shouldAnswer) {
        if (this.assistantResponseActive) this.pendingResponseAfterBargeIn = true;
        else if (this.wrapUpPending) this.sendTimeLimitWrapUp();
        else this.send({ type: "response.create" });
      }
      this.speechStartedDuringAssistant = false;
      this.bargeInAccepted = false;
      return;
    }
    if (type === "response.function_call_arguments.done" && event.name === "finish_screening") {
      this.finishRequested = true;
      this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: String(event.call_id ?? ""), output: JSON.stringify({ ok: true }) } });
      // response.done normally follows this event. Keep a conservative fallback
      // so a lost completion event cannot leave the phone call open forever.
      if (this.hangupTimer) clearTimeout(this.hangupTimer);
      this.hangupTimer = setTimeout(() => void this.hangup(), 12_000);
      this.hangupTimer.unref?.();
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

  private isAssistantAudible(): boolean {
    return this.assistantResponseActive || Date.now() < this.assistantAudibleUntil;
  }

  private turnDetection(): Record<string, unknown> {
    if (VAD_MODE === "server_vad") {
      return { type: "server_vad", threshold: VAD_THRESHOLD, prefix_padding_ms: VAD_PREFIX_MS, silence_duration_ms: VAD_SILENCE_MS, interrupt_response: false, create_response: false };
    }
    return { type: "semantic_vad", eagerness: VAD_EAGERNESS, interrupt_response: false, create_response: false };
  }

  private requestTimeLimitWrapUp(): void {
    if (this.ended || this.finishRequested) return;
    this.wrapUpPending = true;
    if (!this.candidateSpeechActive && !this.assistantResponseActive) this.sendTimeLimitWrapUp();
  }

  private sendTimeLimitWrapUp(): void {
    if (this.ended || this.finishRequested) return;
    this.wrapUpPending = false;
    this.send({
      type: "response.create",
      response: {
        instructions: "The twenty-minute call limit is approaching. Ask no new question. Briefly thank the candidate, say the recruiting team will review the conversation, say goodbye, and then call finish_screening only after the goodbye is spoken.",
      },
    });
  }

  private scheduleHangupAfterAudio(): void {
    if (this.hangupTimer) clearTimeout(this.hangupTimer);
    const remainingAudioMs = Math.max(0, this.assistantAudibleUntil - Date.now());
    const delayMs = Math.min(10_000, Math.max(1_200, remainingAudioMs + 900));
    this.hangupTimer = setTimeout(() => void this.hangup(), delayMs);
    this.hangupTimer.unref?.();
  }

  private acceptBargeIn(): void {
    this.bargeInTimer = null;
    if (!this.candidateSpeechActive || !this.isAssistantAudible()) return;
    this.bargeInAccepted = true;
    this.ctx?.stopAudio();
    this.assistantAudibleUntil = 0;
    if (this.assistantResponseActive) this.send({ type: "response.cancel" });
  }

  private async hangup(): Promise<void> {
    await this.ctx?.hangup();
  }
}
