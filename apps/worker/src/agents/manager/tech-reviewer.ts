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

// ── Business Hours Utilities ─────────────────────────────────────────

const BUSINESS_START_HOUR = 7;  // 7 AM ET
const BUSINESS_END_HOUR = 18;   // 6 PM ET
const TIMEZONE = "America/New_York";
const MIN_TICKET_AGE_HOURS = 1; // Don't review tickets younger than 1 hour

/**
 * Check if a given timestamp falls within business hours (Mon-Fri, 7 AM - 6 PM ET).
 */
function isBusinessHours(date: Date): boolean {
  const etDate = new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const day = etDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = etDate.getHours();
  return day >= 1 && day <= 5 && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

/**
 * Calculate business hours between two timestamps.
 * Only counts time during Mon-Fri 7 AM - 6 PM Eastern.
 * Returns hours (fractional).
 */
function calculateBusinessHoursGap(startTime: number, endTime: number): number {
  if (endTime <= startTime) return 0;

  let businessMs = 0;
  const STEP_MS = 15 * 60 * 1000; // 15-minute increments for accuracy

  let cursor = startTime;
  while (cursor < endTime) {
    const cursorDate = new Date(cursor);
    if (isBusinessHours(cursorDate)) {
      const stepEnd = Math.min(cursor + STEP_MS, endTime);
      businessMs += stepEnd - cursor;
    }
    cursor += STEP_MS;
  }

  return businessMs / (1000 * 60 * 60);
}

// ── Eligibility Check ────────────────────────────────────────────────

export function checkReviewEligibility(
  context: TriageContext,
  _classification: ClassificationResult,
  haloConfig: HaloConfig | null,
  ticketCreatedAt: string,
): ReviewEligibility {
  const ticketAgeMs = Date.now() - new Date(ticketCreatedAt).getTime();
  const ticketAgeHours = ticketAgeMs / (1000 * 60 * 60);
  const actions = context.actions ?? [];

  const customerActions = actions.filter((a) => !a.isInternal);
  const techActions = actions.filter((a) => a.isInternal);

  // Find the longest BUSINESS HOURS gap between a customer reply and the next tech action
  const maxResponseGapHours = (() => {
    let maxGap = 0;
    for (const custAction of customerActions) {
      if (!custAction.date) continue;
      const custTime = new Date(custAction.date).getTime();
      const nextTech = techActions
        .filter((t) => t.date && new Date(t.date).getTime() > custTime)
        .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0];

      const endTime = nextTech?.date ? new Date(nextTech.date).getTime() : Date.now();
      const businessGap = calculateBusinessHoursGap(custTime, endTime);
      maxGap = Math.max(maxGap, businessGap);
    }
    return maxGap;
  })();

  // No tech assigned = nothing to review (that's a dispatch problem, not a tech problem)
  const techName = context.assignedTechName?.trim().toLowerCase() ?? "";
  const NON_TECH_NAMES = ["unassigned", "dispatch", "bryanna", "triage", ""];
  const hasAssignedTech = !!(context.assignedTechName) && !NON_TECH_NAMES.includes(techName);

  // Must have at least 1 business hour of ticket age before reviewing
  const ticketCreatedTime = new Date(ticketCreatedAt).getTime();
  const businessAgeHours = calculateBusinessHoursGap(ticketCreatedTime, Date.now());
  const hasMinimumAge = businessAgeHours >= MIN_TICKET_AGE_HOURS;

  const eligible =
    haloConfig !== null &&
    hasAssignedTech &&
    hasMinimumAge &&
    actions.length > 0 &&
    customerActions.length > 0;

  if (!eligible && haloConfig !== null) {
    const reasons: string[] = [];
    if (!hasAssignedTech) reasons.push("no assigned tech");
    if (!hasMinimumAge) reasons.push(`ticket too new (${businessAgeHours.toFixed(1)} business hrs < ${MIN_TICKET_AGE_HOURS}hr minimum)`);
    if (actions.length === 0) reasons.push("no actions");
    if (customerActions.length === 0) reasons.push("no customer actions");
    if (reasons.length > 0) {
      console.log(`[TECH-REVIEW] Skipping review for #${context.haloId}: ${reasons.join(", ")}`);
    }
  }

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
    `You are an honest IT service delivery manager reviewing tech performance.`,
    `Your job: evaluate how **${assignedTech ?? "the assigned technician"}** handled this ticket.`,
    ``,
    `## WHAT MATTERS MOST (in order)`,
    `1. **RESPONSE TIME** — How quickly did the tech respond? Long gaps = bad customer experience.`,
    `2. **CUSTOMER FRUSTRATION** — Is the customer frustrated, repeating themselves, or escalating? That's a red flag.`,
    `3. **HELPFULNESS** — Is the tech actually moving the ticket forward or just going through motions?`,
    ``,
    `## USE LOGIC — Don't Over-Penalize`,
    `- Asking clarifying questions IS helpful. A tech asking "what's the user's name?" to proceed is a VALID first step.`,
    `- Gathering info before acting is normal — don't flag it as "missing the point."`,
    `- Only flag a response as unhelpful if the tech is clearly ignoring the customer's request, going on a tangent, or providing wrong solutions.`,
    `- Read the tech's response in context. If it moves the ticket forward even slightly, give credit.`,
    ``,
    `## MSP REALITIES — Read Between the Lines`,
    `- **Scheduling a call or meeting IS a valid response.** Many clients prefer phone/remote sessions over email troubleshooting. If the tech scheduled a call, that's engagement — not inaction.`,
    `- **Internal notes count as work.** If a tech left internal notes (research, scheduling, coordination), they ARE working the ticket even if nothing is visible to the customer yet.`,
    `- **Phone/remote work often isn't documented in tickets.** If a tech scheduled a call and the next action is a resolution or update, assume the call happened. Don't penalize for lack of notes — instead SUGGEST better documentation.`,
    `- **Some issues require research first.** A tech who takes time to research before responding is being thorough, not negligent.`,
    `- **Coordination with vendors/other techs takes time.** If the tech is waiting on parts, vendor responses, or internal coordination, that's progress.`,
    `- **The gap between "needs_improvement" and "poor" matters.** Use "poor" ONLY when the tech genuinely dropped the ball (no response at all for an extended period, customer visibly frustrated with no acknowledgment). If they responded but could improve, use "needs_improvement" or "good" with constructive feedback.`,
    `- **When in doubt about what happened off-ticket, give the tech the benefit of the doubt** and recommend they document their actions better.`,
    ``,
    `## BUSINESS HOURS CONTEXT`,
    `- Business hours are **Mon-Fri, 7 AM - 6 PM Eastern** only.`,
    `- Response gaps are measured in **business hours only** — nights, weekends, and holidays do NOT count.`,
    `- A ticket opened at 9 PM won't start counting response time until 7 AM the next business day.`,
    `- The max_response_gap_hours below is already calculated in business hours.`,
    ``,
    `## WHAT TO CALL OUT HARD`,
    `- No response within 1 business hour = call it out.`,
    `- Customer waiting > 4 business hours with no update on urgent tickets = call it out.`,
    `- Customer waiting > 8 business hours (full business day) = POOR.`,
    `- Customer is visibly frustrated or repeating the same request = the tech is failing.`,
    `- Tech closed/resolved without actually fixing the issue = call it out.`,
    `- Tech gave a generic canned response that doesn't address the specific situation = call it out.`,
    ``,
    `## IDENTITY`,
    `- **CUSTOMER:** ${context.userName ?? context.clientName ?? "Unknown"} (${context.clientName ?? "Unknown"})`,
    `- **ASSIGNED TECH (reviewing THIS person ONLY):** ${assignedTech ?? "Unknown Tech"}`,
    dispatcherNames.length > 0
      ? `- **DISPATCHERS (ignore, do NOT review):** ${dispatcherNames.join(", ")}`
      : ``,
    ``,
    `## FACTS`,
    `- ${assignedTech ?? "The tech"} has **${assignedTechActions.length} action(s)** on this ticket.`,
    `- Ticket has been open for **${ticketAgeHours.toFixed(1)} total hours**.`,
    `- Longest response gap: **${maxResponseGapHours.toFixed(1)} business hours** (excludes nights/weekends).`,
    `- ${assignedTechActions.length === 0 ? `⚠ ${assignedTech ?? "The tech"} has taken ZERO actions. The customer is waiting with no engagement.` : ""}`,
    ``,
    `## Ticket: #${context.haloId} — ${context.summary}`,
    `Type: ${classification.classification.type}/${classification.classification.subtype} | Urgency: ${classification.urgency_score}/5`,
    ``,
    `## Conversation History`,
    ...actions.map((a) => {
      const who = a.who ?? "Unknown";
      const when = a.date ?? "";
      const visibility = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
      const isAssignedTech = assignedTech && who.toLowerCase().includes(assignedTech.toLowerCase());
      const role = isAssignedTech ? " [ASSIGNED TECH]" : "";
      return `- ${visibility}${role} **${who}** (${when}): ${a.note}`;
    }),
    ``,
    `## Output — JSON only`,
    `{`,
    `  "rating": "great | good | needs_improvement | poor",`,
    `  "communication_score": 1-5,`,
    `  "response_time_assessment": "fast | adequate | slow | no_response",`,
    `  "max_response_gap_hours": number,`,
    `  "strengths": "what they did well, or null if nothing",`,
    `  "improvement_areas": "be direct — what they failed at, or null if nothing",`,
    `  "suggestions": ["actionable, specific steps they should take"],`,
    `  "summary": "2-3 sentences. Name the tech. Focus on response time, customer satisfaction, and whether they're actually helping."`,
    `}`,
  ].filter(Boolean).join("\n");

  const feedbackResponse = await feedbackClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 768,
    messages: [{ role: "user", content: feedbackPrompt }],
  });

  const feedbackText = feedbackResponse.content[0].type === "text" ? feedbackResponse.content[0].text : "";
  const feedback = parseLlmJson<TechFeedback>(feedbackText);

  // Build the private coaching note
  const coachingNote = buildCoachingNote(feedback, maxResponseGapHours, ticketAgeHours);
  await halo.addInternalNote(context.haloId, coachingNote);

  // Store in tech_reviews table for the Review tab
  await supabase.from("tech_reviews").insert({
    ticket_id: context.ticketId,
    halo_id: context.haloId,
    tech_name: context.assignedTechName ?? null,
    rating: feedback.rating,
    communication_score: feedback.communication_score,
    response_time: feedback.response_time_assessment,
    max_gap_hours: maxResponseGapHours,
    strengths: feedback.strengths ?? null,
    improvement_areas: feedback.improvement_areas ?? null,
    suggestions: feedback.suggestions ?? [],
    summary: feedback.summary,
  });

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
