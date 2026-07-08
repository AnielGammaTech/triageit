import type { createSupabaseClient } from "../db/supabase.js";
import type { HaloClient } from "../integrations/halo/client.js";
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

/** Same dark-table styling family as buildCallSummaryNote (call-analysis). */
function buildPhoneMessageNote(callerNumber: string, transcript: string, durationSeconds: number): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const prettyNumber = callerNumber.replace(/^\+?1(?=\d{10}$)/, "");
  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:8px 12px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:white;font-size:13px;font-weight:700;">🎙 Phone Message` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;">${when} · ${durationSeconds}s · ${prettyNumber}</span>` +
    `</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:7px 12px;${border}font-size:12.5px;color:#e2e8f0;line-height:1.5;">${transcript}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">TriageIt AI · recorded on the automated phone line</td></tr>` +
    `</table>`
  );
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
    return;
  }

  try {
    const note = buildPhoneMessageNote(message.callerNumber, transcript, durationSeconds);
    await deps.halo.addInternalNote(message.ticket.halo_id, note);
    if (messageId) {
      await deps.supabase.from("call_messages").update({ note_posted: true }).eq("id", messageId);
    }
    console.log(`[VOICE] Posted phone message on #${message.ticket.halo_id} (${message.callerNumber}, ${durationSeconds}s)`);
  } catch (error) {
    console.error(`[VOICE] Failed to post note on #${message.ticket.halo_id}:`, error instanceof Error ? error.message : error);
  }
}
