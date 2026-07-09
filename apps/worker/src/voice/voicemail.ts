import type { createSupabaseClient } from "../db/supabase.js";
import type { HaloClient } from "../integrations/halo/client.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";
import { buildWav, BYTES_PER_SECOND } from "./audio.js";
import type { CallerTicket } from "./status-script.js";

/**
 * Voicemail pipeline: recorded 8 kHz PCM → WAV → OpenAI whisper-1 →
 * call_messages row → private Halo note on the matched ticket.
 *
 * Unknown/ambiguous callers still get their message transcribed and
 * stored (ticket_id null) and logged — no Halo note is posted.
 */

export const MAX_RECORDING_SECONDS = 120;
const MIN_RECORDING_BYTES = BYTES_PER_SECOND / 2; // ignore < 0.5s of audio

export interface VoicemailDeps {
  readonly supabase: ReturnType<typeof createSupabaseClient>;
  readonly halo: HaloClient;
}

export interface RecordedMessage {
  readonly callerNumber: string;
  readonly pcm: Buffer;
  readonly ticket: Pick<CallerTicket, "id" | "halo_id"> | null;
  readonly callerName?: string | null;
}

async function transcribeRecording(pcm: Buffer): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[VOICE] OPENAI_API_KEY not set — cannot transcribe");
    return null;
  }
  try {
    const wav = buildWav(pcm);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "message.wav");
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error(`[VOICE] Transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch (error) {
    console.error("[VOICE] Transcription request failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function prettyPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : raw;
}

/** Phone numbers spoken in the message — surfaced as an explicit callback row. */
function extractPhoneNumbers(text: string): string[] {
  const matches = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  return [...new Set(matches.map(prettyPhone))];
}

const URGENT_WORDS = /\b(asap|urgent(?:ly)?|emergency|immediately|right away|as soon as possible|critical|can'?t work|down right now)\b/i;

/** Same dark-table styling family as buildCallSummaryNote (call-analysis). */
function buildPhoneMessageNote(callerNumber: string, transcript: string, durationSeconds: number, callerName?: string | null): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const callerLabel = callerName ? ` — ${callerName}` : "";
  const urgent = URGENT_WORDS.test(transcript);
  const urgentChip = urgent
    ? `<span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:9999px;background:#fbbf24;color:#451a03;font-size:10px;font-weight:800;letter-spacing:0.5px;vertical-align:middle;">URGENT</span>`
    : "";

  // Bold any phone number inside the message so it can't be skimmed past
  const highlighted = transcript.replace(
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
    (m) => `<strong style="color:#fca5a5;white-space:nowrap;">${prettyPhone(m)}</strong>`,
  );

  const callbackNumbers = extractPhoneNumbers(transcript);
  const callbackRow = callbackNumbers.length > 0
    ? `<tr style="background:#162216;"><td style="padding:7px 12px;${border}font-size:12px;color:#bbf7d0;">` +
      `<span style="color:#4ade80;font-weight:700;font-size:10.5px;letter-spacing:0.5px;">CALL BACK</span>` +
      `&nbsp;&nbsp;${callbackNumbers.map((n) => `<strong style="color:#86efac;font-size:13px;">${n}</strong>`).join(" · ")}` +
      `</td></tr>`
    : "";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:9px 12px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:white;font-size:13px;font-weight:700;">🎙 Phone Message${callerLabel}${urgentChip}` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;padding-top:1px;">${when}${durationSeconds > 0 ? ` · ${durationSeconds}s` : ""} · ${prettyPhone(callerNumber)}</span>` +
    `</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:12px 14px;${border}">` +
    `<div style="border-left:3px solid #b91c1c;padding:2px 0 2px 12px;font-size:13.5px;color:#f1f5f9;line-height:1.65;font-style:italic;">&ldquo;${highlighted}&rdquo;</div>` +
    `</td></tr>` +
    callbackRow +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">TriageIt AI · recorded on the automated phone line</td></tr>` +
    `</table>`
  );
}

/**
 * Text message captured by the conversational assistant (the caller
 * dictated it and the model relayed the text — no separate whisper pass).
 * Same storage + note + Teams-alert path as a recorded voicemail.
 */
export async function processTextMessage(
  deps: VoicemailDeps,
  message: { readonly callerNumber: string; readonly text: string; readonly ticket: Pick<CallerTicket, "id" | "halo_id"> | null; readonly callerName?: string | null },
): Promise<void> {
  await storeAndDeliverMessage(deps, message.callerNumber, message.text, 0, message.ticket, message.callerName);
}

/**
 * Transcribe, store, and (when a ticket matched) post the message as a
 * private note. Never throws — every failure is logged with [VOICE].
 */
export async function processVoicemail(deps: VoicemailDeps, message: RecordedMessage): Promise<void> {
  const durationSeconds = Math.round(message.pcm.length / BYTES_PER_SECOND);
  if (message.pcm.length < MIN_RECORDING_BYTES) {
    console.log(`[VOICE] Recording from ${message.callerNumber} too short (${message.pcm.length} bytes) — discarded`);
    return;
  }

  const transcript = await transcribeRecording(message.pcm);
  await storeAndDeliverMessage(deps, message.callerNumber, transcript, durationSeconds, message.ticket, message.callerName);
}

async function storeAndDeliverMessage(
  deps: VoicemailDeps,
  callerNumber: string,
  transcript: string | null,
  durationSeconds: number,
  ticket: Pick<CallerTicket, "id" | "halo_id"> | null,
  callerName?: string | null,
): Promise<void> {
  const message = { callerNumber, ticket };
  let messageId: string | null = null;
  try {
    const { data, error } = await deps.supabase
      .from("call_messages")
      .insert({
        caller_number: message.callerNumber,
        ticket_id: message.ticket?.id ?? null,
        halo_id: message.ticket?.halo_id ?? null,
        transcript,
        duration_seconds: durationSeconds,
        note_posted: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    messageId = data.id as string;
  } catch (error) {
    console.error("[VOICE] Failed to store call message:", error instanceof Error ? error.message : error);
  }

  if (!transcript) {
    console.warn(`[VOICE] Message from ${message.callerNumber} stored without transcript (${durationSeconds}s)`);
    return;
  }

  if (!message.ticket) {
    console.log(`[VOICE] Message from UNMATCHED caller ${message.callerNumber} (${durationSeconds}s): "${transcript}"`);
    // No ticket to note — alert the team on Teams instead so the message
    // is actually seen (call_messages alone is invisible to the techs)
    try {
      const { data: teamsIntegration } = await deps.supabase
        .from("integrations")
        .select("config")
        .eq("service", "teams")
        .eq("is_active", true)
        .maybeSingle();
      if (teamsIntegration?.config) {
        const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
        await teams.sendUnknownVoicemailAlert({
          callerNumber: message.callerNumber,
          transcript,
          durationSeconds,
        });
        console.log(`[VOICE] Teams alert sent for unmatched voicemail from ${message.callerNumber}`);
      }
    } catch (error) {
      console.error("[VOICE] Teams alert for unmatched voicemail failed:", error instanceof Error ? error.message : error);
    }
    return;
  }

  try {
    const note = buildPhoneMessageNote(message.callerNumber, transcript, durationSeconds, callerName);
    await deps.halo.addInternalNote(message.ticket.halo_id, note);
    if (messageId) {
      await deps.supabase.from("call_messages").update({ note_posted: true }).eq("id", messageId);
    }
    console.log(`[VOICE] Posted phone message on #${message.ticket.halo_id} (${message.callerNumber}, ${durationSeconds}s)`);
  } catch (error) {
    console.error(`[VOICE] Failed to post note on #${message.ticket.halo_id}:`, error instanceof Error ? error.message : error);
  }
}
