import Anthropic from "@anthropic-ai/sdk";
import { extractResponseText } from "../agents/llm-text.js";
import WebSocket from "ws";
import { buildCallerContext, type CallerContext, type CallerTicket } from "./status-script.js";
import { buildTicketBriefings, fetchLastCustomerUpdate, formatBriefing, toSpeakableText } from "./ticket-briefing.js";
import { processTextMessage, type VoicemailDeps } from "./voicemail.js";
import { pcm16ToUlaw, ulawToPcm16 } from "./ulaw.js";
import { DtmfMenuHandler, type VoiceCallContext, type VoiceCallHandler } from "./session.js";
import { buildEscalationCallNote } from "./escalation-note.js";

/**
 * Stage 2 voice: conversational assistant on the OpenAI Realtime API.
 *
 * Bridges the 3CX call-control PCM stream (16-bit 8 kHz) to a `gpt-realtime`
 * WebSocket session speaking g711 μ-law — same 8 kHz sample rate, so the
 * bridge is a pure per-sample codec with no resampling. The model carries
 * the conversation (greeting, ticket status, reading the latest
 * customer-facing update aloud, taking messages, creating tickets) through
 * function tools that hit the same Supabase/Halo paths as the DTMF menu.
 *
 * If the Realtime socket cannot be established the call transparently
 * falls back to the Stage-1 keypad menu — a phone line must never answer
 * with dead air.
 */

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const DEFAULT_MODEL = process.env.VOICE_REALTIME_MODEL ?? "gpt-realtime";
const VOICE = process.env.VOICE_REALTIME_VOICE ?? "marin";
const CONNECT_TIMEOUT_MS = 7_000;
/**
 * Server-VAD tuning for a PHONE line: the default threshold (0.5) fires on
 * breathing and line noise — the assistant kept "hearing" callers who
 * hadn't spoken (user report 2026-07-09). Louder-than-breath speech only,
 * and a slightly longer silence window so natural pauses don't cut people
 * off. Env-tunable without a code change.
 */
const VAD_THRESHOLD = Number(process.env.VOICE_VAD_THRESHOLD ?? "0.85");
const VAD_SILENCE_MS = Number(process.env.VOICE_VAD_SILENCE_MS ?? "800");
const VAD_PREFIX_MS = Number(process.env.VOICE_VAD_PREFIX_MS ?? "300");
/** Hard cost/runaway cap — nobody needs a 15-minute robot call. */
const MAX_CALL_MS = 10 * 60_000;
/** Buffer caller audio into ~100ms chunks before appending upstream. */
const INPUT_CHUNK_BYTES = 1600;

interface FunctionCall {
  readonly name: string;
  readonly callId: string;
  readonly args: Record<string, unknown>;
}

/** Outbound SLA-escalation call: the assistant calls the TECH about a breached ticket. */
export interface EscalationContext {
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly techName: string | null;
  readonly hoursOver: number | null;
  readonly lastTechUpdate: string | null;
  /** The last real communication on the ticket, preformatted for reading aloud
   * (e.g. "private note from Jarid on July 9: 'waiting on the vendor'"). */
  readonly lastCommunication?: string | null;
  /** Custom mission (e.g. from Prison Mike: "ask the tech for a status update on X"). Null = standard SLA breach script. */
  readonly objective?: string | null;
}

export class RealtimeVoiceHandler implements VoiceCallHandler {
  private ctx: VoiceCallContext | null = null;
  private ws: WebSocket | null = null;
  private fallback: DtmfMenuHandler | null = null;
  private callerContext: CallerContext | null = null;
  private lastLookedUpTicket: CallerTicket | null = null;
  private inputBuffer: Buffer = Buffer.alloc(0);
  private maxCallTimer: ReturnType<typeof setTimeout> | null = null;
  private ended = false;
  /** Verbatim exchange, in order — posted to the ticket on escalation calls. */
  private transcript: Array<{ who: string; text: string }> = [];
  // Escalation-call notes are consolidated into ONE ticket note at call end
  // (posting from post_note/set_resolution_target AND onCallEnd produced two
  // near-duplicate notes per call). Tool handlers buffer here instead.
  private agentCallNotes: string[] = [];
  private agreedTarget: { reason: string; when: string } | null = null;

  constructor(
    private readonly deps: VoicemailDeps,
    private readonly escalation: EscalationContext | null = null,
  ) {}

  async onCallStart(ctx: VoiceCallContext): Promise<void> {
    this.ctx = ctx;
    try {
      let briefing: string;
      if (this.escalation) {
        briefing = ""; // escalation instructions carry everything
      } else {
        this.callerContext = await buildCallerContext(this.deps.supabase, this.deps.halo, ctx.callerNumber);
        const briefings = await buildTicketBriefings(this.deps.halo, this.callerContext);
        briefing = formatBriefing(this.callerContext, briefings);
      }

      this.ws = await this.connect();
      this.sendSessionUpdate(briefing);
      // Model speaks first — a phone line that answers silently reads as dead
      this.send({
        type: "response.create",
        response: {
          instructions: this.escalation
            ? (this.escalation.objective
                ? `The tech just answered. Greet them by first name, identify yourself as the TriageIt assistant from Gamma Tech calling on behalf of management, and say this is in regards to ticket ${this.escalation.haloId}, "${this.escalation.summary}". ${this.escalation.lastCommunication ? `Mention the last communication on file: ${this.escalation.lastCommunication}. ` : ""}Then ask your question. Two or three short sentences, then stop and listen.`
                : `The tech just answered. Greet them by first name, identify yourself as the TriageIt assistant from Gamma Tech, and say this is in regards to ticket ${this.escalation.haloId}, "${this.escalation.summary}", which has breached its SLA. ${this.escalation.lastCommunication ? `Then say the last communication you see on file: ${this.escalation.lastCommunication}. ` : ""}Then ask why it breached. Two or three short sentences, then stop and listen.`)
            : "Greet the caller now. Thank them for calling Gamma Tech, and if they are a known caller with open tickets, briefly mention you can give updates on their ticket(s), take a message, or help with something new. One or two short sentences, then stop and listen.",
        },
      });

      this.maxCallTimer = setTimeout(() => {
        console.log(`[VOICE] Realtime call from ${ctx.callerNumber} hit the ${MAX_CALL_MS / 60_000}-minute cap — ending`);
        void this.hangup();
      }, MAX_CALL_MS);
      this.maxCallTimer.unref?.();
      console.log(
        this.escalation
          ? `[VOICE] SLA escalation call live to ${ctx.callerNumber} (ticket #${this.escalation.haloId})`
          : `[VOICE] Realtime session live for ${ctx.callerNumber} (${this.callerContext?.knownCaller ? "known" : "unknown"} caller, ${this.callerContext?.spokenTickets.length ?? 0} open tickets)`,
      );
    } catch (error) {
      console.error("[VOICE] Realtime connect failed — falling back to keypad menu:", error instanceof Error ? error.message : error);
      this.ws?.terminate();
      this.ws = null;
      this.fallback = new DtmfMenuHandler(this.deps);
      await this.fallback.onCallStart(ctx);
    }
  }

  onDtmf(digit: string): void {
    if (this.fallback) {
      this.fallback.onDtmf(digit);
      return;
    }
    // Keypad input during a conversation becomes text the model can react to
    // (e.g. caller keys a ticket number instead of saying it)
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: `[The caller pressed the ${digit} key on their phone keypad]` }] },
    });
  }

  onAudioFrame(pcm8k: Buffer): void {
    if (this.fallback) {
      this.fallback.onAudioFrame(pcm8k);
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.inputBuffer = Buffer.concat([this.inputBuffer, pcm8k]);
    while (this.inputBuffer.length >= INPUT_CHUNK_BYTES) {
      const chunk = this.inputBuffer.subarray(0, INPUT_CHUNK_BYTES);
      this.inputBuffer = this.inputBuffer.subarray(INPUT_CHUNK_BYTES);
      this.send({ type: "input_audio_buffer.append", audio: pcm16ToUlaw(Buffer.from(chunk)).toString("base64") });
    }
  }

  async onCallEnd(): Promise<void> {
    this.ended = true;
    if (this.maxCallTimer) clearTimeout(this.maxCallTimer);
    if (this.fallback) {
      await this.fallback.onCallEnd();
      return;
    }
    this.ws?.close();
    this.ws = null;

    // Escalation calls leave ONE consolidated note on the ticket: what the
    // assistant documented (post_note / agreed target) + the verbatim
    // transcript (user requirement) — never two notes for the same call.
    if (this.escalation && (this.agentCallNotes.length > 0 || this.agreedTarget) && this.transcript.length === 0) {
      try {
        await this.deps.halo.addInternalNote(
          this.escalation.haloId,
          buildEscalationCallNote({
            title: `Escalation call — ${this.escalation.techName ?? "tech"}`,
            tone: "breach",
            meta: `Ticket #${this.escalation.haloId}`,
            intro: this.agentCallNotes.join(" ") || undefined,
            fields: this.agreedTarget ? [{ label: "Reason given", value: this.agreedTarget.reason }] : undefined,
            highlight: this.agreedTarget ? { label: "Next action target (set on the call)", value: this.agreedTarget.when } : undefined,
          }),
        );
      } catch (error) {
        console.error(`[VOICE] Failed to post call note on #${this.escalation.haloId}:`, error instanceof Error ? error.message : error);
      }
    }
    if (this.escalation && this.transcript.length > 0) {
      const esc = (t: string) => t.replace(/</g, "&lt;");
      const rawTranscript = this.transcript.map((l) => `${l.who}: ${l.text}`).join("\n");
      // Techs here often speak Spanish — post the summary AND the verbatim
      // transcript in ENGLISH (user requirement), falling back to the raw text
      // if the translate/summarize call fails.
      let summary = "";
      let englishTranscript = rawTranscript;
      try {
        const anthropic = new Anthropic();
        const res = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          messages: [{ role: "user", content: `Below is a phone call transcript between the TriageIt assistant and a technician. Parts may be in Spanish or another language.\n\nReturn EXACTLY this format and nothing else:\nSUMMARY: <2-3 plain ENGLISH sentences — what was discussed, what the tech said, any commitment made>\n---\n<the full transcript with EVERY line translated to natural English, keeping each line as "Speaker: text" in the SAME order with the SAME speaker labels>\n\nTranscript:\n${rawTranscript}` }],
        });
        const out = extractResponseText(res).trim();
        const parts = out.split(/\n---\n/);
        summary = parts[0].replace(/^SUMMARY:\s*/i, "").trim();
        if (parts.length > 1 && parts.slice(1).join("\n---\n").trim()) {
          englishTranscript = parts.slice(1).join("\n---\n").trim();
        }
      } catch {
        // transcript still posts (untranslated) without a summary
      }
      const lines = englishTranscript
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const idx = line.indexOf(":");
          const who = idx > 0 ? line.slice(0, idx).trim() : "";
          const text = idx > 0 ? line.slice(idx + 1).trim() : line.trim();
          const color = who === "TriageIt" ? "#94a3b8" : "#fbbf24";
          return who
            ? `<b style="color:${color};">${esc(who)}:</b> ${esc(text)}`
            : esc(text);
        })
        .join("<br/>");
      try {
        await this.deps.halo.addInternalNote(
          this.escalation.haloId,
          buildEscalationCallNote({
            title: `Escalation call — ${this.escalation.techName ?? "tech"}`,
            tone: "breach",
            meta: `Ticket #${this.escalation.haloId}`,
            // The assistant's own documentation is the most accurate record
            // of what was agreed — AI summary only fills in when it's absent.
            intro: this.agentCallNotes.join(" ") || summary || undefined,
            fields: this.agreedTarget ? [{ label: "Reason given", value: this.agreedTarget.reason }] : undefined,
            highlight: this.agreedTarget ? { label: "Next action target (set on the call)", value: this.agreedTarget.when } : undefined,
            collapsed: { summary: `Full verbatim transcript (${this.transcript.length} exchanges)`, html: lines },
          }),
        );
        console.log(`[VOICE] Escalation transcript posted on #${this.escalation.haloId} (${this.transcript.length} lines)`);
      } catch (error) {
        console.error(`[VOICE] Failed to post transcript on #${this.escalation.haloId}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // ── Realtime plumbing ───────────────────────────────────────────────

  private connect(): Promise<WebSocket> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Promise.reject(new Error("OPENAI_API_KEY not set"));

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${REALTIME_URL}?model=${encodeURIComponent(DEFAULT_MODEL)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Realtime connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      ws.on("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.on("message", (raw) => this.handleServerEvent(raw.toString()));
      ws.on("close", () => {
        if (!this.ended) {
          console.warn("[VOICE] Realtime socket closed mid-call — ending call");
          void this.hangup();
        }
      });
    });
  }

  private send(event: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  private sendSessionUpdate(briefing: string): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: this.buildInstructions(briefing),
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            noise_reduction: { type: "far_field" },
            // Verbatim transcript of what the caller/tech says — escalation
            // calls post it to the ticket
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: VAD_THRESHOLD,
              prefix_padding_ms: VAD_PREFIX_MS,
              silence_duration_ms: VAD_SILENCE_MS,
              interrupt_response: true,
              create_response: true,
            },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: VOICE,
          },
        },
        tools: this.toolDefinitions(),
        tool_choice: "auto",
      },
    });
  }

  private handleServerEvent(raw: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(event.type ?? "");

    switch (type) {
      // GA name and the older beta name — accept both
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const delta = typeof event.delta === "string" ? event.delta : null;
        if (delta && this.ctx) {
          this.ctx.sendAudio(ulawToPcm16(Buffer.from(delta, "base64")));
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) this.transcript.push({ who: this.escalation?.techName ?? "Caller", text });
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) this.transcript.push({ who: "TriageIt", text });
        break;
      }
      case "input_audio_buffer.speech_started":
        // Barge-in: the server cancels its response; we drop queued playback
        this.ctx?.stopAudio();
        break;
      case "response.function_call_arguments.done": {
        const call: FunctionCall = {
          name: String(event.name ?? ""),
          callId: String(event.call_id ?? ""),
          args: this.parseArgs(event.arguments),
        };
        void this.dispatchTool(call);
        break;
      }
      case "error":
        console.error("[VOICE] Realtime error event:", JSON.stringify(event.error ?? event).slice(0, 300));
        break;
      default:
        break;
    }
  }

  private parseArgs(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "string") return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────

  private toolDefinitions(): ReadonlyArray<Record<string, unknown>> {
    if (this.escalation) {
      return [
        {
          type: "function",
          name: "set_resolution_target",
          description:
            "Update the ticket's resolution target — which at Gamma Tech marks when the NEXT ACTION is expected, NOT when the ticket will be fully closed — to the date/time the tech committed to. Only after the tech clearly agreed and you confirmed the exact date and time back to them.",
          parameters: {
            type: "object",
            properties: {
              new_target: { type: "string", description: "The agreed next-action date/time in ISO 8601 with Eastern offset, e.g. 2026-07-10T14:00:00-04:00" },
              reason: { type: "string", description: "Why the SLA breached and what the next action is, in the tech's words" },
            },
            required: ["new_target", "reason"],
          },
        },
        {
          type: "function",
          name: "post_note",
          description: "Post an internal note on the ticket documenting this call (use when the tech declines a new target, gives context, or you reached voicemail).",
          parameters: {
            type: "object",
            properties: { note: { type: "string", description: "What was said / the outcome of this call" } },
            required: ["note"],
          },
        },
        {
          type: "function",
          name: "end_call",
          description: "Hang up. Use after wrapping up, or after leaving a brief voicemail if a machine answered.",
          parameters: { type: "object", properties: {} },
        },
      ];
    }
    const tools: Record<string, unknown>[] = [
      {
        type: "function",
        name: "lookup_ticket",
        description:
          "Look up a support ticket by its number. Returns status, assigned tech, and the latest customer-facing update so you can read it to the caller.",
        parameters: {
          type: "object",
          properties: { ticket_number: { type: "integer", description: "The ticket number the caller gave" } },
          required: ["ticket_number"],
        },
      },
      {
        type: "function",
        name: "leave_message",
        description:
          "Save a message from the caller for the technician. Use after the caller dictates their message and confirms it. The message lands on their ticket as a note the tech will see.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The caller's message, cleaned up, in their words" },
            ticket_number: { type: "integer", description: "Ticket to attach it to, when the caller named one" },
          },
          required: ["message"],
        },
      },
      {
        type: "function",
        name: "end_call",
        description: "Hang up the call. Use only after saying goodbye and the caller has nothing else.",
        parameters: { type: "object", properties: {} },
      },
    ];

    if (this.callerContext?.knownCaller && this.callerContext.users.length > 0) {
      tools.push({
        type: "function",
        name: "create_ticket",
        description:
          "Open a NEW support ticket for the caller's issue. Use only for a new problem that no existing open ticket covers, after summarizing the issue back to the caller and getting a yes.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "One-line issue title" },
            details: { type: "string", description: "The issue as the caller described it, plus any impact/urgency they mentioned" },
          },
          required: ["summary", "details"],
        },
      });
    }
    return tools;
  }

  private async dispatchTool(call: FunctionCall): Promise<void> {
    let output: Record<string, unknown>;
    try {
      switch (call.name) {
        case "set_resolution_target": {
          if (!this.escalation) {
            output = { error: "Not available on this call" };
            break;
          }
          const target = new Date(String(call.args.new_target ?? ""));
          if (!Number.isFinite(target.getTime()) || target.getTime() < Date.now()) {
            output = { error: "Invalid or past date — confirm the date and time with the tech again" };
            break;
          }
          await this.deps.halo.updateResolutionTarget(this.escalation.haloId, target.toISOString());
          const when = target.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          // Target updated in Halo immediately; the note documenting it is
          // folded into the single end-of-call note (no duplicate notes).
          this.agreedTarget = { reason: String(call.args.reason ?? "").slice(0, 500), when: `${when} ET` };
          console.log(`[VOICE] SLA escalation: #${this.escalation.haloId} resolution target -> ${target.toISOString()}`);
          output = { ok: true, new_target_confirmed: when + " Eastern" };
          break;
        }
        case "post_note": {
          if (!this.escalation) {
            output = { error: "Not available on this call" };
            break;
          }
          // Buffered — lands in the single end-of-call note instead of
          // posting a second near-duplicate note alongside the transcript.
          const note = String(call.args.note ?? "").slice(0, 800).trim();
          if (note) this.agentCallNotes.push(note);
          output = { ok: true };
          break;
        }
        case "lookup_ticket":
          output = await this.toolLookupTicket(Number(call.args.ticket_number));
          break;
        case "leave_message":
          output = await this.toolLeaveMessage(String(call.args.message ?? ""), call.args.ticket_number ? Number(call.args.ticket_number) : null);
          break;
        case "create_ticket":
          output = await this.toolCreateTicket(String(call.args.summary ?? ""), String(call.args.details ?? ""));
          break;
        case "end_call":
          this.send({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: true }) },
          });
          // Give the goodbye audio a moment to drain before dropping
          setTimeout(() => void this.hangup(), 3_000).unref?.();
          return;
        default:
          output = { error: `Unknown tool ${call.name}` };
      }
    } catch (error) {
      console.error(`[VOICE] Tool ${call.name} failed:`, error instanceof Error ? error.message : error);
      output = { error: "The system could not complete that right now." };
    }

    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) },
    });
    this.send({ type: "response.create" });
  }

  /** Same client-scoping rules as the DTMF menu's ticket lookup. */
  private async toolLookupTicket(ticketNumber: number): Promise<Record<string, unknown>> {
    if (!Number.isFinite(ticketNumber) || ticketNumber <= 0) return { error: "Invalid ticket number" };

    const pocOpenLookup = process.env.VOICE_OPEN_TICKET_LOOKUP === "true";
    const callerClient = this.callerContext?.clientName ?? null;
    if (!pocOpenLookup && (!this.callerContext?.knownCaller || !callerClient)) {
      return { error: "Caller's number is not recognized — ticket details cannot be shared on this call. Offer to take a message instead." };
    }

    let query = this.deps.supabase
      .from("tickets")
      .select("id, halo_id, summary, user_name, client_name, halo_status, halo_agent")
      .eq("halo_id", ticketNumber);
    if (!pocOpenLookup && callerClient) query = query.eq("client_name", callerClient);
    const { data: ticket } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!ticket) return { found: false, note: "No ticket with that number for the caller's company." };

    this.lastLookedUpTicket = ticket as CallerTicket;
    const lastUpdate = await fetchLastCustomerUpdate(this.deps.halo, Number(ticket.halo_id));
    return {
      found: true,
      ticket_number: ticket.halo_id,
      summary: toSpeakableText(String(ticket.summary ?? ""), 150),
      status: ticket.halo_status ?? "open",
      assigned_tech: ticket.halo_agent ?? null,
      latest_customer_update: lastUpdate,
    };
  }

  private async toolLeaveMessage(message: string, ticketNumber: number | null): Promise<Record<string, unknown>> {
    const text = message.trim();
    if (!text) return { error: "Empty message" };

    let ticket: Pick<CallerTicket, "id" | "halo_id"> | null = null;
    if (ticketNumber) {
      const scoped = await this.toolLookupTicket(ticketNumber);
      if (scoped.found && this.lastLookedUpTicket?.halo_id === ticketNumber) ticket = this.lastLookedUpTicket;
    }
    ticket = ticket ?? this.callerContext?.voicemailTicket ?? this.lastLookedUpTicket ?? null;

    await processTextMessage(this.deps, {
      callerNumber: this.ctx?.callerNumber ?? "unknown",
      text,
      ticket,
      callerName: this.callerContext?.users[0]?.name ?? null,
    });
    return {
      ok: true,
      delivered_to: ticket ? `ticket ${ticket.halo_id}` : "the team (no specific ticket — sent as a team alert)",
    };
  }

  private async toolCreateTicket(summary: string, details: string): Promise<Record<string, unknown>> {
    if (!summary.trim() || !details.trim()) return { error: "Summary and details are required" };
    const user = this.callerContext?.users[0];
    if (!user) return { error: "Only recognized callers can open tickets by phone. Offer to take a message instead." };

    const haloId = await this.deps.halo.createTicket({
      summary: summary.trim().slice(0, 120),
      details: `${details.trim()}\n\n— Opened by the TriageIt phone assistant on a call from ${this.ctx?.callerNumber ?? "unknown"} (caller: ${user.name}).`,
      userId: user.id,
    });
    console.log(`[VOICE] Created ticket #${haloId} by voice for ${user.name} (${this.ctx?.callerNumber})`);
    return { ok: true, ticket_number: haloId };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private buildInstructions(briefing: string): string {
    if (this.escalation) {
      const e = this.escalation;
      const over = e.hoursOver != null ? (e.hoursOver >= 1 ? `${e.hoursOver.toFixed(1)} hours` : `${Math.round(e.hoursOver * 60)} minutes`) : "recently";
      return [
        `You are the TriageIt assistant from Gamma Tech Services, making an OUTBOUND call to ${e.techName ?? "the assigned technician"} — a Gamma Tech technician — about a ticket that has breached its SLA. You are professional, direct, and respectful: a firm colleague, not a scold.`,
        ``,
        `THE SITUATION`,
        `- Ticket ${e.haloId}: "${e.summary}" for ${e.clientName ?? "a client"}.`,
        e.objective ? `- You are calling for information, not about a breach.` : `- It is ${over} past its SLA.`,
        `- The last communication on file: ${e.lastCommunication ?? e.lastTechUpdate ?? "none on record"}.`,
        ``,
        `ABOUT THE "RESOLUTION TARGET" / NEXT-ACTION DATE`,
        `- At Gamma Tech, the ticket's resolution-target date does NOT mean when the ticket will be fully closed — tickets can legitimately take days. It marks when the NEXT ACTION on the ticket is expected. So you are asking for the tech's next step and WHEN it will happen, not a final close date.`,
        ``,
        ...(e.objective
          ? [
              `YOUR MISSION (requested by Gamma Tech management via the TriageIt console)`,
              `${e.objective}`,
              `Ask about it conversationally, capture what the tech says, then use post_note to document their answer on the ticket. Do NOT change the resolution target on this call unless your mission explicitly asks you to negotiate or change the next-action date.`,
            ]
          : [
        `YOUR GOALS, IN ORDER`,
        `1. Open by saying this is about ticket ${e.haloId}, "${e.summary}", and read the last communication on file so the tech knows exactly which ticket and where it stands.`,
        `2. Ask directly: why did this ticket breach its SLA / why wasn't the next step taken in time? Get their reason on record — listen, don't argue.`,
        `3. Ask when the NEXT ACTION will take place (not when it will be fully resolved — remind them the resolution date is our next-action marker). When they give a date/time, CONFIRM it back exactly ("so the next update is tomorrow, July tenth at two PM — correct?"), and after a clear yes use set_resolution_target. Then tell them it's updated.`,
        `4. If they refuse, can't say, or it's not their ticket anymore — use post_note documenting exactly what they said, and tell them management (Aniel and David) will follow up.`,
        `5. If a VOICEMAIL answers: leave one brief message ("this is the Gamma Tech assistant — ticket ${e.haloId}, ${e.summary}, has breached its SLA, please update it or call the office"), use post_note saying you reached voicemail, then end_call.`,
            ]),
        ``,
        `PHONE RULES`,
        `- Short turns, one to two sentences, then listen. Read numbers digit by digit.`,
        `- Today is ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" })} — resolve relative dates ("tomorrow at 2") against this.`,
        `- Never invent ticket facts beyond what's above. When done, say goodbye and use end_call.`,
      ].join("\n");
    }
    return [
      `You are the Gamma Tech phone assistant, live on a phone call with a customer of Gamma Tech Services, an IT support company in Naples, Florida. You sound like a warm, capable front-desk person — natural, unhurried, plain English, no jargon, no corporate filler.`,
      ``,
      `PHONE RULES`,
      `- Keep every turn SHORT: one to three sentences, then stop and let the caller talk.`,
      `- Read numbers digit by digit ("four zero eight seven nine").`,
      `- Never invent ticket facts. Everything you say about a ticket must come from the briefing below or a tool result. If you don't have it, say so and offer to take a message.`,
      `- Only discuss tickets that belong to the caller's company.`,
      ``,
      `WHAT YOU CAN DO`,
      `- Give a status update: say the status in plain words and, when there is one, read the latest update we sent the customer — summarized naturally, not word for word.`,
      `- Explain what a status means for THEM: "Waiting on Customer" means the technician needs something from the caller — tell them that and what happens next. "PAST-DUE" or breach states: reassure and offer to flag it for the team.`,
      `- Take a message: have them say it, repeat the gist back, confirm, then use leave_message.`,
      `- Open a new ticket (recognized callers only): collect what's wrong and the impact, summarize it back, get a clear yes, then create_ticket, and read them the new ticket number.`,
      `- Look up any ticket they name with lookup_ticket.`,
      ``,
      `CONVERSATION SHAPE`,
      `- Proactive: if their ticket is Waiting on Customer, lead with that — "the technician is waiting on you for X — would you like to pass that along now, or shall I take a message?"`,
      `- If the caller sounds frustrated, acknowledge it once, plainly, and get to helping.`,
      `- When the caller is done, say a short goodbye and use end_call.`,
      ``,
      `CALLER BRIEFING (fetched live from our ticket system for THIS call)`,
      briefing,
    ].join("\n");
  }

  private async hangup(): Promise<void> {
    try {
      await this.ctx?.hangup();
    } catch (error) {
      console.warn("[VOICE] Hangup failed:", error instanceof Error ? error.message : error);
    }
  }
}
