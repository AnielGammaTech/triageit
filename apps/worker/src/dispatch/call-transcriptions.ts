import type { SupabaseClient } from "@supabase/supabase-js";
import { isAccountManagerName, isSupportCallStaffName, type HaloConfig, type ThreeCxConfig } from "@triageit/shared";
import { ThreeCxClient, type ThreeCxRecording } from "../integrations/threecx/client.js";
import { resolveCnamIdentity, type CnamIdentity } from "../integrations/twilio/cnam-identity.js";
import { ignoredCallMethod } from "./call-ignore-policy.js";

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
  readonly call_type: string | null;
  readonly from_name: string | null;
  readonly from_number: string | null;
  readonly to_name: string | null;
  readonly to_number: string | null;
  readonly identified_customer_name: string | null;
  readonly identified_client_name: string | null;
  readonly match_evidence: string | null;
}

interface TicketLookup {
  readonly id: string;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
  readonly user_name: string | null;
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
  readonly matchState: "matched" | "unmatched" | "attention" | "internal" | "separate" | "ignored";
  readonly matchMethod: string;
  readonly matchLabel: string;
  readonly notePosted: boolean;
  readonly analysisAttempts: number;
  readonly identifiedCustomerName: string | null;
  readonly identifiedClientName: string | null;
  readonly cnamName: string | null;
  readonly cnamType: "BUSINESS" | "CONSUMER" | null;
  readonly matchEvidence: string | null;
  readonly callType: string | null;
  readonly from: { readonly name: string | null; readonly number: string | null };
  readonly to: { readonly name: string | null; readonly number: string | null };
  readonly ticket: {
    readonly haloId: number;
    readonly summary: string | null;
    readonly clientName: string | null;
    readonly status: string | null;
    readonly agentName: string | null;
    readonly customerName: string | null;
  } | null;
}

export interface CallTranscriptionPayload {
  readonly generatedAt: string;
  readonly haloBaseUrl: string;
  readonly sourceAvailable: boolean;
  readonly items: ReadonlyArray<CallTranscriptionItem>;
  readonly counts: { readonly total: number; readonly matched: number; readonly unmatched: number; readonly internal: number; readonly separate: number; readonly ignored: number; readonly attention: number };
}

let cache: { readonly at: number; readonly payload: CallTranscriptionPayload } | null = null;
const CACHE_MS = 60_000;
const RECENT_CALL_LIMIT = 75;

export function invalidateCallTranscriptionCache(): void {
  cache = null;
}

function directionOf(value: string | null): CallTranscriptionItem["direction"] {
  return value === "inbound" || value === "outbound" ? value : "unknown";
}

function itemPartyName(
  side: "from" | "to",
  direction: CallTranscriptionItem["direction"],
  rawName: string | null,
  customerName: string | null,
): string | null {
  const customerSide = (direction === "inbound" && side === "from") || (direction === "outbound" && side === "to");
  if (customerSide && customerName) return customerName;
  return rawName?.replace(/^\[V\]\s*/i, "").trim() || null;
}

export function cnamIdentityFromEvidence(
  evidence: string | null,
): { readonly name: string; readonly type: "BUSINESS" | "CONSUMER" | null } | null {
  const match = evidence?.match(/Twilio CNAM hint \((BUSINESS|CONSUMER|UNKNOWN)\):\s*(.+?)(?=\s+·\s+|$)/i);
  const name = match?.[2]?.trim();
  if (!name) return null;
  const rawType = match?.[1]?.toUpperCase();
  return {
    name,
    type: rawType === "BUSINESS" || rawType === "CONSUMER" ? rawType : null,
  };
}

function samePerson(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const tokens = (value: string) => new Set(value.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return [...leftTokens].filter((token) => rightTokens.has(token)).length >= 2;
}

export function shouldIncludeCallTranscription(
  item: Pick<CallTranscriptionItem, "techName" | "from" | "to" | "ticket" | "matchMethod">,
): boolean {
  if (item.matchMethod === "ignored_non_support_staff") return false;
  if ([item.techName, item.from.name, item.to.name].some((name) => isSupportCallStaffName(name))) return true;
  return Boolean(
    item.ticket
    && isAccountManagerName(item.techName)
    && samePerson(item.techName, item.ticket.agentName)
  );
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
    llm_transcript_cnam_user: "Caller-name contact hint and transcript",
    llm_transcript_cnam_client: "Caller-name client hint and transcript",
    llm_transcript_global: "Transcript matched across open tickets",
    llm_ticket_callback_number: "Callback number and transcript matched",
    manual_dispatch: "Matched by dispatch",
    internal_call: "Internal staff call",
    ignored_non_support_staff: "Outside the TriageIT support team",
    transcript_too_short: "Transcript unavailable or too short",
    no_external_number: "No external caller number",
    no_halo_user: "Caller not found and transcript had no safe match",
    identified_customer_no_ticket_match: "Customer identified; no related ticket found",
    confirmed_separate_call: "Confirmed by tech as a separate call",
    ignored_ivr: "Automated attendant or voicemail system",
    ignored_no_external_number: "No external caller to match",
    ignored_short_call: "Short non-actionable call",
    ignored_silence: "Silent or empty recording",
    ignored_unusable_recording: "Recording remained unusable after retries",
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

function callerIdNeedsName(rawName: string | null, externalNumber: string): boolean {
  if (!rawName?.trim()) return true;
  const nameDigits = rawName.replace(/\D/g, "");
  const numberDigits = externalNumber.replace(/\D/g, "");
  return nameDigits.length >= 7 && nameDigits.slice(-10) === numberDigits.slice(-10);
}

async function resolveRecentCnamNames(
  supabase: SupabaseClient,
  rows: ReadonlyArray<CallAnalysisRow>,
  recordings: ReadonlyMap<number, ThreeCxRecording>,
): Promise<ReadonlyMap<string, CnamIdentity>> {
  const resolved = new Map<string, CnamIdentity>();
  const candidates = new Set<string>();
  for (const row of rows.slice(0, RECENT_CALL_LIMIT)) {
    const evidenceIdentity = cnamIdentityFromEvidence(row.match_evidence);
    const recording = recordings.get(Number(row.recording_id));
    const externalNumber = row.external_number ?? (recording ? inferExternalNumber(recording) : null);
    if (externalNumber && evidenceIdentity) resolved.set(externalNumber, { ...evidenceIdentity, source: "twilio_cnam" });
    if (!externalNumber || evidenceIdentity) continue;
    const internal = row.matched_by === "internal_call" || /local/i.test(row.call_type ?? recording?.CallType ?? "");
    if (internal || !isSupportCallStaffName(row.tech_name)) continue;
    const direction = directionOf(row.direction);
    const rawCustomerName = direction === "inbound"
      ? (row.from_name ?? recording?.FromDisplayName?.trim() ?? null)
      : direction === "outbound"
        ? (row.to_name ?? recording?.ToDisplayName?.trim() ?? null)
        : null;
    if (callerIdNeedsName(rawCustomerName, externalNumber)) candidates.add(externalNumber);
  }

  const numbers = [...candidates];
  for (let index = 0; index < numbers.length; index += 5) {
    await Promise.all(numbers.slice(index, index + 5).map(async (number) => {
      const identity = await resolveCnamIdentity(supabase, number);
      if (identity) resolved.set(number, identity);
    }));
  }
  return resolved;
}

async function loadRecentRecordings(
  supabase: SupabaseClient,
  rows: ReadonlyArray<CallAnalysisRow>,
): Promise<{ readonly available: boolean; readonly recordings: ReadonlyMap<number, ThreeCxRecording> }> {
  const missing = rows.filter((row) => (!row.transcript || !row.from_name || !row.to_name) && row.matched_by !== "cursor_seed");
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
      call_type: recording.CallType ?? null,
      from_name: recording.FromDisplayName?.trim() || null,
      from_number: recording.FromCallerNumber?.trim() || null,
      to_name: recording.ToDisplayName?.trim() || null,
      to_number: recording.ToCallerNumber?.trim() || null,
    }))
    .filter((recording) => recording.recording_id > 0);
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
    .select("recording_id, ticket_id, halo_id, tech_name, external_number, direction, started_at, ended_at, transcript_chars, transcript, matched_by, summary, note_posted, analysis_attempts, call_type, from_name, from_number, to_name, to_number, identified_customer_name, identified_client_name, match_evidence")
    .neq("matched_by", "cursor_seed")
    .order("recording_id", { ascending: false })
    .limit(RECENT_CALL_LIMIT * 3);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReadonlyArray<CallAnalysisRow>;

  const ticketIds = [...new Set(rows.map((row) => row.ticket_id).filter((id): id is string => Boolean(id)))];
  const ticketById = new Map<string, TicketLookup>();
  if (ticketIds.length > 0) {
    const { data: tickets, error: ticketError } = await supabase
      .from("tickets")
      .select("id, summary, client_name, halo_status, halo_agent, user_name")
      .in("id", ticketIds);
    if (ticketError) throw new Error(ticketError.message);
    for (const ticket of (tickets ?? []) as ReadonlyArray<TicketLookup>) ticketById.set(ticket.id, ticket);
  }

  const [recordingResult, haloResult] = await Promise.all([
    loadRecentRecordings(supabase, rows),
    supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).maybeSingle(),
  ]);
  const haloConfig = haloResult.data?.config as HaloConfig | undefined;
  const cnamByNumber = await resolveRecentCnamNames(supabase, rows, recordingResult.recordings);

  const items = rows.map((row): CallTranscriptionItem => {
    const recording = recordingResult.recordings.get(Number(row.recording_id));
    const ticketLookup = row.ticket_id ? ticketById.get(row.ticket_id) : null;
    const hasMatch = row.halo_id != null;
    const internal = row.matched_by === "internal_call" || /local/i.test(row.call_type ?? recording?.CallType ?? "");
    const separate = row.matched_by === "confirmed_separate_call";
    const transcript = row.transcript ?? recording?.Transcription?.trim() ?? null;
    const startedAt = row.started_at ?? recording?.StartTime ?? null;
    const endedAt = row.ended_at ?? recording?.EndTime ?? null;
    const ignoredMethod = !internal && !separate && !hasMatch
      ? ignoredCallMethod({
          transcript,
          startedAt,
          endedAt,
          matchedBy: row.matched_by,
          analysisAttempts: row.analysis_attempts ?? 0,
        })
      : null;
    const effectiveMatchMethod = internal ? "internal_call" : ignoredMethod ?? row.matched_by ?? "unknown";
    const attention = !internal && hasMatch && !row.note_posted;
    const fromName = (row.from_name ?? recording?.FromDisplayName?.trim()) || null;
    const toName = (row.to_name ?? recording?.ToDisplayName?.trim()) || null;
    const externalNumber = row.external_number ?? (recording ? inferExternalNumber(recording) : null);
    const cnamIdentity = cnamIdentityFromEvidence(row.match_evidence)
      ?? (externalNumber ? cnamByNumber.get(externalNumber) ?? null : null);
    const customerName = internal
      ? null
      : cnamIdentity?.name ?? ticketLookup?.user_name ?? row.identified_customer_name ?? null;
    return {
      recordingId: Number(row.recording_id),
      startedAt,
      endedAt,
      direction: directionOf(row.direction),
      techName: row.tech_name ?? "Unknown tech",
      externalNumber,
      transcript,
      transcriptChars: row.transcript_chars ?? recording?.Transcription?.length ?? 0,
      callSummary: row.summary,
      matchState: internal ? "internal" : separate ? "separate" : ignoredMethod ? "ignored" : hasMatch ? (attention ? "attention" : "matched") : "unmatched",
      matchMethod: effectiveMatchMethod,
      matchLabel: callMatchLabel(effectiveMatchMethod),
      notePosted: row.note_posted,
      analysisAttempts: row.analysis_attempts ?? 0,
      identifiedCustomerName: row.identified_customer_name,
      identifiedClientName: row.identified_client_name,
      cnamName: cnamIdentity?.name ?? null,
      cnamType: cnamIdentity?.type ?? null,
      matchEvidence: row.match_evidence,
      callType: row.call_type ?? recording?.CallType ?? null,
      from: {
        name: itemPartyName("from", directionOf(row.direction), fromName, customerName),
        number: row.from_number ?? recording?.FromCallerNumber?.trim() ?? null,
      },
      to: {
        name: itemPartyName("to", directionOf(row.direction), toName, customerName),
        number: row.to_number ?? recording?.ToCallerNumber?.trim() ?? null,
      },
      ticket: hasMatch && !internal
        ? {
            haloId: Number(row.halo_id),
            summary: ticketLookup?.summary ?? null,
            clientName: ticketLookup?.client_name ?? null,
            status: ticketLookup?.halo_status ?? null,
            agentName: ticketLookup?.halo_agent ?? null,
            customerName: ticketLookup?.user_name ?? null,
          }
        : null,
    };
  }).filter(shouldIncludeCallTranscription).slice(0, RECENT_CALL_LIMIT);
  const payload: CallTranscriptionPayload = {
    generatedAt: new Date().toISOString(),
    haloBaseUrl: haloConfig?.base_url ?? "",
    sourceAvailable: recordingResult.available,
    items,
    counts: {
      total: items.length,
      matched: items.filter((item) => item.ticket !== null).length,
      unmatched: items.filter((item) => item.matchState === "unmatched").length,
      internal: items.filter((item) => item.matchState === "internal").length,
      separate: items.filter((item) => item.matchState === "separate").length,
      ignored: items.filter((item) => item.matchState === "ignored").length,
      attention: items.filter((item) => item.matchState === "attention").length,
    },
  };
  cache = { at: Date.now(), payload };
  return payload;
}
