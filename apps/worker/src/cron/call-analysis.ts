import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { ThreeCxClient, type ThreeCxRecording } from "../integrations/threecx/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { extractResponseText } from "../agents/llm-text.js";
import { parseLlmJson } from "../agents/parse-json.js";
import type { ThreeCxConfig } from "@triageit/shared";

/**
 * Call Analysis — matches 3CX call recordings to open tickets and posts a
 * private "Call Summary" note documenting what happened on the phone.
 *
 * 3CX V20 transcribes every recorded call within minutes and serves the
 * transcript inline on /xapi/v1/Recordings (verified live 2026-07-08), so
 * this is a pure text pipeline: new recording → external number → Halo user
 * lookup → open ticket for that user/client → LLM analysis → private note.
 *
 * Matching order: exact user phone → single-open-ticket client →
 * transcript disambiguation (the LLM picks which candidate ticket the
 * call is about, declining when unsure). Numbers Halo doesn't know get a
 * strict transcript-only pass over the whole open board. Every path still
 * requires the tech ON the call to be the tech ON the ticket.
 */

interface CallAnalysisResult {
  readonly checked: number;
  readonly matched: number;
  readonly notesPosted: number;
}

interface CallInsights {
  readonly summary: string;
  readonly actions_taken: ReadonlyArray<string>;
  readonly commitments: ReadonlyArray<string>;
  readonly next_steps: ReadonlyArray<string>;
  readonly suggestions: ReadonlyArray<string>;
  readonly customer_sentiment: string;
  readonly relevant_to_ticket: boolean;
  /** Outbound calls only: draft "per our call" follow-up email for the tech to send. */
  readonly suggested_customer_email: string | null;
}

const MIN_TRANSCRIPT_CHARS = 150;
const MAX_RECORDINGS_PER_RUN = 40;
const MAX_TRANSCRIPT_FOR_LLM = 24_000;
/** Global (no-Halo-user) matching needs enough conversation to be trustworthy. */
const GLOBAL_MATCH_MIN_CHARS = 400;
const MAX_GLOBAL_CANDIDATES = 120;
const LLM_MATCH_MIN_CONFIDENCE = 0.75;

export async function runCallAnalysis(): Promise<CallAnalysisResult> {
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

  console.log(`[CALL-ANALYSIS] Complete: ${recordings.length} new recordings, ${matched} matched to tickets, ${notesPosted} notes posted`);
  return { checked: recordings.length, matched, notesPosted };
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

export async function processRecording(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  rec: ThreeCxRecording,
): Promise<{ matched: boolean; posted: boolean }> {
  const base = {
    recording_id: rec.Id,
    started_at: rec.StartTime ?? null,
    ended_at: rec.EndTime ?? null,
    transcript_chars: (rec.Transcription ?? "").length,
  };

  const external = externalNumberOf(rec);
  const transcript = (rec.Transcription ?? "").trim();

  if (!external || transcript.length < MIN_TRANSCRIPT_CHARS) {
    await supabase
      .from("call_analyses")
      .upsert({ ...base, matched_by: external ? "transcript_too_short" : "no_external_number", note_posted: false }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
  }

  const direction = external.direction;
  const techName = (direction === "inbound" ? rec.ToDisplayName : rec.FromDisplayName) ?? "Unknown tech";

  // Who is this number in Halo?
  const users = await halo.searchUsersByPhone(external.number);

  // Number not in Halo (main lines, cell phones Halo doesn't know) — the
  // transcript itself often names the caller and the issue, so let the LLM
  // try the whole open board. The assigned-tech guard below still applies,
  // which kills vendor calls and wrong-ticket picks.
  if (users.length === 0) {
    let globalPick: CandidateTicket | null = null;
    if (transcript.length >= GLOBAL_MATCH_MIN_CHARS) {
      const { data: allOpen } = await supabase
        .from("tickets")
        .select("id, halo_id, summary, user_name, client_name, halo_status, halo_agent")
        .eq("tickettype_id", 31)
        .eq("halo_is_open", true)
        .order("created_at", { ascending: false })
        .limit(MAX_GLOBAL_CANDIDATES);
      globalPick = await selectTicketByTranscript(transcript, allOpen ?? [], techName, "global");
    }
    if (!globalPick) {
      await supabase
        .from("call_analyses")
        .upsert({ ...base, external_number: external.number, direction, tech_name: techName, matched_by: "no_halo_user", note_posted: false }, { onConflict: "recording_id" });
      return { matched: false, posted: false };
    }
    return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, globalPick, "llm_transcript_global", transcript);
  }

  // Find an open ticket: exact user first, then single-open-ticket client
  const userNames = users.map((u) => u.name.toLowerCase());
  const clientNames = [...new Set(users.map((u) => u.client_name).filter((c): c is string => Boolean(c)))];

  const { data: openTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, user_name, client_name, halo_status, halo_agent")
    .eq("tickettype_id", 31)
    .eq("halo_is_open", true)
    .in("client_name", clientNames.length > 0 ? clientNames : ["__none__"])
    .order("created_at", { ascending: false })
    .limit(25);

  const candidates = openTickets ?? [];
  const byUser = candidates.filter((t) => t.user_name && userNames.includes(t.user_name.toLowerCase()));

  let ticket: CandidateTicket | null = byUser[0] ?? (candidates.length === 1 ? candidates[0] : null);
  let matchedBy = byUser[0] ? "user_phone" : ticket ? "client_single_open" : null;

  // Several tickets for this caller/user — let the transcript decide which
  // one the call was actually about instead of blindly taking the newest.
  if (byUser.length > 1) {
    const pick = await selectTicketByTranscript(transcript, byUser, techName, "user");
    if (pick) {
      ticket = pick;
      matchedBy = "llm_transcript_user";
    }
  }

  // Client matched but multiple open tickets (the old blanket
  // "ambiguous_multiple_open" skip): the transcript usually names the
  // issue — e.g. a "litigation hold" call maps to the Litigation Hold
  // ticket even when the office main line matches five open tickets.
  if (!ticket && candidates.length > 1) {
    const pick = await selectTicketByTranscript(transcript, candidates, techName, "client");
    if (pick) {
      ticket = pick;
      matchedBy = "llm_transcript";
    }
  }

  if (!ticket || !matchedBy) {
    await supabase
      .from("call_analyses")
      .upsert(
        { ...base, external_number: external.number, direction, tech_name: techName, matched_by: candidates.length > 1 ? "ambiguous_multiple_open" : "no_open_ticket", note_posted: false },
        { onConflict: "recording_id" },
      );
    return { matched: false, posted: false };
  }

  return finishMatchedRecording(supabase, halo, rec, base, external.number, direction, techName, ticket, matchedBy, transcript);
}

interface CandidateTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly user_name: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
}

interface RecordingBase {
  readonly recording_id: number;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly transcript_chars: number;
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

  // Analyze the transcript against the ticket
  const insights = await analyzeCall(rec, transcript, techName, direction, ticket.summary);

  // "If it's part of the ticket, it doesn't matter who works on it — post
  // the note" (user, 2026-07-09). llm_transcript matches were already
  // selected BY content, so a second relevance veto only loses notes
  // (Jarid's #40811 call died that way). The veto only remains for pure
  // number-based matches, where the call may genuinely be about something
  // else entirely.
  const contentMatched = matchedBy.startsWith("llm_transcript");
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
  await halo.addInternalNote(ticket.halo_id, note);

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
  transcript: string,
  candidates: ReadonlyArray<CandidateTicket>,
  techName: string,
  scope: "user" | "client" | "global",
): Promise<CandidateTicket | null> {
  if (candidates.length === 0) return null;
  try {
    const anthropic = new Anthropic();
    const lines = candidates.map(
      (t) =>
        `#${t.halo_id} | client: ${t.client_name ?? "?"} | reporter: ${t.user_name ?? "?"} | assigned: ${t.halo_agent ?? "unassigned"} | ${String(t.summary ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120)}`,
    );

    const prompt = [
      `A support call at an MSP was recorded and transcribed. Decide which open ticket (if any) the call is about, so the call summary lands on the right ticket.`,
      ``,
      `Tech on the call: ${techName}`,
      scope === "global"
        ? `The caller's number is not in the PSA, so be STRICT: only match when the transcript clearly names the company, person, or the exact issue of a listed ticket.`
        : `The caller's phone number maps to the client(s) below but matches more than one open ticket.`,
      ``,
      `OPEN TICKETS:`,
      ...lines,
      ``,
      `TRANSCRIPT (3CX auto-transcription, may include IVR audio and errors):`,
      transcript.slice(0, MAX_TRANSCRIPT_FOR_LLM),
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
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractResponseText(response);
    if (!text) return null;
    const pick = parseLlmJson<{ halo_id?: number | null; confidence?: number; evidence?: string }>(text);
    if (!pick.halo_id || (pick.confidence ?? 0) < LLM_MATCH_MIN_CONFIDENCE) return null;

    const ticket = candidates.find((t) => t.halo_id === pick.halo_id) ?? null;
    if (ticket) {
      console.log(`[CALL-ANALYSIS] Transcript match (${scope}): #${ticket.halo_id} at ${pick.confidence} — "${(pick.evidence ?? "").slice(0, 120)}"`);
    }
    return ticket;
  } catch (error) {
    console.error("[CALL-ANALYSIS] Ticket selection failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function analyzeCall(
  rec: ThreeCxRecording,
  transcript: string,
  techName: string,
  direction: string,
  ticketSummary: string,
): Promise<CallInsights | null> {
  try {
    const anthropic = new Anthropic();
    const durationMin =
      rec.StartTime && rec.EndTime
        ? ((new Date(rec.EndTime).getTime() - new Date(rec.StartTime).getTime()) / 60_000).toFixed(1)
        : "?";

    const prompt = [
      `You are analyzing a recorded support call at an MSP so it can be documented on the ticket. Facts only — every claim must come from the transcript. No praise padding, no hedging.`,
      ``,
      `Ticket: "${ticketSummary}"`,
      `Call: ${direction}, tech ${techName}, ${durationMin} min.`,
      ``,
      `TRANSCRIPT (3CX auto-transcription — may contain IVR menus at the start and transcription errors):`,
      transcript.slice(0, MAX_TRANSCRIPT_FOR_LLM),
      ``,
      `Respond with ONLY valid JSON:`,
      `{`,
      `  "relevant_to_ticket": <true if this call plausibly relates to the ticket above; false if it is clearly about something else entirely. A tech attempting contact but only reaching an IVR/voicemail IS relevant — that attempt should be documented>,`,
      `  "summary": "<2-3 sentences: what the call was about and how it ended. If the tech never reached a person, say so plainly: who they tried to reach and what stopped them>",`,
      `  "actions_taken": ["<things actually DONE on the call — e.g. rebooted server, reset password>"],`,
      `  "commitments": ["<promises made and by whom — e.g. 'Tech: call back tomorrow 10 AM', 'Customer: send screenshot'>"],`,
      `  "next_steps": ["<what should happen next based on the call>"],`,
      `  "suggestions": ["<0-3 concrete suggestions for the tech — follow-ups the transcript shows are needed. Imperatives, no filler>"],`,
      `  "customer_sentiment": "<one word: satisfied | neutral | frustrated | angry>",`,
      `  "suggested_customer_email": ${direction === "outbound" ? `"<draft follow-up email the tech can send the customer. Start with 'Hi <first name>,' then 'Per our call...' — recap what was discussed/done in the customer's words, what happens next and when. Warm, plain English, no jargon, 3-5 sentences, sign off as ${techName.split(",").reverse().join(" ").trim()} from Gamma Tech. Only what the transcript supports.>"` : "null"}`,
      `}`,
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      // Room for the outbound email draft on top of the structured fields
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractResponseText(response);
    if (!text) return null;
    return parseLlmJson<CallInsights>(text);
  } catch (error) {
    console.error("[CALL-ANALYSIS] LLM analysis failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function buildCallSummaryNote(
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
    ? new Date(rec.StartTime).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
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
    items.map((i) => `<li style="margin-bottom:3px;">${i}</li>`).join("");

  const detailBlocks = [
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
      `<div style="padding:8px 12px;border-top:1px solid #3a3f4b;font-size:12.5px;color:#a7f3d0;line-height:1.55;"><em>"${emailDraft.replace(/\n/g, "<br/>")}"</em></div>` +
      `</details></td></tr>`
    : "";

  // Direction at a glance: inbound = blue band, outbound = green band
  const headerGradient = direction === "inbound"
    ? "linear-gradient(135deg,#1e3a8a,#2563eb)"
    : "linear-gradient(135deg,#14532d,#16a34a)";
  const directionLabel = direction === "inbound" ? "⬇ inbound" : "⬆ outbound";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:8px 12px;background:${headerGradient};color:white;font-size:13px;font-weight:700;">📞 Call Summary — ${techName}` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;">${directionLabel} · ${when} · ${durationMin} min · <span style="color:${sentimentColor};">${insights.customer_sentiment}</span></span>` +
    `</td></tr>` +
    (assignedTech
      ? `<tr style="background:#2b2410;"><td style="padding:5px 12px;${border}font-size:11px;color:#fcd34d;">Call handled by ${techName} — ticket is assigned to ${assignedTech}</td></tr>`
      : "") +
    `<tr style="background:#252830;"><td style="padding:7px 12px;${border}font-size:12.5px;color:#e2e8f0;line-height:1.5;">${insights.summary}</td></tr>` +
    suggestionsRow +
    emailRow +
    (detailBlocks
      ? `<tr style="background:#1E2028;"><td style="padding:0;${border}"><details style="margin:0;"><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ Call detail — actions, commitments &amp; next steps</summary><div style="padding:8px 12px;font-size:12px;line-height:1.5;border-top:1px solid #3a3f4b;">${detailBlocks}</div></details></td></tr>`
      : "") +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">TriageIt AI · auto-matched from 3CX recording · number ${externalNumber.replace(/^1(?=\d{10}$)/, "")}</td></tr>` +
    `</table>`
  );
}
