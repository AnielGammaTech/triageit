import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";

// ── Types ────────────────────────────────────────────────────────────

interface CloseReviewResult {
  readonly resolution_summary: string;
  readonly tech_performance: {
    readonly rating: "great" | "good" | "needs_improvement" | "poor";
    readonly response_time: string;
    readonly communication: string;
    readonly highlights: string | null;
    readonly issues: string | null;
  };
  readonly documentation_action: {
    readonly hudu_updates_needed: ReadonlyArray<string>;
    readonly quality_score: 1 | 2 | 3 | 4 | 5;
    readonly notes: string;
  };
  readonly onsite_visits: ReadonlyArray<string>;
  readonly ticket_lifecycle: {
    readonly total_time: string;
    readonly first_response_time: string;
    readonly resolution_method: string;
  };
}

// ── Close Review Generator ───────────────────────────────────────────

const CLOSE_REVIEW_PROMPT = `You are reviewing a RESOLVED IT support ticket for an MSP (Gamma Tech Services LLC).
Analyze the full ticket lifecycle and produce a close-out review.

## What you're reviewing:
- How the tech handled the ticket from open to close
- Whether documentation needs updating in Hudu (the IT documentation platform)
- A brief factual summary of what happened and how it was resolved

## Rules:
- Be factual — only state what the ticket history shows
- Hudu updates should ONLY be permanent environment documentation: network configs, device inventories, passwords, procedures, contact info, DNS records. NOT ticket-specific details.
- Rate the tech honestly — great/good/needs_improvement/poor
- If there were onsite visits, note them
- Keep everything concise

## Output JSON:
{
  "resolution_summary": "<2-3 sentence summary of the issue and how it was resolved>",
  "tech_performance": {
    "rating": "<great|good|needs_improvement|poor>",
    "response_time": "<fast|adequate|slow|no_response — based on first reply after customer opened ticket>",
    "communication": "<brief assessment of tech's communication with customer>",
    "highlights": "<what the tech did well, or null>",
    "issues": "<what could have been better, or null>"
  },
  "documentation_action": {
    "hudu_updates_needed": ["<list of permanent client environment docs to add/update in Hudu — empty if none>"],
    "quality_score": <1-5 — how well-documented is this client's environment based on what we saw>,
    "notes": "<brief note on documentation state>"
  },
  "onsite_visits": ["<list of onsite visits mentioned, or empty array>"],
  "ticket_lifecycle": {
    "total_time": "<time from open to close, e.g. '2 days 4 hours'>",
    "first_response_time": "<time to first tech response, e.g. '45 minutes'>",
    "resolution_method": "<remote|onsite|vendor|automated|escalated>"
  }
}`;

export async function generateCloseReview(
  haloId: number,
  supabase: SupabaseClient,
): Promise<{ review: CloseReviewResult; noteHtml: string }> {
  // Fetch ticket from local DB
  const { data: ticket } = await supabase
    .from("tickets")
    .select("*, triage_results(classification, urgency_score, internal_notes, findings, created_at)")
    .eq("halo_id", haloId)
    .single();

  if (!ticket) throw new Error(`Ticket #${haloId} not found`);

  // Fetch Halo config for live actions
  const { data: haloIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!haloIntegration) throw new Error("Halo PSA not configured");

  const haloConfig = haloIntegration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);

  // Pull all ticket actions from Halo
  const rawActions = await halo.getTicketActions(haloId);
  const actions = rawActions
    .filter((a) => {
      const note = (a.note ?? "").toLowerCase();
      return !note.includes("triageit") && !note.includes("ai triage");
    })
    .map((a) => ({
      who: a.who ?? "Unknown",
      date: a.datecreated ?? "Unknown",
      note: (a.note ?? "").slice(0, 800),
      isInternal: a.hiddenfromuser,
      outcome: a.outcome ?? null,
    }));

  // Check for existing tech review
  const { data: techReview } = await supabase
    .from("tech_reviews")
    .select("rating, response_time, summary, improvement_areas, strengths")
    .eq("halo_id", haloId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build context for the LLM
  const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
  const latestTriage = triageResults[0];

  const context = [
    `## Ticket #${haloId}`,
    `Summary: ${ticket.summary}`,
    `Client: ${ticket.client_name ?? "Unknown"}`,
    `Tech: ${ticket.halo_agent ?? "Unassigned"}`,
    `Status: ${ticket.halo_status ?? "Unknown"}`,
    `Created: ${ticket.created_at}`,
    ticket.details ? `Details: ${ticket.details.slice(0, 1500)}` : "",
    "",
    latestTriage ? `## AI Triage Classification` : "",
    latestTriage ? `Type: ${JSON.stringify((latestTriage.classification as Record<string, string>))}` : "",
    latestTriage ? `Urgency: ${latestTriage.urgency_score}/5` : "",
    latestTriage ? `Notes: ${String(latestTriage.internal_notes ?? "").slice(0, 1000)}` : "",
    "",
    techReview ? `## Existing Tech Review` : "",
    techReview ? `Rating: ${techReview.rating} | Response: ${techReview.response_time}` : "",
    techReview ? `Summary: ${techReview.summary}` : "",
    techReview?.strengths ? `Strengths: ${techReview.strengths}` : "",
    techReview?.improvement_areas ? `Areas to improve: ${techReview.improvement_areas}` : "",
    "",
    `## Ticket Actions (${actions.length} total):`,
    ...actions.map((a) => {
      const vis = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
      return `- ${vis} ${a.who} (${a.date}): ${a.note}`;
    }),
  ].filter(Boolean).join("\n");

  // Call LLM
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [
      { role: "user", content: `${CLOSE_REVIEW_PROMPT}\n\n${context}` },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const review = parseLlmJson<CloseReviewResult>(text);

  // Build Halo note HTML
  const noteHtml = buildCloseReviewNote(review, ticket.halo_agent ?? "Unknown Tech", haloId);

  // Post to Halo
  await halo.addInternalNote(haloId, noteHtml);

  // Store in DB
  await supabase.from("close_reviews").insert({
    ticket_id: ticket.id,
    halo_id: haloId,
    tech_name: ticket.halo_agent,
    review_data: review,
  });

  return { review, noteHtml };
}

// ── HTML Note Builder ────────────────────────────────────────────────

function buildCloseReviewNote(
  review: CloseReviewResult,
  techName: string,
  haloId: number,
): string {
  const ratingConfig: Record<string, { emoji: string; color: string; bg: string }> = {
    great: { emoji: "🟢", color: "#4ade80", bg: "#052e16" },
    good: { emoji: "🔵", color: "#60a5fa", bg: "#172554" },
    needs_improvement: { emoji: "🟡", color: "#fbbf24", bg: "#422006" },
    poor: { emoji: "🔴", color: "#f87171", bg: "#450a0a" },
  };
  const rc = ratingConfig[review.tech_performance.rating] ?? ratingConfig.good;
  const border = "border-bottom:1px solid #3a3f4b;";
  const rows: string[] = [];

  // Header
  rows.push(
    `<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#065f46,#059669);color:white;font-size:12px;font-weight:700;">` +
    `📋 Close Review — Ticket #${haloId}</td></tr>`,
  );

  // Resolution summary
  rows.push(
    `<tr style="background:#252830;"><td style="padding:5px 12px;font-weight:600;width:100px;${border}font-size:11px;color:#94a3b8;">Summary</td>` +
    `<td style="padding:5px 12px;${border}font-size:12px;color:#e2e8f0;">${review.resolution_summary}</td></tr>`,
  );

  // Lifecycle
  rows.push(
    `<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:100px;${border}font-size:11px;color:#60a5fa;">Lifecycle</td>` +
    `<td style="padding:5px 12px;${border}font-size:11px;color:#bfdbfe;">` +
    `Total: ${review.ticket_lifecycle.total_time} · First response: ${review.ticket_lifecycle.first_response_time} · Method: ${review.ticket_lifecycle.resolution_method}</td></tr>`,
  );

  // Tech performance
  rows.push(
    `<tr style="background:${rc.bg};"><td style="padding:5px 12px;font-weight:600;width:100px;${border}font-size:11px;color:${rc.color};">${rc.emoji} ${techName}</td>` +
    `<td style="padding:5px 12px;${border}font-size:11px;color:#e2e8f0;">` +
    `<strong style="color:${rc.color};">${review.tech_performance.rating.replace("_", " ").toUpperCase()}</strong> · ` +
    `Response: ${review.tech_performance.response_time} · ${review.tech_performance.communication}` +
    `${review.tech_performance.highlights ? `<br/>✅ ${review.tech_performance.highlights}` : ""}` +
    `${review.tech_performance.issues ? `<br/>⚠️ ${review.tech_performance.issues}` : ""}` +
    `</td></tr>`,
  );

  // Onsite visits
  if (review.onsite_visits.length > 0) {
    rows.push(
      `<tr style="background:#252830;"><td style="padding:5px 12px;font-weight:600;width:100px;${border}font-size:11px;color:#a78bfa;">🚗 Onsite</td>` +
      `<td style="padding:5px 12px;${border}font-size:11px;color:#e2e8f0;">${review.onsite_visits.join("<br/>")}</td></tr>`,
    );
  }

  // Documentation
  const docColor = review.documentation_action.quality_score >= 4 ? "#4ade80" : review.documentation_action.quality_score >= 3 ? "#fbbf24" : "#f87171";
  const huduUpdates = review.documentation_action.hudu_updates_needed;
  rows.push(
    `<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:100px;${border}font-size:11px;color:${docColor};">📝 Docs</td>` +
    `<td style="padding:5px 12px;${border}font-size:11px;color:#e2e8f0;">` +
    `Quality: <strong style="color:${docColor};">${review.documentation_action.quality_score}/5</strong> · ${review.documentation_action.notes}` +
    `${huduUpdates.length > 0 ? `<br/><strong>Update Hudu:</strong> ${huduUpdates.join(", ")}` : ""}` +
    `</td></tr>`,
  );

  // Footer
  rows.push(
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:3px 12px;color:#64748b;font-size:9px;text-align:right;">` +
    `TriageIt AI · close review</td></tr>`,
  );

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;` +
    `font-size:12px;color:#e2e8f0;border:1px solid #059669;background:#1E2028;border-radius:6px;overflow:hidden;">` +
    `${rows.join("")}</table>`
  );
}
