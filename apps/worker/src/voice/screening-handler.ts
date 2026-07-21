import WebSocket from "ws";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pcm16ToUlaw, ulawToPcm16 } from "./ulaw.js";
import type { VoiceCallContext, VoiceCallHandler } from "./session.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MODEL = process.env.SCREENIT_REALTIME_MODEL ?? process.env.VOICE_REALTIME_MODEL ?? "gpt-realtime";
const VOICE = process.env.SCREENIT_REALTIME_VOICE ?? process.env.VOICE_REALTIME_VOICE ?? "marin";
const INPUT_CHUNK_BYTES = 1600;
const MAX_CALL_MS = 20 * 60_000;
const WRAP_UP_LEAD_MS = 30_000;
const VAD_MODE = process.env.SCREENIT_VAD_MODE === "server_vad" ? "server_vad" : "semantic_vad";
const VAD_EAGERNESS = ["low", "medium", "high", "auto"].includes(process.env.SCREENIT_VAD_EAGERNESS ?? "")
  ? process.env.SCREENIT_VAD_EAGERNESS
  : "low";
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
            // noise cancel a response immediately. Low-eagerness semantic VAD
            // waits for a completed thought rather than a short natural pause.
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
    const questions = this.screening.questions.map((question) => `- ${question.prompt}${question.reason ? ` (${question.reason})` : ""}`).join("\n");
    const resumeFacts = this.screening.resumeFacts.map((fact) => `- ${fact}`).join("\n") || "- No reliable resume facts were extracted; ask the candidate to summarize their most recent role.";
    const resumeClarifications = this.screening.resumeClarifications.map((item) => `- ${item}`).join("\n") || "- None identified.";
    return `You are ScreenIT, a warm, natural phone interviewer calling ${this.screening.candidateName} about the ${this.screening.positionTitle} role.

YOUR JOB:
- Make this feel like a calm conversation, not a questionnaire. The candidate should speak most of the time.
- Ask no more than five primary questions in the entire call and no more than two adaptive follow-ups total.
- The topics below are a coverage guide, not a rigid order. Follow the candidate's answers, transition naturally, and reorder or skip topics when the conversation has already supplied the evidence.
- Ask exactly one short, plain-English question at a time. Never stack questions or give a long speech.
- Let the candidate finish the full thought. A pause, breath, cough, or moment of thinking is not an interruption.
- Use brief, varied acknowledgements only when useful. Do not summarize every answer back to them.
- Before asking anything, check the conversation so far. If the topic or evidence was already covered, skip it. Never paraphrase and re-ask the same question.
- Keep a silent topic ledger for: resume work, IT motivation, tools/workflow, troubleshooting/learning, and final addition. Cover each at most once.

FIVE-TOPIC CONVERSATION:
1. RESUME WORK: Start with the most recent relevant employer or role only when it appears verbatim in EXPLICIT RESUME FACTS. Ask what the candidate personally handled there. If no employer is explicitly listed, ask them to describe their most recent relevant role without naming a company.
2. ONE RESUME DETAIL: Ask at most one follow-up about a specific responsibility, tool, project, or neutral clarification from the resume. Never introduce an employer name that is not in EXPLICIT RESUME FACTS. If the candidate introduces another employer, you may discuss it, but never claim it was on the resume.
3. IT MOTIVATION: Ask what first got them interested in IT. Capture the reasons and examples they actually state; do not infer excitement or passion from their voice.
4. TOOLS AND WORKFLOW: First ask what tools or systems they have used to support people or computers. Do not assume they know the terms RMM, PSA, ticketing, or Microsoft 365. Only after their answer, ask one plain-language follow-up about the most important missing area. Explain unfamiliar shorthand briefly, for example "software used to monitor or manage computers remotely" or "a system used to track support requests." Do not quiz them on several tool categories.
5. PROBLEM SOLVING: Ask for one real time they did not know how to solve a work problem and what they did next. This one example may cover troubleshooting, asking for help, documentation, escalation, and learning. Do not separately re-ask those topics if the example already covers them.

DEPTH WITHOUT REPETITION:
- Use at most two follow-ups across the whole call, selected only when an answer needs one concrete detail such as what they personally did or what the result was.
- The prepared questions below are optional evidence prompts, not a checklist. Use at most one prepared question, only if it covers a role-critical gap that remains after the five topics.
- Accept equivalent tools and transferable workflows. A product name alone is not evidence; one short follow-up may ask what they actually did with it.
- Ask one final invitation: "Is there any job-related experience you want the recruiting team to know that we didn't cover?"
- Listen for job-relevant working signals in the candidate's examples: ownership, clarity, customer awareness, documentation habits, help-seeking, learning, and explicitly stated interest. Gather evidence through the conversation; do not label their personality.

EXPLICIT RESUME FACTS:
${resumeFacts}

RESUME ITEMS TO CLARIFY:
${resumeClarifications}

TOPIC AND RESPECT BOUNDARIES:
- If the candidate changes to an unrelated topic, briefly say you need to keep the screening focused on the role, then ask the current job-related question again in simpler words.
- Never argue, shame, or match hostility. If the candidate uses clearly abusive, threatening, discriminatory, or sexual language toward you, give one calm boundary: "I want to continue respectfully. This call is being transcribed for management review, so let's keep it focused on the role."
- If the abuse continues after that warning, say "I'm ending the screening now. A member of management can follow up with you," then call finish_screening.
- Do not call ordinary disagreement, nervousness, profanity not aimed at you, accent, pauses, or communication style abusive.

CONSENT:
- Before any screening question, disclose that you are an AI assistant, the call is transcribed, and a human recruiter reviews the report.
- Get a clear yes. If they decline or it is a bad time, thank them, say a recruiter can follow up, and call finish_screening.

OPTIONAL PREPARED EVIDENCE PROMPTS:
${questions || "- None. Use the five-topic conversation above."}

BOUNDARIES:
- Discuss only job duties, skills, explicit resume experience, work examples, and role logistics.
- Never ask about or infer protected traits, medical history, family status, age, nationality, religion, disability, or other sensitive information.
- Never score accent, emotion, personality, honesty, enthusiasm, or culture fit. A report may capture only interest or motivation the candidate explicitly states in words.
- Do not make a hiring decision or tell the candidate whether they passed.
- After the final invitation, wait for the full answer. Then say a natural goodbye that thanks them and says the recruiting team will review the conversation. Only after the goodbye is spoken, call finish_screening.`;
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
      this.transcript.push({ speaker: "ScreenIT", text: event.transcript.trim() });
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
