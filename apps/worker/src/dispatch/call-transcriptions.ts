import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig, ThreeCxConfig } from "@triageit/shared";
import { ThreeCxClient, type ThreeCxRecording } from "../integrations/threecx/client.js";

interface CallAnalysisRow {
  readonly recording_id: number;
  readonly ticket_id: string | null;
  readonly halo_id: number | null;
  readonly tech_name: string | null;
  readonly external_number: string | null;
  readonly direction: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly transcript_chars: number | null;
  readonly transcript: string | null;
  readonly matched_by: string | null;
  readonly summary: string | null;
  readonly note_posted: boolean;
  readonly analysis_attempts: number;
}

interface TicketLookup {
  readonly id: string;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
}

export interface CallTranscriptionItem {
  readonly recordingId: number;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly direction: "inbound" | "outbound" | "unknown";
  readonly techName: string;
  readonly externalNumber: string | null;
  readonly transcript: string | null;
  readonly transcriptChars: number;
  readonly callSummary: string | null;
  readonly matchState: "matched" | "unmatched" | "attention";
  readonly matchMethod: string;
  readonly matchLabel: string;
  readonly notePosted: boolean;
  readonly analysisAttempts: number;
  readonly ticket: {
    readonly haloId: number;
    readonly summary: string | null;
    readonly clientName: string | null;
    readonly status: string | null;
  } | null;
}

export interface CallTranscriptionPayload {
  readonly generatedAt: string;
  readonly haloBaseUrl: string;
  readonly sourceAvailable: boolean;
  readonly items: ReadonlyArray<CallTranscriptionItem>;
  readonly counts: { readonly total: number; readonly matched: number; readonly unmatched: number; readonly attention: number };
}

let cache: { readonly at: number; readonly payload: CallTranscriptionPayload } | null = null;
const CACHE_MS = 60_000;
const RECENT_CALL_LIMIT = 75;

function directionOf(value: string | null): CallTranscriptionItem["direction"] {
  return value === "inbound" || value === "outbound" ? value : "unknown";
}

export function callMatchLabel(method: string | null): string {
  const base = (method ?? "unknown").replace(/_(?:other_staff|note_failed|analysis_failed|irrelevant)$/g, "");
  const labels: Record<string, string> = {
    spoken_ticket_number: "Ticket number spoken on call",
    spoken_name_assigned_tech: "Customer name and assigned tech",
    user_phone: "Customer phone number",
    llm_transcript: "Transcript matched to client ticket",
    llm_transcript_user: "Transcript matched to customer ticket",
    llm_transcript_client: "Transcript matched within client",
    llm_transcript_shared_phone: "Transcript matched from shared number",
    llm_transcript_named: "Spoken customer name and transcript",
    llm_transcript_global: "Transcript matched across open tickets",
    transcript_too_short: "Transcript unavailable or too short",
    no_external_number: "No external caller number",
    no_halo_user: "Caller not found and transcript had no safe match",
    shared_phone_no_transcript_match: "Shared number with no clear ticket match",
    ambiguous_multiple_open: "Several possible open tickets",
    no_open_ticket: "No open ticket for this caller",
    error: "Analysis failed",
    cursor_seed: "Processing cursor",
    unknown: "No match reason recorded",
  };
  const label = labels[base] ?? base.replaceAll("_", " ");
  if (method?.endsWith("_note_failed")) return `${label}; Halo note failed`;
  if (method?.endsWith("_analysis_failed")) return `${label}; transcript analysis failed`;
  if (method?.endsWith("_irrelevant")) return `${label}; call was not relevant to ticket`;
  return label;
}

function inferExternalNumber(recording: ThreeCxRecording): string | null {
  const from = (recording.FromCallerNumber ?? "").replace(/\D/g, "");
  const to = (recording.ToCallerNumber ?? "").replace(/\D/g, "");
  if (from.length >= 7 && to.length < 7) return from;
  if (to.length >= 7 && from.length < 7) return to;
  return null;
}

async function loadRecentRecordings(
  supabase: SupabaseClient,
  rows: ReadonlyArray<CallAnalysisRow>,
): Promise<{ readonly available: boolean; readonly recordings: ReadonlyMap<number, ThreeCxRecording> }> {
  const missing = rows.filter((row) => !row.transcript && row.matched_by !== "cursor_seed");
  if (missing.length === 0) return { available: true, recordings: new Map() };

  const { data: integration, error } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "threecx")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !integration) return { available: false, recordings: new Map() };

  const minId = Math.min(...missing.map((row) => Number(row.recording_id)));
  const tcx = new ThreeCxClient(integration.config as ThreeCxConfig);
  const recordings = await tcx.getRecordingsSince(Math.max(0, minId - 1), 250);
  if (recordings === null) return { available: false, recordings: new Map() };

  const wanted = new Set(missing.map((row) => Number(row.recording_id)));
  const found = recordings.filter((recording) => wanted.has(recording.Id));
  const backfill = found
    .map((recording) => ({
      recording_id: recording.Id,
      transcript: (recording.Transcription ?? "").trim().slice(0, 100_000) || null,
      transcript_chars: (recording.Transcription ?? "").trim().length,
    }))
    .filter((recording) => recording.transcript);
  if (backfill.length > 0) {
    const { error: backfillError } = await supabase.from("call_analyses").upsert(backfill, { onConflict: "recording_id" });
    if (backfillError) console.warn("[CALLS] Could not persist transcript backfill:", backfillError.message);
  }
  return { available: true, recordings: new Map(found.map((recording) => [recording.Id, recording])) };
}

export async function buildCallTranscriptionPayload(supabase: SupabaseClient): Promise<CallTranscriptionPayload> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;

  const { data, error } = await supabase
    .from("call_analyses")
    .select("recording_id, ticket_id, halo_id, tech_name, external_number, direction, started_at, ended_at, transcript_chars, transcript, matched_by, summary, note_posted, analysis_attempts")
    .neq("matched_by", "cursor_seed")
    .order("recording_id", { ascending: false })
    .limit(RECENT_CALL_LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReadonlyArray<CallAnalysisRow>;

  const ticketIds = [...new Set(rows.map((row) => row.ticket_id).filter((id): id is string => Boolean(id)))];
  const ticketById = new Map<string, TicketLookup>();
  if (ticketIds.length > 0) {
    const { data: tickets, error: ticketError } = await supabase
      .from("tickets")
      .select("id, summary, client_name, halo_status")
      .in("id", ticketIds);
    if (ticketError) throw new Error(ticketError.message);
    for (const ticket of (tickets ?? []) as ReadonlyArray<TicketLookup>) ticketById.set(ticket.id, ticket);
  }

  const [recordingResult, haloResult] = await Promise.all([
    loadRecentRecordings(supabase, rows),
    supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).maybeSingle(),
  ]);
  const haloConfig = haloResult.data?.config as HaloConfig | undefined;

  const items = rows.map((row): CallTranscriptionItem => {
    const recording = recordingResult.recordings.get(Number(row.recording_id));
    const ticketLookup = row.ticket_id ? ticketById.get(row.ticket_id) : null;
    const hasMatch = row.halo_id != null;
    const attention = hasMatch && !row.note_posted;
    return {
      recordingId: Number(row.recording_id),
      startedAt: row.started_at ?? recording?.StartTime ?? null,
      endedAt: row.ended_at ?? recording?.EndTime ?? null,
      direction: directionOf(row.direction),
      techName: row.tech_name ?? "Unknown tech",
      externalNumber: row.external_number ?? (recording ? inferExternalNumber(recording) : null),
      transcript: row.transcript ?? recording?.Transcription?.trim() ?? null,
      transcriptChars: row.transcript_chars ?? recording?.Transcription?.length ?? 0,
      callSummary: row.summary,
      matchState: hasMatch ? (attention ? "attention" : "matched") : "unmatched",
      matchMethod: row.matched_by ?? "unknown",
      matchLabel: callMatchLabel(row.matched_by),
      notePosted: row.note_posted,
      analysisAttempts: row.analysis_attempts ?? 0,
      ticket: hasMatch
        ? {
            haloId: Number(row.halo_id),
            summary: ticketLookup?.summary ?? null,
            clientName: ticketLookup?.client_name ?? null,
            status: ticketLookup?.halo_status ?? null,
          }
        : null,
    };
  });
  const payload: CallTranscriptionPayload = {
    generatedAt: new Date().toISOString(),
    haloBaseUrl: haloConfig?.base_url ?? "",
    sourceAvailable: recordingResult.available,
    items,
    counts: {
      total: items.length,
      matched: items.filter((item) => item.ticket !== null).length,
      unmatched: items.filter((item) => item.ticket === null).length,
      attention: items.filter((item) => item.matchState === "attention").length,
    },
  };
  cache = { at: Date.now(), payload };
  return payload;
}
