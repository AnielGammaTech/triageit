import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";
import type { TriageContext, ClassificationResult } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

interface TechFeedback {
  readonly rating: string;
  readonly communication_score: number;
  readonly response_time_assessment: string;
  readonly max_response_gap_hours: number;
  readonly strengths: string | null;
  readonly improvement_areas: string | null;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
}

interface ReviewEligibility {
  readonly eligible: boolean;
  readonly ticketAgeHours: number;
  readonly maxResponseGapHours: number;
  readonly customerActions: ReadonlyArray<TriageContext["actions"] extends ReadonlyArray<infer T> | undefined ? T : never>;
  readonly techActions: ReadonlyArray<TriageContext["actions"] extends ReadonlyArray<infer T> | undefined ? T : never>;
}

// ── Eligibility Check ────────────────────────────────────────────────

export function checkReviewEligibility(
  context: TriageContext,
  classification: ClassificationResult,
  haloConfig: HaloConfig | null,
  ticketCreatedAt: string,
): ReviewEligibility {
  const ticketAgeMs = Date.now() - new Date(ticketCreatedAt).getTime();
  const ticketAgeHours = ticketAgeMs / (1000 * 60 * 60);
  const actions = context.actions ?? [];

  const customerActions = actions.filter((a) => !a.isInternal);
  const techActions = actions.filter((a) => a.isInternal);

  // Find the longest gap between a customer reply and the next tech action
  const maxResponseGapHours = (() => {
    let maxGap = 0;
    for (const custAction of customerActions) {
      if (!custAction.date) continue;
      const custTime = new Date(custAction.date).getTime();
      const nextTech = techActions
        .filter((t) => t.date && new Date(t.date).getTime() > custTime)
        .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0];
      if (nextTech?.date) {
        const gapMs = new Date(nextTech.date).getTime() - custTime;
        maxGap = Math.max(maxGap, gapMs / (1000 * 60 * 60));
      } else {
        const gapMs = Date.now() - custTime;
        maxGap = Math.max(maxGap, gapMs / (1000 * 60 * 60));
      }
    }
    return maxGap;
  })();

  const eligible =
    haloConfig !== null &&
    actions.length > 0 &&
    ticketAgeHours >= 1 &&
    customerActions.length > 0 &&
    classification.urgency_score >= 2;

  return {
    eligible,
    ticketAgeHours,
    maxResponseGapHours,
    customerActions,
    techActions,
  };
}

// ── Generate & Post Tech Performance Review ──────────────────────────

export async function generateTechReview(
  context: TriageContext,
  classification: ClassificationResult,
  haloConfig: HaloConfig,
  eligibility: ReviewEligibility,
  supabase: SupabaseClient,
): Promise<void> {
  const halo = new HaloClient(haloConfig);
  const feedbackClient = new Anthropic();
  const actions = context.actions ?? [];

  const assignedTech = context.assignedTechName ?? null;
  const { ticketAgeHours, maxResponseGapHours } = eligibility;

  // Identify who is the dispatcher vs the assigned tech
  // People who responded but aren't the assigned tech are dispatchers/triage
  const dispatcherNames = actions
    .filter((a) => {
      if (!a.who) return false;
      // Someone who responded but isn't the assigned tech
      return assignedTech
        ? !a.who.toLowerCase().includes(assignedTech.toLowerCase())
        : false;
    })
    .map((a) => a.who!)
    .filter((name, i, arr) => arr.indexOf(name) === i);

  // Count actions specifically from the assigned tech
  const assignedTechActions = assignedTech
    ? actions.filter((a) => a.who?.toLowerCase().includes(assignedTech.toLowerCase()))
    : [];

  const feedbackPrompt = [
    `You are a senior IT service delivery manager reviewing how the ASSIGNED TECHNICIAN handled a support ticket.`,
    ``,
    `## CRITICAL: Identity Clarification`,
    `- **CUSTOMER (submitted the ticket):** ${context.userName ?? context.clientName ?? "Unknown"}`,
    `- **CLIENT COMPANY:** ${context.clientName ?? "Unknown"}`,
    `- **ASSIGNED TECHNICIAN (the ONLY person you are reviewing):** ${assignedTech ?? "Unknown Tech"}`,
    dispatcherNames.length > 0
      ? `- **DISPATCHERS/TRIAGE (NOT being reviewed):** ${dispatcherNames.join(", ")} — these people triaged/routed the ticket. Do NOT review their performance.`
      : ``,
    ``,
    `## CRITICAL RULES`,
    `1. You are reviewing ONLY **${assignedTech ?? "the assigned tech"}** — nobody else.`,
    `2. Dispatchers/triage staff who acknowledged or routed the ticket are NOT the assigned tech. Do not give them credit or review them.`,
    `3. If ${assignedTech ?? "the assigned tech"} has NOT posted any actions or notes, that is the most important finding — they have not engaged with this ticket at all.`,
    `4. ${assignedTech ?? "The assigned tech"} has ${assignedTechActions.length} action(s) on this ticket. If this is 0, the rating should be "poor" or "needs_improvement".`,
    ``,
    `## Ticket Context`,
    `- **Ticket #${context.haloId}:** ${context.summary}`,
    `- **Classification:** ${classification.classification.type} / ${classification.classification.subtype}`,
    `- **Urgency:** ${classification.urgency_score}/5`,
    `- **Ticket Age:** ${ticketAgeHours.toFixed(1)} hours`,
    `- **${assignedTech ?? "Tech"}'s actions:** ${assignedTechActions.length} | **Other staff actions:** ${actions.length - assignedTechActions.length}`,
    `- **Longest response gap (customer → assigned tech):** ${maxResponseGapHours.toFixed(1)} hours`,
    ``,
    `## Response Time Standards`,
    `- Gaps over 24 hours without any customer contact from the ASSIGNED TECH are UNACCEPTABLE.`,
    `- For high-urgency tickets (3+), gaps over 4 hours should be noted.`,
    `- A dispatcher acknowledging the ticket does NOT count as the assigned tech responding.`,
    `- Consider the ticket age when evaluating: if the ticket was just assigned, the tech hasn't had time to respond.`,
    ``,
    `## Full Conversation History`,
    ...actions.map((a) => {
      const who = a.who ?? "Unknown";
      const when = a.date ?? "";
      const visibility = a.isInternal ? "[INTERNAL NOTE]" : "[CUSTOMER-VISIBLE]";
      const isAssignedTech = assignedTech && who.toLowerCase().includes(assignedTech.toLowerCase());
      const role = isAssignedTech ? " [ASSIGNED TECH]" : "";
      return `- ${visibility}${role} **${who}** (${when}): ${a.note}`;
    }),
    ``,
    `## Your Task`,
    `Evaluate ONLY **${assignedTech ?? "the assigned tech"}**'s performance.`,
    `- If they have 0 actions: rate them poorly for non-engagement.`,
    `- If a dispatcher (like ${dispatcherNames[0] ?? "someone else"}) responded promptly, that is NOT credit for ${assignedTech ?? "the tech"}.`,
    `- Reference ${assignedTech ?? "the tech"} by name. NEVER review the customer or dispatchers.`,
    ``,
    `Respond with ONLY valid JSON:`,
    `{`,
    `  "rating": "<great | good | needs_improvement | poor>",`,
    `  "communication_score": "<1-5, where 5 = excellent>",`,
    `  "response_time_assessment": "<fast, adequate, slow, no_response>",`,
    `  "max_response_gap_hours": "<number, longest gap between customer msg and ASSIGNED TECH reply>",`,
    `  "strengths": "<what ${assignedTech ?? "the tech"} did well, null if nothing notable>",`,
    `  "improvement_areas": "<specific areas ${assignedTech ?? "the tech"} should improve, null if none>",`,
    `  "suggestions": ["<actionable suggestion for ${assignedTech ?? "the tech"}>"],`,
    `  "summary": "<1-2 sentence assessment of ${assignedTech ?? "the tech"}'s handling>"`,
    `}`,
  ].filter(Boolean).join("\n");

  const feedbackResponse = await feedbackClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: feedbackPrompt }],
  });

  const feedbackText = feedbackResponse.content[0].type === "text" ? feedbackResponse.content[0].text : "";
  const feedback = parseLlmJson<TechFeedback>(feedbackText);

  // Build the private coaching note
  const coachingNote = buildCoachingNote(feedback, maxResponseGapHours, ticketAgeHours);
  await halo.addInternalNote(context.haloId, coachingNote);

  await supabase.from("agent_logs").insert({
    ticket_id: context.ticketId,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "thinking",
    output_summary: `Employee feedback: ${feedback.rating} (${feedback.communication_score}/5 communication). ${feedback.summary}`,
  });
}

// ── Coaching Note HTML Builder ───────────────────────────────────────

function buildCoachingNote(
  feedback: TechFeedback,
  maxResponseGapHours: number,
  ticketAgeHours: number,
): string {
  const ratingColor = feedback.rating === "great" ? "#4ade80" : feedback.rating === "good" ? "#60a5fa" : feedback.rating === "needs_improvement" ? "#fbbf24" : "#f87171";
  const ratingEmoji = feedback.rating === "great" ? "🌟" : feedback.rating === "good" ? "👍" : feedback.rating === "needs_improvement" ? "📋" : "⚠️";
  const commScoreBar = "█".repeat(feedback.communication_score) + "░".repeat(5 - feedback.communication_score);
  const gapWarning = maxResponseGapHours >= 24 ? " ⚠️ >24h gap" : "";

  const suggestionsHtml = feedback.suggestions.length > 0
    ? `<ol style="margin:4px 0;padding-left:20px;">${feedback.suggestions.map((s) => `<li style="margin-bottom:4px;">${s}</li>`).join("")}</ol>`
    : "No specific suggestions.";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#059669,#10b981);color:white;font-size:14px;font-weight:700;">${ratingEmoji} Tech Performance Review — TriageIt AI</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Rating</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${ratingColor};font-weight:700;">${feedback.rating.replace(/_/g, " ").toUpperCase()}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Communication</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;font-family:monospace;">${commScoreBar} ${feedback.communication_score}/5</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Response Time</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${feedback.response_time_assessment}${gapWarning}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Max Gap</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${maxResponseGapHours >= 24 ? "#f87171" : maxResponseGapHours >= 4 ? "#fbbf24" : "#4ade80"};">${maxResponseGapHours.toFixed(1)}h (ticket age: ${ticketAgeHours.toFixed(1)}h)</td></tr>` +
    (feedback.strengths ? `<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Strengths</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#bbf7d0;">${feedback.strengths}</td></tr>` : "") +
    (feedback.improvement_areas ? `<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#fbbf24;">Improve</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#fde68a;">${feedback.improvement_areas}</td></tr>` : "") +
    `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#60a5fa;">Suggestions</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#bfdbfe;">${suggestionsHtml}</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Summary</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;font-weight:500;">${feedback.summary}</td></tr>` +
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · Employee Feedback · Private Note</td></tr>` +
    `</table>`
  );
}
