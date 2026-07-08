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
 * Matching is conservative: a note is only posted when the call maps to a
 * specific user with an open ticket, or to a client with exactly ONE open
 * ticket. Ambiguous calls are recorded (for dedupe) but not posted.
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
}

const MIN_TRANSCRIPT_CHARS = 150;
const MAX_RECORDINGS_PER_RUN = 40;
const MAX_TRANSCRIPT_FOR_LLM = 24_000;

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

async function processRecording(
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
  if (users.length === 0) {
    await supabase
      .from("call_analyses")
      .upsert({ ...base, external_number: external.number, direction, tech_name: techName, matched_by: "no_halo_user", note_posted: false }, { onConflict: "recording_id" });
    return { matched: false, posted: false };
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
  const ticket =
    byUser[0] ??
    (candidates.length === 1 ? candidates[0] : null);
  const matchedBy = byUser[0] ? "user_phone" : candidates.length === 1 ? "client_single_open" : null;

  if (!ticket || !matchedBy) {
    await supabase
      .from("call_analyses")
      .upsert(
        { ...base, external_number: external.number, direction, tech_name: techName, matched_by: candidates.length > 1 ? "ambiguous_multiple_open" : "no_open_ticket", note_posted: false },
        { onConflict: "recording_id" },
      );
    return { matched: false, posted: false };
  }

  // The tech ON THE CALL must be the tech ON THE TICKET. A different tech's
  // (or the dispatcher's) call with this customer may be about anything —
  // it must never land as documentation on someone else's ticket.
  // 3CX display names come as "Carlson, Jarid" or "Matthew Lawyer"; Halo has
  // "Jarid Carlson" — compare name tokens instead of exact strings.
  if (!namesOverlap(techName, ticket.halo_agent)) {
    await supabase
      .from("call_analyses")
      .upsert(
        { ...base, ticket_id: ticket.id, halo_id: ticket.halo_id, external_number: external.number, direction, tech_name: techName, matched_by: `${matchedBy}_tech_mismatch`, note_posted: false },
        { onConflict: "recording_id" },
      );
    console.log(`[CALL-ANALYSIS] Recording ${rec.Id}: number matches #${ticket.halo_id} but caller "${techName}" is not the assigned tech "${ticket.halo_agent ?? "unassigned"}" — skipping`);
    return { matched: true, posted: false };
  }

  // Analyze the transcript against the ticket
  const insights = await analyzeCall(rec, transcript, techName, direction, ticket.summary);

  if (!insights || !insights.relevant_to_ticket) {
    await supabase
      .from("call_analyses")
      .upsert(
        { ...base, ticket_id: ticket.id, halo_id: ticket.halo_id, external_number: external.number, direction, tech_name: techName, matched_by: insights ? `${matchedBy}_irrelevant` : `${matchedBy}_analysis_failed`, note_posted: false },
        { onConflict: "recording_id" },
      );
    return { matched: true, posted: false };
  }

  const note = buildCallSummaryNote(rec, insights, techName, direction, external.number);
  await halo.addInternalNote(ticket.halo_id, note);

  await supabase.from("call_analyses").upsert(
    {
      ...base,
      ticket_id: ticket.id,
      halo_id: ticket.halo_id,
      external_number: external.number,
      direction,
      tech_name: techName,
      matched_by: matchedBy,
      summary: insights.summary,
      note_posted: true,
    },
    { onConflict: "recording_id" },
  );

  console.log(`[CALL-ANALYSIS] Posted call summary on #${ticket.halo_id} (${techName}, ${direction}, recording ${rec.Id})`);
  return { matched: true, posted: true };
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
      `  "relevant_to_ticket": <true if this call plausibly relates to the ticket above; false if it is clearly about something else entirely>,`,
      `  "summary": "<2-3 sentences: what the call was about and how it ended>",`,
      `  "actions_taken": ["<things actually DONE on the call — e.g. rebooted server, reset password>"],`,
      `  "commitments": ["<promises made and by whom — e.g. 'Tech: call back tomorrow 10 AM', 'Customer: send screenshot'>"],`,
      `  "next_steps": ["<what should happen next based on the call>"],`,
      `  "suggestions": ["<0-3 concrete suggestions for the tech — follow-ups the transcript shows are needed. Imperatives, no filler>"],`,
      `  "customer_sentiment": "<one word: satisfied | neutral | frustrated | angry>"`,
      `}`,
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
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
    ? `<tr style="background:#1a2332;"><td style="padding:7px 12px;${border}font-size:12.5px;color:#bfdbfe;line-height:1.5;"><span style="color:#60a5fa;font-weight:700;font-size:11px;">SUGGESTED — </span><ul style="margin:4px 0 0 18px;padding:0;">${list(insights.suggestions)}</ul></td></tr>`
    : "";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:8px 12px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:white;font-size:13px;font-weight:700;">📞 Call Summary — ${techName}` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;">${direction} · ${when} · ${durationMin} min · <span style="color:${sentimentColor};">${insights.customer_sentiment}</span></span>` +
    `</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:7px 12px;${border}font-size:12.5px;color:#e2e8f0;line-height:1.5;">${insights.summary}</td></tr>` +
    suggestionsRow +
    (detailBlocks
      ? `<tr style="background:#1E2028;"><td style="padding:0;${border}"><details style="margin:0;"><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ Call detail — actions, commitments &amp; next steps</summary><div style="padding:8px 12px;font-size:12px;line-height:1.5;border-top:1px solid #3a3f4b;">${detailBlocks}</div></details></td></tr>`
      : "") +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">TriageIt AI · auto-matched from 3CX recording · number ${externalNumber.replace(/^1(?=\d{10}$)/, "")}</td></tr>` +
    `</table>`
  );
}
