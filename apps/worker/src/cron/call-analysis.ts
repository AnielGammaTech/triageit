import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { ThreeCxClient, type ThreeCxRecording } from "../integrations/threecx/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { extractResponseText } from "../agents/llm-text.js";
import { parseLlmJson } from "../agents/parse-json.js";
import { isCallAuditStaffName, isInternalStaffName, type ThreeCxConfig } from "@triageit/shared";
import {
  choosePhoneTicketMatchStrategy,
  phoneTicketSearchTerms,
  recentClosedTicketNearCall,
  transcriptTicketMatchMinConfidence,
  unmatchedRematchDue,
  type TranscriptTicketMatchScope,
} from "./call-match-policy.js";
import { sendPendingCallMatchReviews } from "../dispatch/call-match-review-notifications.js";
import { ignoredCallMethod } from "../dispatch/call-ignore-policy.js";
import { resolveCnamIdentity, type CnamIdentity } from "../integrations/twilio/cnam-identity.js";

/**
 * Call Analysis — matches 3CX call recordings to open tickets and posts a
 * private "Call Summary" note documenting what happened on the phone.
 *
 * 3CX V20 transcribes every recorded call within minutes and serves the
 * transcript inline on /xapi/v1/Recordings (verified live 2026-07-08), so
 * this is a pure text pipeline: new recording → external number → Halo user
 * lookup → open ticket for that user/client → LLM analysis → private note.
 *
 * Matching order: unique contact phone → that contact's ticket; shared
 * company line → strict transcript selection across the client's tickets.
 * Numbers Halo doesn't know get a strict transcript-only pass over the whole
 * open board. The LLM can decline every ambiguous path instead of guessing.
 * The technician's own open work is checked before callback-number matches,
 * and callback hits are expanded to every open ticket at that client so a
 * phone number copied into another technician's ticket cannot hijack a call.
 */

interface CallAnalysisResult {
  readonly checked: number;
  readonly matched: number;
  readonly notesPosted: number;
}

export interface IgnoredCallAuditResult {
  readonly audited: number;
  readonly misclassified: number;
  readonly reprocessed: number;
  readonly matched: number;
  readonly notesPosted: number;
  readonly stillIgnored: number;
  readonly failed: number;
  readonly recordingIds: ReadonlyArray<number>;
}

export interface CallInsights {
  readonly summary: string;
  readonly customer_reported: ReadonlyArray<string>;
  readonly key_findings: ReadonlyArray<string>;
  readonly actions_taken: ReadonlyArray<string>;
  readonly commitments: ReadonlyArray<string>;
  readonly next_steps: ReadonlyArray<string>;
  readonly suggestions: ReadonlyArray<string>;
  readonly customer_sentiment: string;
  readonly relevant_to_ticket: boolean;
  readonly contact_outcome: "connected" | "voicemail_left" | "ivr_only" | "unknown";
  /** Outbound calls only: draft "per our call" follow-up email for the tech to send. */
  readonly suggested_customer_email: string | null;
}

interface TranscriptCallerIdentity {
  readonly person_name: string | null;
  readonly company_name: string | null;
  readonly issue_summary: string;
  readonly confidence: number;
  readonly evidence: string;
}

interface ExternalPartyIdentity {
  readonly name: string | null;
  readonly number: string;
  readonly callStartedAt?: string | null;
  readonly cnamName?: string | null;
  readonly cnamType?: "BUSINESS" | "CONSUMER" | null;
}

const MIN_TRANSCRIPT_CHARS = 150;
const MAX_RECORDINGS_PER_RUN = 40;
const MAX_TRANSCRIPT_FOR_MATCHING = 24_000;
/** Stored transcripts are capped at 100k; analysis must read the entire call, including details after hold/background audio. */
const MAX_TRANSCRIPT_FOR_ANALYSIS = 100_000;
/** Global (no-Halo-user) matching needs enough conversation to be trustworthy. */
const GLOBAL_MATCH_MIN_CHARS = 400;
const MAX_GLOBAL_CANDIDATES = 120;
/** Cap retries of a matched recording whose analysis or note-post keeps failing. */
const MAX_ANALYSIS_ATTEMPTS = 5;
const MAX_TRANSCRIPT_POLL_ATTEMPTS = 20;
const MAX_UNMATCHED_REMATCH_ATTEMPTS = 4;
const RECENT_CLOSED_MATCH_DAYS = 21;
const CLIENT_OPEN_CANDIDATE_LIMIT = 40;
const CLIENT_CLOSED_CANDIDATE_LIMIT = 25;
const TICKET_CANDIDATE_SELECT = "id, halo_id, summary, details, user_name, client_name, halo_status, halo_agent, halo_is_open, created_at, updated_at";

// The cron fires every minute but a run with new recordings can take several
// minutes (1-3 Sonnet calls per recording). Without this guard, BullMQ's
// concurrency-8 worker (and the boot catch-up path) would start overlapping
// runs that read the same cursor and post every Call Summary note twice.
let callAnalysisInFlight = false;

export async function runCallAnalysis(): Promise<CallAnalysisResult> {
  if (callAnalysisInFlight) {
    console.log("[CALL-ANALYSIS] Previous run still in flight — skipping this tick");
    return { checked: 0, matched: 0, notesPosted: 0 };
  }
  callAnalysisInFlight = true;
  try {
    return await runCallAnalysisInner();
  } finally {
    callAnalysisInFlight = false;
  }
}

async function runCallAnalysisInner(): Promise<CallAnalysisResult> {
  const supabase = createSupabaseClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "threecx")
    .eq("is_active", true)
    .maybeSingle();
  if (!integration) {
    console.log("[CALL-ANALYSIS] 3CX not configured — skipping");
    return { checked: 0, matched: 0, notesPosted: 0 };
  }

  const haloConfig = await getCachedHaloConfig(supabase);
  if (!haloConfig) {
    console.log("[CALL-ANALYSIS] Halo not configured — skipping");
    return { checked: 0, matched: 0, notesPosted: 0 };
  }

  const tcx = new ThreeCxClient(integration.config as ThreeCxConfig);
  const halo = new HaloClient(haloConfig);

  // Cursor = highest recording id we've already handled. First run seeds the
  // cursor at the PBX's current max so the 11k-recording backlog is skipped.
  const { data: cursorRow } = await supabase
    .from("call_analyses")
    .select("recording_id")
    .order("recording_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cursorRow) {
    const maxId = await tcx.getMaxRecordingId();
    if (maxId === null) {
      console.warn("[CALL-ANALYSIS] Could not seed cursor (3CX lookup failed)");
      return { checked: 0, matched: 0, notesPosted: 0 };
    }
    await supabase.from("call_analyses").insert({
      recording_id: maxId,
      matched_by: "cursor_seed",
      note_posted: false,
    });
    console.log(`[CALL-ANALYSIS] Cursor seeded at recording ${maxId} — processing starts with the next call`);
    return { checked: 0, matched: 0, notesPosted: 0 };
  }

  const recordings = await tcx.getRecordingsSince(cursorRow.recording_id, MAX_RECORDINGS_PER_RUN);
  if (recordings === null) {
    console.warn("[CALL-ANALYSIS] 3CX recordings lookup FAILED — will retry next run");
    return { checked: 0, matched: 0, notesPosted: 0 };
  }

  let matched = 0;
  let notesPosted = 0;

  // 3CX transcription is asynchronous, so transcript polling gets a longer
  // budget than actual LLM/note failures. Recent unmatched calls also get a
  // small rematch budget so improved customer context can repair old misses.
  const recentCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [failureResult, transcriptResult, unmatchedResult, ignoredResult] = await Promise.all([
    supabase
      .from("call_analyses")
      .select("recording_id, analysis_attempts, matched_by")
      .or("matched_by.like.%analysis_failed%,matched_by.like.%note_failed%,matched_by.eq.error")
      .eq("note_posted", false)
      .lt("analysis_attempts", MAX_ANALYSIS_ATTEMPTS)
      .gte("created_at", recentCutoff)
      .order("recording_id", { ascending: false })
      .limit(4),
    supabase
      .from("call_analyses")
      .select("recording_id, analysis_attempts, matched_by")
      .eq("matched_by", "transcript_too_short")
      .lt("analysis_attempts", MAX_TRANSCRIPT_POLL_ATTEMPTS)
      .gte("created_at", recentCutoff)
      .order("recording_id", { ascending: false })
      .limit(8),
    supabase
      .from("call_analyses")
      .select("recording_id, analysis_attempts, matched_by, created_at")
      .in("matched_by", ["identified_customer_no_ticket_match", "no_halo_user", "shared_phone_no_transcript_match", "ambiguous_multiple_open", "no_open_ticket", "no_recent_ticket_match"])
      .lt("analysis_attempts", MAX_UNMATCHED_REMATCH_ATTEMPTS)
      .gte("created_at", recentCutoff)
      .order("recording_id", { ascending: false })
      .limit(30),
    supabase
      .from("call_analyses")
      .select("recording_id, analysis_attempts, matched_by")
      .in("matched_by", ["ignored_ivr", "ignored_short_call", "ignored_silence", "ignored_unusable_recording"])
      .lt("analysis_attempts", 4)
      .gte("created_at", recentCutoff)
      .order("recording_id", { ascending: false })
      .limit(8),
  ]);
  const dueUnmatchedRows = (unmatchedResult.data ?? [])
    .filter((row) => unmatchedRematchDue(row.created_at, Number(row.analysis_attempts) || 0))
    .slice(0, 6);
  const retryRows = [...(failureResult.data ?? []), ...(transcriptResult.data ?? []), ...dueUnmatchedRows, ...(ignoredResult.data ?? [])]
    .filter((row, index, all) => all.findIndex((candidate) => candidate.recording_id === row.recording_id) === index)
    .slice(0, 12);
  for (const row of retryRows) {
    const recId = Number(row.recording_id);
    const [rec] = (await tcx.getRecordingsSince(recId - 1, 1)) ?? [];
    if (!rec || rec.Id !== recId) continue;
    // Count the attempt up-front so a retry that throws still advances the
    // counter (the processRecording upserts don't touch analysis_attempts).
    await supabase
      .from("call_analyses")
      .update({ analysis_attempts: (Number(row.analysis_attempts) || 0) + 1 })
      .eq("recording_id", recId);
    try {
      const outcome = await processRecording(supabase, halo, rec);
      console.log(`[CALL-ANALYSIS] Retried ${row.matched_by} recording ${recId}: matched=${outcome.matched} posted=${outcome.posted}`);
      if (outcome.posted) notesPosted++;
    } catch (error) {
      console.error(`[CALL-ANALYSIS] Retry of recording ${recId} failed:`, error instanceof Error ? error.message : error);
    }
  }

  for (const rec of recordings) {
    try {
      const outcome = await processRecording(supabase, halo, rec);
      if (outcome.matched) matched++;
      if (outcome.posted) notesPosted++;
    } catch (error) {
      console.error(`[CALL-ANALYSIS] Recording ${rec.Id} failed:`, error instanceof Error ? error.message : error);
      // Still record it so the cursor advances — one bad call must not wedge the pipeline
      await supabase
        .from("call_analyses")
        .upsert({ recording_id: rec.Id, matched_by: "error", note_posted: false }, { onConflict: "recording_id" });
    }
  }

  try {
    const reviewsSent = await sendPendingCallMatchReviews(supabase);
    if (reviewsSent > 0) console.log(`[CALL-ANALYSIS] Sent ${reviewsSent} unmatched-call review card(s) to Teams`);
  } catch (error) {
    console.error("[CALL-ANALYSIS] Teams call-review delivery failed:", error instanceof Error ? error.message : error);
  }

  console.log(`[CALL-ANALYSIS] Complete: ${recordings.length} new recordings, ${matched} matched to tickets, ${notesPosted} notes posted`);
  return { checked: recordings.length, matched, notesPosted };
}

export async function auditIgnoredCallClassifications(
  options: { readonly limit?: number } = {},
): Promise<IgnoredCallAuditResult> {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
  const supabase = createSupabaseClient();
  const [{ data: integration }, haloConfig] = await Promise.all([
    supabase.from("integrations").select("config").eq("service", "threecx").eq("is_active", true).maybeSingle(),
    getCachedHaloConfig(supabase),
  ]);
  if (!integration || !haloConfig) throw new Error("3CX or Halo is not configured");

  const { data, error } = await supabase
    .from("call_analyses")
    .select("recording_id, transcript, started_at, ended_at, matched_by, analysis_attempts")
    .in("matched_by", ["ignored_ivr", "ignored_short_call", "ignored_silence", "ignored_unusable_recording"])
    .order("recording_id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const tcx = new ThreeCxClient(integration.config as ThreeCxConfig);
  const halo = new HaloClient(haloConfig);
  let misclassified = 0;
  let reprocessed = 0;
  let matched = 0;
  let notesPosted = 0;
  let stillIgnored = 0;
  let failed = 0;
  const recordingIds: number[] = [];

  for (const row of data ?? []) {
    const recordingId = Number(row.recording_id);
    const [recording] = (await tcx.getRecordingsSince(recordingId - 1, 1)) ?? [];
    if (!recording || recording.Id !== recordingId) {
      failed++;
      continue;
    }
    const currentMethod = ignoredCallMethod({
      transcript: recording.Transcription ?? row.transcript,
      startedAt: recording.StartTime ?? row.started_at,
      endedAt: recording.EndTime ?? row.ended_at,
      matchedBy: row.matched_by,
      analysisAttempts: Number(row.analysis_attempts) || 0,
    });
    if (currentMethod) {
      stillIgnored++;
      continue;
    }

    misclassified++;
    recordingIds.push(recordingId);
    try {
      const outcome = await processRecording(supabase, halo, recording);
      reprocessed++;
      if (outcome.matched) matched++;
      if (outcome.posted) notesPosted++;
    } catch (auditError) {
      failed++;
      console.error(`[CALL-ANALYSIS] Ignored-call audit failed for recording ${recordingId}:`, auditError instanceof Error ? auditError.message : auditError);
    }
  }

  console.log(`[CALL-ANALYSIS] Ignored-call audit: ${(data ?? []).length} audited, ${misclassified} misclassified, ${notesPosted} notes posted, ${stillIgnored} correctly ignored, ${failed} failed`);
  return {
    audited: (data ?? []).length,
    misclassified,
    reprocessed,
    matched,
    notesPosted,
    stillIgnored,
    failed,
    recordingIds,
  };
}

/**
 * Do two person names share a real name token? Handles "Carlson, Jarid" vs
 * "Jarid Carlson". Tokens under 3 chars (initials) don't count. An
 * UNASSIGNED ticket never matches — we can't verify the tech belongs to it.
 */
function namesOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const tokens = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  const setA = new Set(tokens(a));
  return tokens(b).some((t) => setA.has(t));
}

function naturalPersonName(name: string): string {
  const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name.trim();
}

/**
 * Ticket numbers spoken on the call ("I'm calling about ticket 40912").
 * 3CX transcribes digits as "40912", leading-zero display ids like "0040912",
 * or spaced "4 0 9 1 2". Explicit ticket/case phrases are checked first and
 * leading zeros are normalized. Separators are limited to spaces and hyphens
 * (NOT "." or ","), so currency like "$409.12" and "40,911" cannot collapse
 * into a bogus ticket id and hijack the match.
 */
export function extractSpokenTicketNumbers(transcript: string): number[] {
  const explicitRuns = [...transcript.matchAll(
    /(?:\bticket\b|\bcase\b|\brequest\b)\s*(?:(?:number|no\.?|#)\s*)?#?\s*(\d(?:[\s-]?\d){4,7})/gi,
  )].map((match) => match[1]);
  const hashRuns = [...transcript.matchAll(/(?:^|\s)#\s*(\d(?:[\s-]?\d){4,7})/g)]
    .map((match) => match[1]);
  const genericRuns = transcript.match(/\d(?:[\s-]?\d)+/g) ?? [];
  const normalize = (run: string): number | null => {
    const digits = run.replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 8) return null;
    const value = Number(digits);
    return Number.isSafeInteger(value) && value >= 10_000 && value <= 9_999_999 ? value : null;
  };
  const ids = [...explicitRuns, ...hashRuns, ...genericRuns]
    .map(normalize)
    .filter((id): id is number => id !== null);
  return [...new Set(ids)];
}

/**
 * Names spoken on the call that identify who the tech was talking to —
 * voicemail greetings ("You have reached Nicole Lynn"), self-introductions
 * ("this is Melissa"). Used to find the person in Halo BY NAME when their
 * direct-dial number isn't on their contact card.
 */
export function extractSpokenNames(transcript: string): string[] {
  const patterns = [
    /[Yy]ou(?:'ve| have) reached ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/g,
    /(?:^|[.,!?]\s+)[Tt]his is ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/g,
    /(?:[Hh]ello|[Hh]i|[Hh]ey),?\s+(?:this is )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) speaking/g,
    /(?:^|[.,!?]\s+)([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:over at|from|with)\s+[A-Z]/g,
  ];
  const names = new Set<string>();
  for (const re of patterns) {
    for (const m of transcript.matchAll(re)) {
      const name = m[1].trim();
      // Skip obvious non-names AND our own staff introducing themselves —
      // "Hi, this is Matthew from Gamma Tech" would otherwise resolve to a
      // customer named Matthew and post the tech's vendor call onto that
      // stranger's ticket (spoken_name matches bypass the relevance veto).
      if (/^(Gamma|Tech|Thank|Please|Monday|Tuesday|Wednesday|Thursday|Friday)/.test(name)) continue;
      if (isInternalStaffName(name)) continue;
      names.add(name);
    }
  }
  return [...names].slice(0, 3);
}

/** Pick the external (non-extension) side of the call. */
function externalNumberOf(rec: ThreeCxRecording): { number: string; direction: "inbound" | "outbound" } | null {
  const from = (rec.FromCallerNumber ?? "").replace(/\D/g, "");
  const to = (rec.ToCallerNumber ?? "").replace(/\D/g, "");
  const fromExternal = from.length >= 7;
  const toExternal = to.length >= 7;
  if (fromExternal && !toExternal) return { number: from, direction: "inbound" };
  if (toExternal && !fromExternal) return { number: to, direction: "outbound" };
  // Both external (trunk-to-trunk) or both internal — nothing to match
  return null;
}

function recordingBase(
  rec: ThreeCxRecording,
  external: ReturnType<typeof externalNumberOf>,
  techName: string,
): RecordingBase {
  const transcript = (rec.Transcription ?? "").trim();
  return {
    recording_id: rec.Id,
    started_at: rec.StartTime ?? null,
    ended_at: rec.EndTime ?? null,
    transcript_chars: transcript.length,
    transcript: transcript.slice(0, 100_000) || null,
    external_number: external?.number ?? null,
    direction: external?.direction ?? null,
    tech_name: techName,
    call_type: rec.CallType ?? null,
    from_name: rec.FromDisplayName?.trim() || null,
    from_number: rec.FromCallerNumber?.trim() || null,
    to_name: rec.ToDisplayName?.trim() || null,
    to_number: rec.ToCallerNumber?.trim() || null,
  };
}

export async function processRecording(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  rec: ThreeCxRecording,
): Promise<{ matched: boolean; posted: boolean }> {
  const transcript = (rec.Transcription ?? "").trim();
  const external = externalNumberOf(rec);
  const initialDirection = external?.direction ?? null;
  const initialTechName = external
    ? (initialDirection === "inbound" ? rec.ToDisplayName : rec.FromDisplayName) ?? "Unknown tech"
    : (rec.FromDisplayName ?? rec.ToDisplayName ?? "Unknown tech");
  const base = recordingBase(rec, external, initialTechName);

  const auditCall = external
    ? isCallAuditStaffName(initialTechName)
    : isCallAuditStaffName(rec.FromDisplayName) || isCallAuditStaffName(rec.ToDisplayName);
  if (!auditCall) {
    await supabase.from("call_analyses").upsert({
      ...base,
      ticket_id: null,
      halo_id: null,
      summary: null,
      matched_by: "ignored_non_support_staff",
      note_posted: false,
    }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
  }

  const internalCall = /local/i.test(rec.CallType ?? "")
    || (!external && /^\w{2,8}$/.test(rec.FromCallerNumber ?? "") && /^\w{2,8}$/.test(rec.ToCallerNumber ?? ""));
  if (internalCall) {
    await supabase
      .from("call_analyses")
      .upsert({
        ...base,
        ticket_id: null,
        halo_id: null,
        summary: null,
        matched_by: "internal_call",
        note_posted: false,
      }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
  }

  const ignoredMethod = ignoredCallMethod({
    transcript,
    startedAt: base.started_at,
    endedAt: base.ended_at,
    matchedBy: external ? "transcript_too_short" : "no_external_number",
    analysisAttempts: 0,
  });
  if (ignoredMethod) {
    await supabase
      .from("call_analyses")
      .upsert({
        ...base,
        ticket_id: null,
        halo_id: null,
        summary: null,
        matched_by: ignoredMethod,
        note_posted: false,
      }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
  }

  if (!external || transcript.length < MIN_TRANSCRIPT_CHARS) {
    await supabase
      .from("call_analyses")
      .upsert({ ...base, matched_by: external ? "transcript_too_short" : "no_external_number", note_posted: false }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
  }

  const direction = external.direction;
  const techName = initialTechName;
  const externalParty = {
    name: (direction === "inbound" ? rec.FromDisplayName : rec.ToDisplayName)?.trim() || null,
    number: external.number,
    callStartedAt: rec.StartTime ?? null,
  };

  // A ticket number SPOKEN on the call is the strongest cue there is —
  // it beats every phone-number heuristic and works even when the caller's
  // number isn't in Halo at all.
  const spokenIds = extractSpokenTicketNumbers(transcript);
  if (spokenIds.length > 0) {
    const { data: spokenMatches } = await supabase
      .from("tickets")
      .select("id, halo_id, summary, user_name, client_name, halo_status, halo_agent")
      .in("halo_id", spokenIds)
      .eq("tickettype_id", 31);
    const matchesById = new Map(
      ((spokenMatches ?? []) as CandidateTicket[]).map((ticket) => [ticket.halo_id, ticket]),
    );
    const byFirstMention = spokenIds
      .map((haloId) => matchesById.get(haloId))
      .filter((ticket): ticket is CandidateTicket => Boolean(ticket));
    if (byFirstMention[0]) {
      console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: ticket #${byFirstMention[0].halo_id} spoken on the call — direct match`);
      return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, byFirstMention[0], "spoken_ticket_number", transcript);
    }
  }

  // The person actually handling the call gets first consideration. This is
  // intentionally transcript-gated: assignment is a strong routing signal,
  // but never proof that an unrelated call belongs to one of the tech's
  // tickets. This prevents a callback number copied into Ryan's ticket from
  // beating Darren's active ticket about the issue Darren is discussing.
  const assignedTechCandidates = await findAssignedTechOpenTicketCandidates(supabase, techName);
  if (assignedTechCandidates.length > 0) {
    const assignedTechPick = await selectTicketByTranscript(
      supabase,
      transcript,
      assignedTechCandidates,
      techName,
      externalParty,
      "assigned_tech",
    );
    if (assignedTechPick) {
      console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: transcript matched the handling tech's assigned ticket #${assignedTechPick.halo_id}`);
      return finishMatchedRecording(
        supabase,
        halo,
        rec,
        base,
        external.number,
        direction,
        techName,
        assignedTechPick,
        "llm_transcript_assigned_tech",
        transcript,
      );
    }
  }

  // Callback numbers are often typed into the ticket body but not saved on
  // the Halo contact. Include recent closed tickets: a return call commonly
  // happens after the dispatcher or tech already closed the ticket.
  const phoneTerms = phoneTicketSearchTerms(external.number);
  if (phoneTerms.length > 0) {
    const phoneFilter = phoneTerms.flatMap((term) => [
      `details.ilike.%${term}%`,
      `summary.ilike.%${term}%`,
    ]).join(",");
    const { data: callbackTickets, error: callbackError } = await supabase
      .from("tickets")
      .select("id, halo_id, summary, details, user_name, client_name, halo_status, halo_agent, halo_is_open, created_at, updated_at")
      .eq("tickettype_id", 31)
      .or(phoneFilter)
      .order("updated_at", { ascending: false })
      .limit(25);
    if (callbackError) {
      console.warn(`[CALL-ANALYSIS] Callback-number ticket search failed for ${external.number}: ${callbackError.message}`);
    }
    const callbackRows = (callbackTickets ?? []) as CandidateTicket[];
    const callbackClients = [...new Set(
      callbackRows.map((ticket) => ticket.client_name).filter((name): name is string => Boolean(name)),
    )];
    const sameClientTickets = callbackClients.length > 0
      ? await findClientTicketCandidates(supabase, callbackClients)
      : [];
    const callbackCandidates = mergeTicketCandidateGroups(callbackRows, sameClientTickets);
    const callbackPick = await selectTicketByTranscript(supabase, transcript, callbackCandidates, techName, externalParty, "callback_number");
    if (callbackPick) {
      console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: callback number identified the client and transcript selected #${callbackPick.halo_id}`);
      return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, callbackPick, "llm_ticket_callback_number", transcript);
    }
  }

  // Who is this number in Halo?
  const users = await halo.searchUsersByPhone(external.number);

  // Number not in Halo (main lines, cell phones Halo doesn't know).
  // First: people NAME themselves on calls ("You have reached Nicole
  // Lynn…") — find them in Halo by name, then match within their
  // company's open tickets. Fallback: LLM over the whole open board.
  // The assigned-tech guard below still applies on every path.
  if (users.length === 0) {
    const cnamIdentity = await resolveCnamIdentity(supabase, external.number);
    const enrichedExternalParty: ExternalPartyIdentity = {
      ...externalParty,
      cnamName: cnamIdentity?.name ?? null,
      cnamType: cnamIdentity?.type ?? null,
    };
    if (cnamIdentity) {
      console.log(
        `[CALL-ANALYSIS] Recording ${rec.Id}: Twilio CNAM returned a ${cnamIdentity.type ?? "UNKNOWN"} identity hint`,
      );
    }
    // Caller ID such as "NAPLES FL" is weak data. Read the conversation
    // before falling back to the whole board: callers often answer
    // "Elizabeth with Allen Concrete" without saying "this is...".
    const inferredIdentity = await identifyCallerFromTranscript(transcript, techName, enrichedExternalParty);
    let identifiedCustomerName: string | null = null;
    let identifiedClientName: string | null = null;
    const cnamEvidence = cnamIdentity
      ? `Twilio CNAM hint (${cnamIdentity.type ?? "UNKNOWN"}): ${cnamIdentity.name}`
      : null;
    let identityEvidence: string | null = cnamEvidence;

    // Transcript names are primary evidence. A CONSUMER CNAM can narrow the
    // Halo contact search, but it never enables the direct assigned-tech path.
    const nameHints = [
      ...(inferredIdentity?.person_name
        ? [{ name: inferredIdentity.person_name, source: "transcript" as const }]
        : []),
      ...extractSpokenNames(transcript).map((name) => ({ name, source: "transcript" as const })),
      ...(cnamIdentity?.type !== "BUSINESS" && cnamIdentity?.name
        ? [{ name: cnamIdentity.name, source: "cnam" as const }]
        : []),
    ].filter((hint, index, hints) =>
      hints.findIndex((candidate) => candidate.name.toLowerCase() === hint.name.toLowerCase()) === index
    );
    if (nameHints.length > 0) {
      console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: identity name hints ${nameHints.map((hint) => hint.name).join(", ")} — trying name-directed match`);
    }
    for (const hint of nameHints) {
      const name = hint.name;
      let namedUsers: Awaited<ReturnType<typeof halo.searchUsersByName>> = [];
      try {
        namedUsers = await halo.searchUsersByName(name);
      } catch (error) {
        console.warn(`[CALL-ANALYSIS] Name lookup "${name}" failed:`, error instanceof Error ? error.message : error);
        continue;
      }
      const identityCompany = hint.source === "transcript" && name === inferredIdentity?.person_name
        ? inferredIdentity.company_name
        : null;
      const companyMatchedUsers = identityCompany
        ? namedUsers.filter((user) => clientNamesOverlap(user.client_name, identityCompany))
        : namedUsers;
      const usableUsers = companyMatchedUsers.length > 0 ? companyMatchedUsers : namedUsers;
      const namedClients = [...new Set(usableUsers.map((u) => u.client_name).filter((c): c is string => Boolean(c)))];
      console.log(`[CALL-ANALYSIS] Name "${name}" → ${namedUsers.length} Halo user(s), clients: ${namedClients.join(", ") || "none"}`);
      if (namedClients.length === 0 || namedClients.length > 3) continue;

      if (hint.source === "transcript" && name === inferredIdentity?.person_name && inferredIdentity.confidence >= 0.75) {
        const exactUser = usableUsers.find((user) => namesOverlap(user.name, name)) ?? usableUsers[0];
        identifiedCustomerName = exactUser?.name ?? name;
        identifiedClientName = exactUser?.client_name ?? identityCompany;
        identityEvidence = [inferredIdentity.evidence, cnamEvidence].filter(Boolean).join(" · ");
      }

      const candidates = await findClientTicketCandidates(supabase, namedClients);

      // The calling tech being the ASSIGNED tech of exactly one open ticket
      // at the named person's company is decisive on its own — Jarid
      // calling Nicole at the Dunes IS his Dunes ticket, even when the
      // voicemail wording ("your email… calendar issue") doesn't echo the
      // ticket title. Vague voicemails killed the topical LLM match here.
      const assignedToCaller = candidates.filter((t) => t.halo_is_open !== false && namesOverlap(techName, t.halo_agent));
      if (hint.source === "transcript" && assignedToCaller.length === 1) {
        console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: spoken name "${name}" → ${namedClients.join("/")} + caller is assigned tech of #${assignedToCaller[0].halo_id} — direct match`);
        return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, assignedToCaller[0], "spoken_name_assigned_tech", transcript);
      }

      const pick = await selectTicketByTranscript(
        supabase,
        transcript,
        candidates,
        techName,
        enrichedExternalParty,
        hint.source === "cnam" ? "cnam" : "client",
      );
      if (pick) {
        console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: matched via ${hint.source} name "${name}" → ${namedClients.join("/")} → #${pick.halo_id}`);
        return finishMatchedRecording(
          supabase,
          halo,
          rec,
          base,
          external.number,
          direction,
          techName,
          pick,
          hint.source === "cnam" ? "llm_transcript_cnam_user" : "llm_transcript_named",
          transcript,
        );
      }
    }

    // The caller may identify a real company without existing as a named Halo
    // contact (for example, "Crisanta calling from Collier Podiatry"). Search
    // that company's recent work directly instead of dropping immediately to
    // the whole-board fallback. Transcript selection remains strict and may
    // decline when the only related tickets are old or topically different.
    if (inferredIdentity?.company_name && inferredIdentity.confidence >= 0.75) {
      const companyCandidates = await findCompanyTicketCandidates(supabase, inferredIdentity.company_name);
      console.log(`[CALL-ANALYSIS] Transcript company "${inferredIdentity.company_name}" → ${companyCandidates.length} open/recent ticket candidate(s)`);
      const companyPick = await selectTicketByTranscript(
        supabase,
        transcript,
        companyCandidates,
        techName,
        enrichedExternalParty,
        "global",
      );
      if (companyPick) {
        console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: transcript company + issue matched #${companyPick.halo_id}`);
        return finishMatchedRecording(
          supabase,
          halo,
          rec,
          base,
          external.number,
          direction,
          techName,
          companyPick,
          "llm_transcript_company",
          transcript,
        );
      }
    }

    // A BUSINESS CNAM is useful for narrowing the client, but the carrier
    // subscriber name may be stale or belong to a parent company. Require a
    // strict transcript match within the candidate client's tickets.
    if (cnamIdentity && cnamIdentity.type !== "CONSUMER") {
      const cnamClientCandidates = await findCnamClientTickets(supabase, cnamIdentity);
      if (cnamClientCandidates.length > 0) {
        const pick = await selectTicketByTranscript(
          supabase,
          transcript,
          cnamClientCandidates,
          techName,
          enrichedExternalParty,
          "cnam",
        );
        if (pick) {
          console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: CNAM client hint + transcript matched #${pick.halo_id}`);
          return finishMatchedRecording(
            supabase,
            halo,
            rec,
            base,
            external.number,
            direction,
            techName,
            pick,
            "llm_transcript_cnam_client",
            transcript,
          );
        }
      }
    }

    let globalPick: CandidateTicket | null = null;
    if (transcript.length >= GLOBAL_MATCH_MIN_CHARS) {
      const { data: allOpen } = await supabase
        .from("tickets")
        .select("id, halo_id, summary, details, user_name, client_name, halo_status, halo_agent")
        .eq("tickettype_id", 31)
        .eq("halo_is_open", true)
        .order("created_at", { ascending: false })
        .limit(MAX_GLOBAL_CANDIDATES);
      globalPick = await selectTicketByTranscript(supabase, transcript, allOpen ?? [], techName, enrichedExternalParty, "global");
    }
    if (!globalPick) {
      await supabase
        .from("call_analyses")
        .upsert({
          ...base,
          external_number: external.number,
          direction,
          tech_name: techName,
          matched_by: identifiedCustomerName ? "identified_customer_no_ticket_match" : "no_halo_user",
          summary: inferredIdentity?.issue_summary ?? null,
          identified_customer_name: identifiedCustomerName,
          identified_client_name: identifiedClientName,
          match_evidence: identityEvidence,
          teams_review_status: "pending",
          note_posted: false,
        }, { onConflict: "recording_id" });
      return { matched: false, posted: false };
    }
    return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, globalPick, "llm_transcript_global", transcript);
  }

  // Search the caller's open tickets plus tickets closed in the last 21 days.
  // A return call often arrives after the ticket was closed, but closed-ticket
  // selection always requires transcript confirmation; caller ID alone is not
  // enough to post onto historical work.
  const userNames = users.map((u) => u.name.toLowerCase());
  const clientNames = [...new Set(users.map((u) => u.client_name).filter((c): c is string => Boolean(c)))];
  const candidates = await findClientTicketCandidates(
    supabase,
    clientNames.length > 0 ? clientNames : ["__none__"],
  );
  const spokenRecentTicket = findRecentlyClosedTicketFromCallContext(
    candidates,
    transcript,
    techName,
    rec.StartTime ?? null,
  );
  if (spokenRecentTicket) {
    console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: spoken customer + assigned tech + call-time activity matched recent #${spokenRecentTicket.halo_id}`);
    return finishMatchedRecording(
      supabase,
      halo,
      rec,
      base,
      external.number,
      direction,
      techName,
      spokenRecentTicket,
      "spoken_name_recent_assigned_tech",
      transcript,
    );
  }
  const openCandidates = candidates.filter((ticket) => ticket.halo_is_open !== false);
  const byUser = candidates.filter((ticket) => ticket.user_name && userNames.includes(ticket.user_name.toLowerCase()));
  const openByUser = byUser.filter((ticket) => ticket.halo_is_open !== false);

  const strategy = choosePhoneTicketMatchStrategy({
    haloUserCount: users.length,
    exactUserTicketCount: openByUser.length,
    clientTicketCount: openCandidates.length,
  });
  let ticket: CandidateTicket | null = null;
  let matchedBy: string | null = null;

  if (strategy === "direct_user") {
    ticket = openByUser[0] ?? null;
    matchedBy = ticket ? "user_phone" : null;
  } else if (strategy === "transcript_user") {
    ticket = await selectTicketByTranscript(supabase, transcript, byUser, techName, externalParty, "user");
    matchedBy = ticket ? "llm_transcript_user" : null;
  } else if (strategy === "transcript_client") {
    const sharedPhone = users.length > 1;
    ticket = await selectTicketByTranscript(
      supabase,
      transcript,
      candidates,
      techName,
      externalParty,
      sharedPhone ? "shared_phone" : "client",
    );
    if (ticket) {
      matchedBy = sharedPhone ? "llm_transcript_shared_phone" : "llm_transcript";
    }
  } else if (candidates.length > 0) {
    const historyCandidates = byUser.length > 0 ? byUser : candidates;
    const historyScope: TranscriptTicketMatchScope = users.length > 1 ? "shared_phone" : byUser.length > 0 ? "user" : "client";
    ticket = await selectTicketByTranscript(supabase, transcript, historyCandidates, techName, externalParty, historyScope);
    matchedBy = ticket
      ? historyScope === "shared_phone" ? "llm_transcript_shared_phone" : historyScope === "user" ? "llm_transcript_user" : "llm_transcript"
      : null;
  }

  if (!ticket || !matchedBy) {
    const reviewIdentity = await identifyCallerFromTranscript(transcript, techName, externalParty);
    const callerIdentified = Boolean(reviewIdentity?.person_name || reviewIdentity?.company_name);
    await supabase
      .from("call_analyses")
      .upsert(
        {
          ...base,
          external_number: external.number,
          direction,
          tech_name: techName,
          matched_by: callerIdentified
            ? "identified_customer_no_ticket_match"
            : users.length > 1
              ? "shared_phone_no_transcript_match"
              : openCandidates.length > 1
                ? "ambiguous_multiple_open"
                : candidates.length > 0
                  ? "no_recent_ticket_match"
                  : "no_open_ticket",
          summary: reviewIdentity?.issue_summary ?? null,
          identified_customer_name: reviewIdentity?.person_name ?? (users.length === 1 ? users[0]?.name ?? null : null),
          identified_client_name: reviewIdentity?.company_name ?? (clientNames.length === 1 ? clientNames[0] ?? null : null),
          match_evidence: reviewIdentity?.evidence ?? null,
          teams_review_status: "pending",
          note_posted: false,
        },
        { onConflict: "recording_id" },
      );
    return { matched: false, posted: false };
  }

  return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, ticket, matchedBy, transcript);
}

export async function manuallyMatchRecording(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  rec: ThreeCxRecording,
  haloId: number,
): Promise<{ matched: boolean; posted: boolean }> {
  const transcript = (rec.Transcription ?? "").trim();
  const external = externalNumberOf(rec);
  if (!external) throw new Error("Only external customer calls can be matched to a ticket");
  const techName = (external.direction === "inbound" ? rec.ToDisplayName : rec.FromDisplayName) ?? "Unknown tech";
  if (!isCallAuditStaffName(techName)) throw new Error("This call does not involve the TriageIT support team");
  if (transcript.length < MIN_TRANSCRIPT_CHARS) throw new Error("The 3CX transcript is not ready yet");

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, details, user_name, client_name, halo_status, halo_agent, halo_is_open")
    .eq("halo_id", haloId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ticket) throw new Error(`Ticket #${haloId} is not available in TriageIT`);

  return finishMatchedRecording(
    supabase,
    halo,
    rec,
    recordingBase(rec, external, techName),
    external.number,
    external.direction,
    techName,
    ticket as CandidateTicket,
    "manual_dispatch",
    transcript,
  );
}

interface CandidateTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly details?: string | null;
  readonly user_name: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
  readonly halo_is_open?: boolean | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** Combine candidate sources without allowing one ticket to appear twice. */
export function mergeTicketCandidateGroups<T extends { readonly id: string }>(
  ...groups: ReadonlyArray<ReadonlyArray<T>>
): T[] {
  const combined = groups.flat();
  return combined.filter((ticket, index) =>
    combined.findIndex((candidate) => candidate.id === ticket.id) === index
  );
}

async function findAssignedTechOpenTicketCandidates(
  supabase: ReturnType<typeof createSupabaseClient>,
  techName: string,
): Promise<ReadonlyArray<CandidateTicket>> {
  const naturalName = naturalPersonName(techName);
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_CANDIDATE_SELECT)
    .eq("tickettype_id", 31)
    .eq("halo_is_open", true)
    .ilike("halo_agent", naturalName)
    .order("updated_at", { ascending: false })
    .limit(CLIENT_OPEN_CANDIDATE_LIMIT);
  if (error) {
    console.warn(`[CALL-ANALYSIS] Assigned-ticket search failed for ${naturalName}: ${error.message}`);
    return [];
  }
  return ((data ?? []) as CandidateTicket[]).filter((ticket) => namesOverlap(techName, ticket.halo_agent));
}

function findRecentlyClosedTicketFromCallContext(
  candidates: ReadonlyArray<CandidateTicket>,
  transcript: string,
  techName: string,
  callStartedAt: string | null,
): CandidateTicket | null {
  const spokenNames = extractSpokenNames(transcript);
  if (spokenNames.length === 0) return null;
  const matches = candidates.filter((ticket) =>
    spokenNames.some((name) => namesOverlap(name, ticket.user_name))
    && namesOverlap(techName, ticket.halo_agent)
    && recentClosedTicketNearCall(
      ticket.halo_is_open,
      ticket.created_at,
      ticket.updated_at,
      callStartedAt,
    )
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Reserve candidate capacity for recently closed work instead of combining it
 * with open tickets in one limited query. Large clients can have enough open
 * tickets to otherwise hide the exact ticket that closed during the call.
 */
async function findClientTicketCandidates(
  supabase: ReturnType<typeof createSupabaseClient>,
  clientNames: ReadonlyArray<string>,
): Promise<ReadonlyArray<CandidateTicket>> {
  const recentClosedCutoff = new Date(Date.now() - RECENT_CLOSED_MATCH_DAYS * 24 * 3600_000).toISOString();
  const [openResult, closedResult] = await Promise.all([
    supabase
      .from("tickets")
      .select(TICKET_CANDIDATE_SELECT)
      .eq("tickettype_id", 31)
      .eq("halo_is_open", true)
      .in("client_name", [...clientNames])
      .order("updated_at", { ascending: false })
      .limit(CLIENT_OPEN_CANDIDATE_LIMIT),
    supabase
      .from("tickets")
      .select(TICKET_CANDIDATE_SELECT)
      .eq("tickettype_id", 31)
      .eq("halo_is_open", false)
      .in("client_name", [...clientNames])
      .gte("updated_at", recentClosedCutoff)
      .order("updated_at", { ascending: false })
      .limit(CLIENT_CLOSED_CANDIDATE_LIMIT),
  ]);
  if (openResult.error) {
    console.warn("[CALL-ANALYSIS] Open client candidate search failed:", openResult.error.message);
  }
  if (closedResult.error) {
    console.warn("[CALL-ANALYSIS] Recent closed client candidate search failed:", closedResult.error.message);
  }

  const combined = [
    ...((openResult.data ?? []) as CandidateTicket[]),
    ...((closedResult.data ?? []) as CandidateTicket[]),
  ];
  return combined.filter((ticket, index) =>
    combined.findIndex((candidate) => candidate.id === ticket.id) === index
  );
}

export function clientNamesOverlap(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const ignored = new Set(["and", "the", "inc", "llc", "corp", "corporation", "company"]);
  const tokens = (value: string) => value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));
  const leftTokens = new Set(tokens(left));
  const rightTokens = tokens(right);
  return rightTokens.length > 0
    && rightTokens.filter((token) => leftTokens.has(token)).length >= Math.min(2, rightTokens.length);
}

async function findCompanyTicketCandidates(
  supabase: ReturnType<typeof createSupabaseClient>,
  companyName: string,
): Promise<ReadonlyArray<CandidateTicket>> {
  const recentClosedCutoff = new Date(Date.now() - RECENT_CLOSED_MATCH_DAYS * 24 * 3600_000).toISOString();
  const [openResult, closedResult] = await Promise.all([
    supabase
      .from("tickets")
      .select(TICKET_CANDIDATE_SELECT)
      .eq("tickettype_id", 31)
      .eq("halo_is_open", true)
      .order("updated_at", { ascending: false })
      .limit(MAX_GLOBAL_CANDIDATES),
    supabase
      .from("tickets")
      .select(TICKET_CANDIDATE_SELECT)
      .eq("tickettype_id", 31)
      .eq("halo_is_open", false)
      .gte("updated_at", recentClosedCutoff)
      .order("updated_at", { ascending: false })
      .limit(MAX_GLOBAL_CANDIDATES),
  ]);
  if (openResult.error || closedResult.error) {
    console.warn("[CALL-ANALYSIS] Company candidate search failed:", openResult.error?.message ?? closedResult.error?.message);
  }
  return ([...((openResult.data ?? []) as CandidateTicket[]), ...((closedResult.data ?? []) as CandidateTicket[])])
    .filter((ticket) => clientNamesOverlap(ticket.client_name, companyName))
    .slice(0, 50);
}

async function findCnamClientTickets(
  supabase: ReturnType<typeof createSupabaseClient>,
  identity: CnamIdentity,
): Promise<ReadonlyArray<CandidateTicket>> {
  return findCompanyTicketCandidates(supabase, identity.name);
}

async function identifyCallerFromTranscript(
  transcript: string,
  techName: string,
  externalParty: ExternalPartyIdentity,
): Promise<TranscriptCallerIdentity | null> {
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          `Identify the CUSTOMER in this MSP support-call transcript. Read the whole conversation; do not rely only on caller ID.`,
          `The internal Gamma Tech employee is ${techName}. Never return that employee as the customer, even if 3CX misspells their name.`,
          `3CX caller ID: ${externalParty.name ?? "unavailable"} | ${externalParty.number}`,
          ...(externalParty.cnamName
            ? [`Twilio CNAM hint (unverified carrier data, not proof): ${externalParty.cnamName} | ${externalParty.cnamType ?? "UNKNOWN"}`]
            : []),
          `Use direct conversational evidence such as an answer to "who is this?", "<name> with <company>", or a company greeting. Do not guess from the issue alone.`,
          `Summarize the support work without reproducing any password, security code, or credential.`,
          ``,
          `TRANSCRIPT:`,
          transcript.slice(0, MAX_TRANSCRIPT_FOR_MATCHING),
          ``,
          `Respond with ONLY valid JSON:`,
          `{`,
          `  "person_name": "<customer full or first name, or null>",`,
          `  "company_name": "<customer company, or null>",`,
          `  "issue_summary": "<one sentence describing the call, with credentials redacted>",`,
          `  "confidence": <0.0-1.0>,`,
          `  "evidence": "<short identifying phrase from the transcript>"`,
          `}`,
        ].join("\n"),
      }],
    });
    const text = extractResponseText(response);
    if (!text) return null;
    const identity = parseLlmJson<TranscriptCallerIdentity>(text);
    const confidence = Number(identity.confidence ?? 0);
    const personName = confidence >= 0.75
      && identity.person_name
      && !isInternalStaffName(identity.person_name)
      && !namesOverlap(identity.person_name, techName)
      ? identity.person_name
      : null;
    const companyName = confidence >= 0.75 ? identity.company_name ?? null : null;
    const issueSummary = typeof identity.issue_summary === "string" ? identity.issue_summary.trim() : "";
    if (!personName && !companyName && !issueSummary) return null;
    return {
      ...identity,
      person_name: personName,
      company_name: companyName,
      issue_summary: issueSummary,
      confidence,
    };
  } catch (error) {
    console.warn("[CALL-ANALYSIS] Transcript caller identification failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

interface RecordingBase {
  readonly recording_id: number;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly transcript_chars: number;
  readonly transcript: string | null;
  readonly external_number: string | null;
  readonly direction: "inbound" | "outbound" | null;
  readonly tech_name: string;
  readonly call_type: string | null;
  readonly from_name: string | null;
  readonly from_number: string | null;
  readonly to_name: string | null;
  readonly to_number: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function callInsightsMisattributeTechnician(
  insights: CallInsights,
  techName: string,
): boolean {
  const techTokens = techName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 4);
  const content = [
    insights.summary,
    ...insights.customer_reported,
    ...insights.key_findings,
    ...insights.actions_taken,
    ...insights.commitments,
    ...insights.next_steps,
  ].join(" ");
  return techTokens.some((token) => new RegExp(
    `\\b(?:customer|caller|client|external (?:person|party|user)|end user)(?:\\s+(?:contact|named))?\\s+${escapeRegExp(token)}\\b`,
    "i",
  ).test(content));
}

/** Tech guard → transcript analysis → Call Summary note. Shared tail for every match path. */
async function finishMatchedRecording(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  rec: ThreeCxRecording,
  base: RecordingBase,
  externalNumber: string,
  direction: "inbound" | "outbound",
  techName: string,
  ticket: CandidateTicket,
  matchedBy: string,
  transcript: string,
): Promise<{ matched: boolean; posted: boolean }> {
  // The internal side of the call is always Gamma staff (their 3CX
  // extension). When the staffer on the call is NOT the assigned tech
  // (dispatcher taking a call, another tech covering), the note still
  // posts — with attribution — but only under a STRICTER relevance bar,
  // because "plausibly related" isn't enough to document someone else's
  // ticket. (Observed 2026-07-09: Darren granted Outlook access on a call
  // clearly about #40912, skipped because Ryan owned the ticket.)
  // 3CX display names come as "Carlson, Jarid" or "Matthew Lawyer"; Halo has
  // "Jarid Carlson" — compare name tokens instead of exact strings.
  const otherStaff = !namesOverlap(techName, ticket.halo_agent);

  // Analyze the transcript against the ticket (one retry — a matched call
  // must not lose its note to a single transient LLM failure)
  let insights = await analyzeCall(
    rec,
    transcript,
    techName,
    direction,
    ticket.summary,
    ticket.user_name ?? null,
    ticket.client_name ?? null,
  );
  if (!insights || callInsightsMisattributeTechnician(insights, techName)) {
    if (insights) console.warn(`[CALL-ANALYSIS] Recording ${rec.Id}: rejected summary that reversed technician/customer roles`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    insights = await analyzeCall(
      rec,
      transcript,
      techName,
      direction,
      ticket.summary,
      ticket.user_name ?? null,
      ticket.client_name ?? null,
    );
    if (insights && callInsightsMisattributeTechnician(insights, techName)) {
      console.error(`[CALL-ANALYSIS] Recording ${rec.Id}: second summary still reversed technician/customer roles`);
      insights = null;
    }
  }

  // "If it's part of the ticket, it doesn't matter who works on it — post
  // the note" (user, 2026-07-09). llm_transcript matches were already
  // selected BY content, so a second relevance veto only loses notes
  // (Jarid's #40811 call died that way). The veto only remains for pure
  // number-based matches, where the call may genuinely be about something
  // else entirely.
  const contentMatched =
    matchedBy.startsWith("llm_transcript") ||
    matchedBy === "llm_ticket_callback_number" ||
    matchedBy === "manual_dispatch" ||
    matchedBy === "spoken_ticket_number" ||
    matchedBy === "spoken_name_assigned_tech" ||
    matchedBy === "spoken_name_recent_assigned_tech";
  if (!insights || (!contentMatched && !insights.relevant_to_ticket)) {
    await supabase
      .from("call_analyses")
      .upsert(
        { ...base, ticket_id: ticket.id, halo_id: ticket.halo_id, external_number: externalNumber, direction, tech_name: techName, matched_by: insights ? `${matchedBy}_irrelevant` : `${matchedBy}_analysis_failed`, note_posted: false },
        { onConflict: "recording_id" },
      );
    return { matched: true, posted: false };
  }

  const note = buildCallSummaryNote(rec, insights, techName, direction, externalNumber, otherStaff ? (ticket.halo_agent ?? "no one yet") : null);
  try {
    await halo.addInternalNote(ticket.halo_id, note);
  } catch (error) {
    // The match + analysis succeeded; only the Halo POST failed (e.g. a 500).
    // Record a retriable marker WITHOUT losing the match metadata, so the
    // sweeper re-posts it — the outer catch would otherwise overwrite this as
    // matched_by:"error", which the sweeper doesn't pick up.
    console.error(`[CALL-ANALYSIS] Note POST failed for #${ticket.halo_id} (recording ${rec.Id}):`, error instanceof Error ? error.message : error);
    await supabase.from("call_analyses").upsert(
      {
        ...base,
        ticket_id: ticket.id,
        halo_id: ticket.halo_id,
        external_number: externalNumber,
        direction,
        tech_name: techName,
        matched_by: `${matchedBy}_note_failed`,
        summary: insights.summary,
        identified_customer_name: ticket.user_name,
        identified_client_name: ticket.client_name,
        match_evidence: null,
        teams_review_status: "matched",
        teams_review_ticket_id: ticket.halo_id,
        note_posted: false,
      },
      { onConflict: "recording_id" },
    );
    return { matched: true, posted: false };
  }

  await supabase.from("call_analyses").upsert(
    {
      ...base,
      ticket_id: ticket.id,
      halo_id: ticket.halo_id,
      external_number: externalNumber,
      direction,
      tech_name: techName,
      matched_by: otherStaff ? `${matchedBy}_other_staff` : matchedBy,
      summary: insights.summary,
      identified_customer_name: ticket.user_name,
      identified_client_name: ticket.client_name,
      match_evidence: null,
      teams_review_status: "matched",
      teams_review_ticket_id: ticket.halo_id,
      note_posted: true,
    },
    { onConflict: "recording_id" },
  );

  console.log(`[CALL-ANALYSIS] Posted call summary on #${ticket.halo_id} (${techName}${otherStaff ? ` — other staff, assigned tech ${ticket.halo_agent ?? "unassigned"}` : ""}, ${direction}, ${matchedBy}, recording ${rec.Id})`);
  return { matched: true, posted: true };
}

/**
 * Which of these tickets is this call about? The transcript carries the
 * issue ("looking into litigation holds…") even when the phone number
 * alone is ambiguous. Declining is always allowed — a null return falls
 * back to the conservative skip paths.
 */
async function selectTicketByTranscript(
  supabase: ReturnType<typeof createSupabaseClient>,
  transcript: string,
  candidates: ReadonlyArray<CandidateTicket>,
  techName: string,
  externalParty: ExternalPartyIdentity,
  scope: TranscriptTicketMatchScope,
): Promise<CandidateTicket | null> {
  if (candidates.length === 0) return null;
  try {
    const anthropic = new Anthropic();
    const clean = (s: unknown, max: number) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    const { data: triageRows } = await supabase
      .from("triage_results")
      .select("ticket_id, internal_notes, created_at")
      .in("ticket_id", candidates.map((ticket) => ticket.id))
      .order("created_at", { ascending: false });
    const triageByTicket = new Map<string, string>();
    for (const triage of triageRows ?? []) {
      if (!triageByTicket.has(triage.ticket_id) && triage.internal_notes) {
        triageByTicket.set(triage.ticket_id, String(triage.internal_notes));
      }
    }
    const prioritized = candidates.slice().sort((left, right) =>
      Number(namesOverlap(techName, right.halo_agent)) - Number(namesOverlap(techName, left.halo_agent))
    );
    const lines = prioritized.map((t) => {
      // Ticket bodies carry the names/mailboxes the summary omits — "Email
      // Forward" says nothing, its details name the actual people involved
      const details = clean(t.details, 160);
      const triageSummary = clean(triageByTicket.get(t.id), 240);
      const opened = t.created_at ? new Date(t.created_at).toISOString() : "unknown";
      const lastActivity = t.updated_at ? new Date(t.updated_at).toISOString() : "unknown";
      return `#${t.halo_id} | ${t.halo_is_open === false ? "closed" : "open"} | opened: ${opened} | last activity/closed: ${lastActivity} | status: ${t.halo_status ?? "?"} | client: ${t.client_name ?? "?"} | reporter: ${t.user_name ?? "?"} | assigned: ${t.halo_agent ?? "unassigned"} | ${clean(t.summary, 120)}${details ? ` | details: ${details}` : ""}${triageSummary ? ` | TriageIT summary: ${triageSummary}` : ""}`;
    });

    const prompt = [
      `A support call at an MSP was recorded and transcribed. Decide which support ticket (if any) the call is about, so the call summary lands on the right ticket. A recently closed ticket is valid when this is a follow-up or return call about the same issue.`,
      ``,
      `Tech on the call: ${techName}`,
      `Call started: ${externalParty.callStartedAt ?? "unknown"}`,
      `3CX external party: ${externalParty.name ?? "name unavailable"} | ${externalParty.number}`,
      ...(externalParty.cnamName
        ? [`Twilio CNAM hint (unverified carrier data; use only as supporting evidence): ${externalParty.cnamName} | ${externalParty.cnamType ?? "UNKNOWN"}`]
        : []),
      `CRITICAL — OWNERSHIP BEATS TITLE WORDS: candidates assigned to this tech are listed first. When one plausibly fits the customer, company, issue, and TriageIT summary in the transcript, pick it over another tech's ticket at the same client — even if the other ticket's title shares more generic words.`,
      scope === "assigned_tech"
        ? `These are the handling technician's own open tickets. Assignment gets first consideration, but it is not proof. Match only when the transcript identifies the customer, company, or specific issue of one candidate; otherwise return null.`
        : scope === "callback_number"
        ? `The external phone number is written in at least one ticket body as a callback number. The list also includes other open tickets at that same client. Prefer the handling technician's ticket when its customer and issue fit the transcript. The callback number alone is not enough and must never force another technician's ticket.`
        : scope === "cnam"
          ? `Twilio CNAM narrowed these candidates, but CNAM can be stale, generic, or registered to a parent company. Match only when the transcript independently confirms the customer, company, or exact ticket issue. CNAM alone is never enough.`
        : scope === "global"
        ? `The caller's number is not in the PSA, so be STRICT: only match when the transcript clearly names the company, person, or the exact issue of a listed ticket.`
        : scope === "shared_phone"
          ? `The phone number is a shared company line assigned to multiple contacts. Do not infer the caller or ticket from the number; match only when the transcript clearly describes a listed ticket's issue.`
        : `The caller's phone number maps to the client(s) below but matches more than one open ticket.`,
      ``,
      `CANDIDATE TICKETS:`,
      ...lines,
      ``,
      `TRANSCRIPT (3CX auto-transcription, may include IVR audio and errors):`,
      transcript.slice(0, MAX_TRANSCRIPT_FOR_MATCHING),
      ``,
      `Respond with ONLY valid JSON:`,
      `{`,
      `  "halo_id": <ticket number the call is clearly about, or null if none/unsure>,`,
      `  "confidence": <0.0-1.0 — how certain the transcript identifies THAT ticket>,`,
      `  "evidence": "<the transcript phrase(s) that identify the ticket>"`,
      `}`,
      `An outbound call where the tech only reached an IVR menu or voicemail STILL matches when the transcript shows who they were trying to reach (a name, an extension, the company greeting) and that person/company fits a ticket — attempted contact is ticket activity worth documenting.`,
      `When the call is small talk, a wrong number, a vendor, or could fit several tickets equally, return null. Never guess.`,
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1_000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractResponseText(response);
    if (!text) return null;
    const pick = parseLlmJson<{ halo_id?: number | null; confidence?: number; evidence?: string }>(text);
    // Client-scoped picks (caller's company already established via number
    // or spoken name) risk at most the wrong ticket at the RIGHT client —
    // global picks can land on a stranger's ticket, so they stay strict.
    const ticket = pick.halo_id ? candidates.find((candidate) => candidate.halo_id === pick.halo_id) ?? null : null;
    const minConfidence = transcriptTicketMatchMinConfidence(
      scope,
      ticket?.halo_is_open,
      ticket?.updated_at ?? ticket?.created_at,
    );
    if (!ticket || (pick.confidence ?? 0) < minConfidence) {
      console.log(`[CALL-ANALYSIS] Ticket selection (${scope}) declined: halo_id=${pick.halo_id ?? "null"} confidence=${pick.confidence ?? 0} — "${(pick.evidence ?? "").slice(0, 100)}"`);
      return null;
    }

    console.log(`[CALL-ANALYSIS] Transcript match (${scope}): #${ticket.halo_id} at ${pick.confidence} — "${(pick.evidence ?? "").slice(0, 120)}"`);
    return ticket;
  } catch (error) {
    console.error("[CALL-ANALYSIS] Ticket selection failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function buildCallAnalysisPrompt(
  rec: ThreeCxRecording,
  transcript: string,
  techName: string,
  direction: string,
  ticketSummary: string,
  ticketCustomerName: string | null = null,
  ticketClientName: string | null = null,
): string {
  const durationMin =
    rec.StartTime && rec.EndTime
      ? ((new Date(rec.EndTime).getTime() - new Date(rec.StartTime).getTime()) / 60_000).toFixed(1)
      : "?";

  const naturalTechName = techName.includes(",")
    ? techName.split(",").map((part) => part.trim()).reverse().join(" ")
    : techName.trim();
  const externalDisplayName = direction === "outbound" ? rec.ToDisplayName : rec.FromDisplayName;
  const externalNumber = direction === "outbound" ? rec.ToCallerNumber : rec.FromCallerNumber;

  return [
    `You are analyzing a recorded support call at an MSP so it can be documented completely on the ticket. Facts only: every claim must come from the transcript. No praise padding and no hedging.`,
    ``,
    `Ticket: "${ticketSummary}"`,
    ...(ticketCustomerName || ticketClientName
      ? [`Halo ticket context: customer/contact ${ticketCustomerName ?? "unknown"}; client ${ticketClientName ?? "unknown"}. The person who answers may be a coworker or shared-line user, so do not force the ticket contact's name onto the speaker.`]
      : []),
    `Call: ${direction}, tech ${naturalTechName}, ${durationMin} min.`,
    `External 3CX party: ${externalDisplayName?.trim() || "name unavailable"} | ${externalNumber?.trim() || "number unavailable"}.`,
    ``,
    `SPEAKER ROLE LOCK:`,
    `- The Gamma Tech technician is ${naturalTechName}. ${naturalTechName} is never the customer, caller contact, or external user in this transcript.`,
    direction === "outbound"
      ? `- This is OUTBOUND: ${naturalTechName} initiated the call from Gamma Tech. The other speaker is the external customer/contact who answered.`
      : `- This is INBOUND: the external customer/contact initiated the call and ${naturalTechName} answered for Gamma Tech.`,
    `- 3CX may transcribe ${naturalTechName.split(/\s+/)[0]} phonetically or with a minor spelling variation. That does not create a different customer.`,
    `- When the external speaker introduces themselves and the tech immediately addresses that name, assign that name to the external speaker. Never transfer it to the technician.`,
    `- Do not claim the technician is "referred to as" another speaker. If a name conflicts with the locked technician identity, it belongs to the external side unless the transcript clearly says otherwise.`,
    ``,
    `COMPLETENESS RULES:`,
    `- Read the full transcript from beginning to end. Calls may contain hold time, office background audio, or unrelated conversations and then return to IT support later. Continue scanning after those sections.`,
    `- Exclude unrelated background conversations, patient/customer discussions unrelated to the ticket, medical details, payment details, and other incidental private information.`,
    `- Preserve every material support detail: affected users, exact symptoms, troubleshooting already attempted, investigation steps, tools/systems checked, tentative hypotheses, confirmed findings, customer objections or corrections, changes made, blockers, commitments, and final state.`,
    `- If an early assumption is later corrected, document both the initial observation and the corrected conclusion without blaming anyone.`,
    `- Clearly distinguish what was attempted from what was confirmed successful. Never describe an unresolved attempt as a completed fix.`,
    `- Be complete but not word-for-word. Collapse repetition and omit greetings, filler, hold chatter, repeated acknowledgments, transcription noise, and facts unrelated to the support issue.`,
    `- Let the narrative length follow the amount of meaningful support work. Do not target or enforce a sentence count. Cover each material fact once and stop.`,
    ``,
    `TRANSCRIPT (3CX auto-transcription — may contain IVR audio and transcription errors):`,
    transcript.slice(0, MAX_TRANSCRIPT_FOR_ANALYSIS),
    ``,
    `Respond with ONLY valid JSON:`,
    `{`,
    `  "relevant_to_ticket": <true if this call plausibly relates to the ticket above; false if it is clearly about something else entirely. A tech attempting contact but only reaching an IVR/voicemail IS relevant>,`,
    `  "contact_outcome": "<connected | voicemail_left | ivr_only | unknown>. Use voicemail_left when an automated greeting is followed by the technician leaving a substantive message. An automated opening followed by a person is connected.",`,
    `  "summary": "<adaptive-length chronological support narrative covering every material report, prior attempt, investigation step, corrected assumption, confirmed finding, action, and exact end state once. Complete but not verbatim; omit repetition, filler, and unrelated background>",`,
    `  "customer_reported": ["<each distinct symptom, affected user, prior attempt, concern, or correction stated by the customer>"],`,
    `  "key_findings": ["<each material hypothesis or finding; label it tentative or confirmed when the transcript makes that distinction>"],`,
    `  "actions_taken": ["<each distinct thing actually done on the call — do not merge several actions into one vague item>"],`,
    `  "commitments": ["<promises made and by whom — e.g. 'Tech: call back tomorrow 10 AM', 'Customer: send screenshot'>"],`,
    `  "next_steps": ["<remaining work, exact owner, and timing when stated>"],`,
    `  "suggestions": ["<0-3 concrete suggestions for the tech based only on unresolved needs in the transcript. Imperatives, no filler>"],`,
    `  "customer_sentiment": "<one word: satisfied | neutral | frustrated | angry>",`,
    `  "suggested_customer_email": ${direction === "outbound" ? `"<draft follow-up email the tech can send the customer. If contact_outcome is voicemail_left, start with 'Hi <first name>, I tried to reach you by phone but reached your voicemail.' Then state exactly what the tech completed or needs and invite a callback/reply. Otherwise start with 'Hi <first name>,' then 'Per our call...'. Accurately recap what was discussed, what was done versus only attempted, what happens next and when. End with 'Does that plan work for you?' Warm, plain English, no jargon, 4-7 sentences, sign off as ${techName.split(",").reverse().join(" ").trim()} from Gamma Tech. Only what the transcript supports.>"` : "null"}`,
    `}`,
  ].join("\n");
}

function stringList(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeCallInsights(value: Partial<CallInsights>): CallInsights | null {
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) return null;
  const sentiment = ["satisfied", "neutral", "frustrated", "angry"].includes(value.customer_sentiment ?? "")
    ? value.customer_sentiment!
    : "neutral";
  return {
    relevant_to_ticket: value.relevant_to_ticket === true,
    contact_outcome: ["connected", "voicemail_left", "ivr_only", "unknown"].includes(value.contact_outcome ?? "")
      ? value.contact_outcome!
      : "unknown",
    summary: value.summary.trim(),
    customer_reported: stringList(value.customer_reported),
    key_findings: stringList(value.key_findings),
    actions_taken: stringList(value.actions_taken),
    commitments: stringList(value.commitments),
    next_steps: stringList(value.next_steps),
    suggestions: stringList(value.suggestions).slice(0, 3),
    customer_sentiment: sentiment,
    suggested_customer_email: typeof value.suggested_customer_email === "string" && value.suggested_customer_email.trim()
      ? value.suggested_customer_email.trim()
      : null,
  };
}

export async function analyzeCall(
  rec: ThreeCxRecording,
  transcript: string,
  techName: string,
  direction: string,
  ticketSummary: string,
  ticketCustomerName: string | null = null,
  ticketClientName: string | null = null,
): Promise<CallInsights | null> {
  try {
    const anthropic = new Anthropic();
    const prompt = buildCallAnalysisPrompt(
      rec,
      transcript,
      techName,
      direction,
      ticketSummary,
      ticketCustomerName,
      ticketClientName,
    );

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      // Comprehensive call narrative + structured facts + outbound email draft.
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractResponseText(response);
    if (!text) return null;
    return normalizeCallInsights(parseLlmJson<Partial<CallInsights>>(text));
  } catch (error) {
    console.error("[CALL-ANALYSIS] LLM analysis failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Parse a 3CX time string as UTC so it always renders correctly in Eastern.
 * 3CX returns UTC, but a naive string (no offset) would otherwise be parsed as
 * the server's local time and shift the displayed call time.
 */
function parse3cxTime(s: string): Date {
  const hasZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(s.trim());
  return new Date(hasZone ? s : s.replace(" ", "T") + "Z");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCallSummaryNote(
  rec: ThreeCxRecording,
  insights: CallInsights,
  techName: string,
  direction: string,
  externalNumber: string,
  /** Set when the staffer on the call is not the ticket's assigned tech. */
  assignedTech: string | null = null,
): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const when = rec.StartTime
    ? parse3cxTime(rec.StartTime).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "?";
  const durationMin =
    rec.StartTime && rec.EndTime
      ? ((new Date(rec.EndTime).getTime() - new Date(rec.StartTime).getTime()) / 60_000).toFixed(0)
      : "?";
  const sentimentColor =
    insights.customer_sentiment === "satisfied" ? "#4ade80"
    : insights.customer_sentiment === "frustrated" ? "#fbbf24"
    : insights.customer_sentiment === "angry" ? "#f87171"
    : "#94a3b8";

  const list = (items: ReadonlyArray<string>): string =>
    items.map((i) => `<li style="margin-bottom:3px;">${escapeHtml(i)}</li>`).join("");

  const detailBlocks = [
    insights.contact_outcome === "voicemail_left"
      ? `<div style="margin-bottom:8px;"><span style="color:#fbbf24;font-weight:600;font-size:11px;">CONTACT OUTCOME</span><div style="margin-top:4px;color:#fde68a;">Technician reached voicemail and left a message.</div></div>`
      : "",
    insights.customer_reported.length > 0
      ? `<div style="margin-bottom:8px;"><span style="color:#7dd3fc;font-weight:600;font-size:11px;">CUSTOMER REPORTED</span><ul style="margin:4px 0 0 18px;padding:0;color:#bae6fd;">${list(insights.customer_reported)}</ul></div>`
      : "",
    insights.key_findings.length > 0
      ? `<div style="margin-bottom:8px;"><span style="color:#c084fc;font-weight:600;font-size:11px;">KEY FINDINGS</span><ul style="margin:4px 0 0 18px;padding:0;color:#e9d5ff;">${list(insights.key_findings)}</ul></div>`
      : "",
    insights.actions_taken.length > 0
      ? `<div style="margin-bottom:8px;"><span style="color:#4ade80;font-weight:600;font-size:11px;">DONE ON THE CALL</span><ul style="margin:4px 0 0 18px;padding:0;color:#bbf7d0;">${list(insights.actions_taken)}</ul></div>`
      : "",
    insights.commitments.length > 0
      ? `<div style="margin-bottom:8px;"><span style="color:#fbbf24;font-weight:600;font-size:11px;">COMMITMENTS</span><ul style="margin:4px 0 0 18px;padding:0;color:#fde68a;">${list(insights.commitments)}</ul></div>`
      : "",
    insights.next_steps.length > 0
      ? `<div style="margin-bottom:8px;"><span style="color:#60a5fa;font-weight:600;font-size:11px;">NEXT STEPS</span><ul style="margin:4px 0 0 18px;padding:0;color:#bfdbfe;">${list(insights.next_steps)}</ul></div>`
      : "",
  ].filter(Boolean).join("");

  const suggestionsRow = insights.suggestions.length > 0
    ? `<tr style="background:#1a2332;"><td style="padding:0;${border}"><details style="margin:0;">` +
      `<summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:700;color:#60a5fa;list-style-position:inside;">Suggested follow-ups <span style="font-weight:400;color:#64748b;">(${insights.suggestions.length})</span></summary>` +
      `<div style="padding:6px 12px 8px;border-top:1px solid #3a3f4b;font-size:12.5px;color:#bfdbfe;line-height:1.5;"><ul style="margin:0 0 0 18px;padding:0;">${list(insights.suggestions)}</ul></div>` +
      `</details></td></tr>`
    : "";

  // Outbound follow-up draft — "per our call" customer update the tech can
  // copy into an email. Collapsed by default (it dwarfed the note when
  // expanded); suggestion only, nothing is ever sent automatically.
  const emailDraft = (insights.suggested_customer_email ?? "").trim();
  const emailRow = direction === "outbound" && emailDraft
    ? `<tr style="background:#122117;"><td style="padding:0;${border}"><details style="margin:0;">` +
      `<summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:700;color:#4ade80;list-style-position:inside;">✉ Suggested customer update <span style="font-weight:400;color:#64748b;">(click to expand — draft only, edit before sending)</span></summary>` +
      `<div style="padding:8px 12px;border-top:1px solid #3a3f4b;font-size:12.5px;color:#a7f3d0;line-height:1.55;"><em>"${escapeHtml(emailDraft).replace(/\n/g, "<br/>")}"</em></div>` +
      `</details></td></tr>`
    : "";

  // Direction at a glance: inbound = blue band, outbound = green band
  const headerGradient = direction === "inbound"
    ? "linear-gradient(135deg,#1e3a8a,#2563eb)"
    : "linear-gradient(135deg,#14532d,#16a34a)";
  const directionLabel = direction === "inbound" ? "⬇ inbound" : "⬆ outbound";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:8px 12px;background:${headerGradient};color:white;font-size:13px;font-weight:700;">📞 Call Summary — ${escapeHtml(techName)}` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;">${directionLabel} · ${escapeHtml(when)} · ${durationMin} min · <span style="color:${sentimentColor};">${escapeHtml(insights.customer_sentiment)}</span></span>` +
    `</td></tr>` +
    (assignedTech
      ? `<tr style="background:#2b2410;"><td style="padding:5px 12px;${border}font-size:11px;color:#fcd34d;">Call handled by ${escapeHtml(techName)} — ticket is assigned to ${escapeHtml(assignedTech)}</td></tr>`
      : "") +
    `<tr style="background:#252830;"><td style="padding:7px 12px;${border}font-size:12.5px;color:#e2e8f0;line-height:1.5;">${escapeHtml(insights.summary)}</td></tr>` +
    suggestionsRow +
    emailRow +
    (detailBlocks
      ? `<tr style="background:#1E2028;"><td style="padding:0;${border}"><details style="margin:0;"><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ Full call detail — customer report, findings, actions, commitments &amp; next steps</summary><div style="padding:8px 12px;font-size:12px;line-height:1.5;border-top:1px solid #3a3f4b;">${detailBlocks}</div></details></td></tr>`
      : "") +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">TriageIt AI · auto-matched from 3CX recording · number ${externalNumber.replace(/^1(?=\d{10}$)/, "")}</td></tr>` +
    `</table>`
  );
}
