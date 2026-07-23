import Anthropic from "@anthropic-ai/sdk";
import { extractResponseText } from "../llm-text.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import { isInternalStaffName, type HaloConfig } from "@triageit/shared";
import type { TriageContext, ClassificationResult } from "../types.js";
import { responseBusinessMinutesBetween } from "../../response-compliance/business-time.js";
import { namesMatch } from "../../dispatch/board-sources.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TechFeedback {
  readonly rating: string;
  readonly communication_score: number;
  readonly response_time_assessment: string;
  readonly max_response_gap_hours: number;
  readonly strengths: string | null;
  readonly improvement_areas: string | null;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
}

/** One customer message → next customer-visible staff reply. */
interface ResponseExchange {
  readonly customerAt: string;
  readonly repliedAt: string | null;
  readonly gapBusinessHours: number;
  readonly withinStandard: boolean;
}

/** Deterministic response-speed facts — the backbone of Toby's review. */
export interface ResponseFacts {
  /** Business hours from ticket creation to first customer-visible staff reply, null if none yet */
  readonly firstResponseBh: number | null;
  readonly exchanges: ReadonlyArray<ResponseExchange>;
  readonly answered: number;
  readonly unanswered: number;
  /** Business hours the customer has CURRENTLY been waiting, null if not waiting */
  readonly currentlyWaitingBh: number | null;
}

export interface ReviewEligibility {
  readonly eligible: boolean;
  readonly ticketAgeHours: number;
  readonly accountableBusinessHours: number;
  readonly maxResponseGapHours: number;
  readonly responseFacts: ResponseFacts;
  readonly customerActions: ReadonlyArray<TriageContext["actions"] extends ReadonlyArray<infer T> | undefined ? T : never>;
  readonly techActions: ReadonlyArray<TriageContext["actions"] extends ReadonlyArray<infer T> | undefined ? T : never>;
}

/** Universal response standard: 1 business hour after a customer reply. */
const RESPONSE_STANDARD_BH = 1;
const NEEDS_IMPROVEMENT_BH = 4;
const POOR_RESPONSE_BH = 8;

export interface ReviewTimingContext {
  /** When the current technician became accountable for this ticket. */
  readonly assignedAt?: string | null;
  /** Current assignment owner from the compliance ledger, when available. */
  readonly assignedTech?: string | null;
  /** Test hook and deterministic review timestamp. */
  readonly now?: Date;
}

// ── Business Hours Utilities ─────────────────────────────────────────

const MIN_TICKET_AGE_HOURS = 1; // Don't review tickets younger than 1 hour
const NON_TECH_ASSIGNMENT_MARKERS = [
  "unassigned",
  "dispatch",
  "bryanna",
  "triage",
  "jonathan",
  "roman",
  "todd",
  "",
];

function isNonTechAssignment(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return NON_TECH_ASSIGNMENT_MARKERS.some((marker) =>
    marker === "" ? normalized === "" : normalized.includes(marker),
  );
}

/**
 * Calculate business hours between two timestamps.
 * Only counts time during Mon-Fri 8 AM - 5 PM Eastern.
 * Returns hours (fractional).
 */
function calculateBusinessHoursGap(startTime: number, endTime: number): number {
  if (endTime <= startTime) return 0;
  return responseBusinessMinutesBetween(new Date(startTime), new Date(endTime)) / 60;
}

// ── Eligibility Check ────────────────────────────────────────────────

export function checkReviewEligibility(
  context: TriageContext,
  _classification: ClassificationResult,
  haloConfig: HaloConfig | null,
  ticketCreatedAt: string,
  timing: ReviewTimingContext = {},
): ReviewEligibility {
  const nowMs = timing.now?.getTime() ?? Date.now();
  const ticketAgeMs = nowMs - new Date(ticketCreatedAt).getTime();
  const ticketAgeHours = ticketAgeMs / (1000 * 60 * 60);
  const actions = context.actions ?? [];
  const assignedTech = timing.assignedTech?.trim() || context.assignedTechName?.trim() || null;
  const assignmentStartMs = timing.assignedAt
    ? new Date(timing.assignedAt).getTime()
    : new Date(ticketCreatedAt).getTime();
  const reviewStartMs = Number.isFinite(assignmentStartMs)
    ? assignmentStartMs
    : new Date(ticketCreatedAt).getTime();

  // Identify customer vs staff actions by WHO sent them, not by visibility.
  // A tech replying to a customer sends a PUBLIC (non-internal) action —
  // still a staff action. The old heuristic treated ANY public action not
  // from the assigned tech as a customer message, so a dispatcher's or
  // second tech's public reply inflated the response-gap math the whole
  // review is graded on.
  const customerName = (context.userName ?? "").toLowerCase().trim();
  const customerEmail = (context.userEmail ?? "").toLowerCase().trim();

  const isStaffSender = (who: string): boolean =>
    isInternalStaffName(who) ||
    who.includes("gamma.tech") ||
    who.includes("gtmail") ||
    who.includes("triageit") ||
    who.includes("triggr");

  const isCustomerAction = (a: typeof actions[0]): boolean => {
    const who = (a.who ?? "").toLowerCase().trim();
    if (!who) return !a.isInternal; // fallback: public + unknown sender = likely customer
    if (isStaffSender(who)) return false;
    if (customerName && who.includes(customerName)) return true;
    if (customerEmail && who.includes(customerEmail)) return true;
    // Public action from someone who is neither known staff nor the reporter:
    // most likely another person at the customer (CC'd colleague)
    return !a.isInternal;
  };

  const customerActions = actions.filter(isCustomerAction);
  const techActions = actions.filter((a) =>
    !isCustomerAction(a) &&
    (!assignedTech || namesMatch(a.who, assignedTech)),
  );

  // Customer-visible staff replies — internal notes don't count, the
  // customer only sees public replies.
  const visibleTechActions = actions.filter((a) => {
    if (a.isInternal) return false;
    if (isCustomerAction(a)) return false;
    return !assignedTech || namesMatch(a.who, assignedTech);
  });

  // Deterministic response timeline: each customer message paired with the
  // NEXT customer-visible staff reply, gaps in business hours
  const exchanges: ResponseExchange[] = [];
  for (const custAction of customerActions) {
    if (!custAction.date) continue;
    const custTime = new Date(custAction.date).getTime();
    const nextVisible = visibleTechActions
      .filter((t) => t.date && new Date(t.date).getTime() > custTime)
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0];

    const endTime = nextVisible?.date ? new Date(nextVisible.date).getTime() : nowMs;
    // A technician is not accountable for time before the ticket was assigned
    // to them. A customer message that predates assignment starts this tech's
    // clock at assignment.
    const responseStart = Math.max(custTime, reviewStartMs);
    const gapBusinessHours = calculateBusinessHoursGap(responseStart, endTime);
    exchanges.push({
      customerAt: custAction.date,
      repliedAt: nextVisible?.date ?? null,
      gapBusinessHours,
      withinStandard: gapBusinessHours <= RESPONSE_STANDARD_BH,
    });
  }
  exchanges.sort((a, b) => new Date(a.customerAt).getTime() - new Date(b.customerAt).getTime());

  const maxResponseGapHours = exchanges.reduce((m, e) => Math.max(m, e.gapBusinessHours), 0);

  // First response: ticket creation → first customer-visible staff reply
  const firstVisibleReply = visibleTechActions
    .filter((t) => t.date && new Date(t.date).getTime() >= reviewStartMs)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0];
  const firstResponseBh = firstVisibleReply?.date
    ? calculateBusinessHoursGap(reviewStartMs, new Date(firstVisibleReply.date).getTime())
    : null;

  const lastUnanswered = [...exchanges].reverse().find((e) => e.repliedAt === null);
  const responseFacts: ResponseFacts = {
    firstResponseBh,
    exchanges,
    answered: exchanges.filter((e) => e.repliedAt !== null).length,
    unanswered: exchanges.filter((e) => e.repliedAt === null).length,
    currentlyWaitingBh: lastUnanswered ? lastUnanswered.gapBusinessHours : null,
  };

  // Check if ticket has an assigned tech or if it's unassigned (dispatch issue)
  const techName = assignedTech?.toLowerCase() ?? "";
  const isUnassigned = !assignedTech || isNonTechAssignment(techName);

  // Must have at least 1 business hour of ticket age before reviewing
  const businessAgeHours = calculateBusinessHoursGap(reviewStartMs, nowMs);
  const hasMinimumAge = businessAgeHours >= MIN_TICKET_AGE_HOURS;

  // Always eligible as long as Halo is configured and ticket is old enough.
  // Unassigned tickets get reviewed too — calls out the dispatch gap.
  // Tickets with no customer actions still get reviewed — evaluates tech engagement.
  const eligible = haloConfig !== null && hasMinimumAge;

  if (!eligible && haloConfig !== null) {
    console.log(`[TECH-REVIEW] Skipping review for #${context.haloId}: ticket too new (${businessAgeHours.toFixed(1)} business hrs < ${MIN_TICKET_AGE_HOURS}hr minimum)`);
  }
  if (eligible && isUnassigned) {
    console.log(`[TECH-REVIEW] #${context.haloId} is not assigned to a technician — review will flag dispatch gap`);
  }

  return {
    eligible,
    ticketAgeHours,
    accountableBusinessHours: businessAgeHours,
    maxResponseGapHours,
    responseFacts,
    customerActions,
    techActions,
  };
}

/**
 * The language model may assess tone and helpfulness, but it cannot override
 * the deterministic response clock. This prevents invented wall-clock claims
 * from becoming a technician rating or a stored coaching fact.
 */
export function calibrateTechFeedback(
  raw: TechFeedback,
  facts: ResponseFacts,
  assignedTech: string,
  accountableBusinessHours: number,
): TechFeedback {
  const firstResponse = facts.firstResponseBh;
  const exchangeGap = facts.exchanges.reduce(
    (largest, exchange) => Math.max(largest, exchange.gapBusinessHours),
    0,
  );
  const currentWait = facts.currentlyWaitingBh ?? 0;
  const evidenceGap = Math.max(firstResponse ?? 0, exchangeGap, currentWait);
  const noVisibleResponse = firstResponse === null;

  let rating: TechFeedback["rating"];
  if (
    evidenceGap > POOR_RESPONSE_BH ||
    (noVisibleResponse && accountableBusinessHours > POOR_RESPONSE_BH)
  ) {
    rating = "poor";
  } else if (
    evidenceGap > NEEDS_IMPROVEMENT_BH ||
    (noVisibleResponse && accountableBusinessHours > NEEDS_IMPROVEMENT_BH)
  ) {
    rating = "needs_improvement";
  } else if (
    raw.rating === "great" &&
    evidenceGap <= RESPONSE_STANDARD_BH &&
    facts.unanswered === 0
  ) {
    rating = "great";
  } else {
    // A small 1-4 business-hour miss is coaching, not a negative score.
    // Qualitative AI concerns remain visible in the full review but cannot
    // manufacture a timing failure unsupported by the evidence.
    rating = "good";
  }

  const fmt = (hours: number): string => `${hours.toFixed(1)} business hour${Math.abs(hours - 1) < 0.05 ? "" : "s"}`;
  let summary: string;
  let timingImprovement: string | null = null;
  if (noVisibleResponse) {
    const elapsed = Math.max(accountableBusinessHours, currentWait);
    summary = `${assignedTech} has not sent a customer-visible email after ${fmt(elapsed)} of accountable time.`;
    if (elapsed > RESPONSE_STANDARD_BH) {
      timingImprovement = `Send a customer-visible update; the current wait is ${fmt(elapsed)} against the 1-business-hour standard.`;
    }
  } else {
    const longestCustomerGap = Math.max(exchangeGap, currentWait);
    summary = `${assignedTech}'s first customer-visible reply was ${fmt(firstResponse)} after assignment; the longest customer-message gap was ${fmt(longestCustomerGap)}.`;
    if (evidenceGap > RESPONSE_STANDARD_BH) {
      timingImprovement = `The longest verified response interval was ${fmt(evidenceGap)}, ${fmt(evidenceGap - RESPONSE_STANDARD_BH)} beyond the 1-business-hour standard.`;
    } else {
      summary += " The verified response timing met the 1-business-hour standard.";
    }
  }

  return {
    ...raw,
    rating,
    communication_score: Math.max(1, Math.min(5, Math.round(raw.communication_score))),
    response_time_assessment:
      noVisibleResponse
        ? "no_response"
        : evidenceGap <= RESPONSE_STANDARD_BH
          ? "fast"
          : evidenceGap <= NEEDS_IMPROVEMENT_BH
            ? "adequate"
            : "slow",
    max_response_gap_hours: Math.round(evidenceGap * 100) / 100,
    improvement_areas: timingImprovement ?? (
      /\b(?:hour|minute|response|reply|gap|delay)\b/i.test(raw.improvement_areas ?? "")
        ? null
        : raw.improvement_areas
    ),
    summary,
  };
}

/** Render the deterministic response timeline for prompt + note. */
function formatResponseFacts(facts: ResponseFacts): string {
  const lines: string[] = [];
  lines.push(
    facts.firstResponseBh === null
      ? "First response: NONE — no customer-visible staff reply yet"
      : `First response: ${facts.firstResponseBh.toFixed(1)} business hrs after assignment ${facts.firstResponseBh <= RESPONSE_STANDARD_BH ? "✓ within standard" : `✗ standard is ${RESPONSE_STANDARD_BH}h`}`,
  );
  if (facts.exchanges.length > 0) {
    lines.push(`Customer messages answered: ${facts.answered}/${facts.exchanges.length}${facts.unanswered > 0 ? ` — ${facts.unanswered} UNANSWERED` : ""}`);
    for (const e of facts.exchanges.slice(-6)) {
      const when = new Date(e.customerAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      lines.push(
        e.repliedAt
          ? `- Customer msg ${when} → replied in ${e.gapBusinessHours.toFixed(1)} business hrs ${e.withinStandard ? "✓" : "✗"}`
          : `- Customer msg ${when} → NO VISIBLE REPLY YET (${e.gapBusinessHours.toFixed(1)} business hrs and counting) ✗`,
      );
    }
  } else {
    lines.push("No customer messages to answer yet.");
  }
  if (facts.currentlyWaitingBh !== null) {
    lines.push(`⚠ CUSTOMER IS WAITING RIGHT NOW: ${facts.currentlyWaitingBh.toFixed(1)} business hrs since their last message with no visible reply.`);
  }
  return lines.join("\n");
}

// ── Generate & Post Tech Performance Review ──────────────────────────

export async function generateTechReview(
  context: TriageContext,
  classification: ClassificationResult,
  haloConfig: HaloConfig,
  eligibility: ReviewEligibility,
  supabase: SupabaseClient,
  postNote = true,
): Promise<string | null> {
  const halo = new HaloClient(haloConfig);
  const feedbackClient = new Anthropic();
  const actions = context.actions ?? [];

  const assignedTech = context.assignedTechName ?? null;
  const { ticketAgeHours, accountableBusinessHours, maxResponseGapHours } = eligibility;

  // Check if ticket is unassigned
  const techNameLower = assignedTech?.trim().toLowerCase() ?? "";
  const isUnassigned = !assignedTech || isNonTechAssignment(techNameLower);
  const assignmentGapDescription = assignedTech
    ? `assigned to **${assignedTech}**, who is not one of the helpdesk technicians`
    : "**UNASSIGNED** — no technician has been assigned";

  // Other STAFF on the ticket (dispatcher, second tech, manager) — the old
  // filter was "anyone who isn't the assigned tech", which listed the
  // CUSTOMER under "DISPATCHERS (do NOT review)"
  const dispatcherNames = actions
    .filter((a) => {
      if (!a.who) return false;
      const whoLower = a.who.toLowerCase();
      if (assignedTech && whoLower.includes(assignedTech.toLowerCase())) return false;
      return isInternalStaffName(whoLower) || whoLower.includes("gamma.tech") || whoLower.includes("gtmail");
    })
    .map((a) => a.who!)
    .filter((name, i, arr) => arr.indexOf(name) === i);

  // Count actions specifically from the assigned tech
  const assignedTechActions = assignedTech && !isUnassigned
    ? actions.filter((a) => a.who?.toLowerCase().includes(assignedTech.toLowerCase()))
    : [];

  const feedbackPrompt = isUnassigned
    ? [
        `You are Toby Flenderson, HR/analytics at Gamma Tech Services — honest, data-obsessed, standards-driven.`,
        `This ticket is ${assignmentGapDescription}. The dispatcher (Bryanna) is responsible for assigning tickets to technicians.`,
        ``,
        `## YOUR JOB`,
        `1. Flag that this ticket is not assigned to a helpdesk technician — this is a dispatch failure.`,
        `2. Note how long the customer has been waiting with no one assigned.`,
        `3. Suggest which type of tech should be assigned based on the ticket content.`,
        `4. Rate as "poor" if the ticket has lacked a technician for more than 1 business hour, "needs_improvement" otherwise.`,
        `5. In suggestions, always include: "Bryanna: assign this ticket to a tech immediately."`,
        ``,
        `## BUSINESS HOURS CONTEXT`,
        `- Business hours are **Mon-Fri, 8 AM - 5 PM Eastern** only.`,
        ``,
        `## FACTS`,
        `- This ticket is ${assignmentGapDescription}.`,
        `- Ticket has been open for **${ticketAgeHours.toFixed(1)} total hours**.`,
        `- **Dispatcher (Bryanna) must assign this ticket.**`,
        ``,
        `## Ticket: #${context.haloId} — ${context.summary}`,
        `Client: ${context.clientName ?? "Unknown"}`,
        `Type: ${classification.classification.type}/${classification.classification.subtype} | Urgency: ${classification.urgency_score}/5`,
        ``,
        `## Conversation History`,
        ...actions.map((a) => {
          const who = a.who ?? "Unknown";
          const when = a.date ?? "";
          const visibility = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
          return `- ${visibility} **${who}** (${when}): ${a.note}`;
        }),
        ``,
        `## Output — JSON only`,
        `{`,
        `  "rating": "great | good | needs_improvement | poor",`,
        `  "communication_score": 1-5,`,
        `  "response_time_assessment": "fast | adequate | slow | no_response",`,
        `  "max_response_gap_hours": number,`,
        `  "strengths": "what went well, or null",`,
        `  "improvement_areas": "be direct — what failed, or null",`,
        `  "suggestions": ["actionable, specific steps"],`,
        `  "summary": "2-3 sentences. Flag that no helpdesk technician owns the ticket. Call out Bryanna as dispatcher. Suggest the type of tech needed."`,
        `}`,
      ].filter(Boolean).join("\n")
    : [
    `You are Toby Flenderson, HR/analytics at Gamma Tech Services — the honest, data-obsessed reviewer of tech performance. You measure everyone against the same standards, you cite exact numbers, and you never soften a miss. You also never invent one: every claim must trace to the RESPONSE FACTS or the conversation history below.`,
    `Your job: evaluate how **${assignedTech ?? "the assigned technician"}** handled this ticket.`,
    ``,
    `## THE STANDARDS (what the rating is anchored to)`,
    `1. **RESPONSE SPEED IS THE BACKBONE.** A customer-visible reply within ${RESPONSE_STANDARD_BH} business hour of every customer message. The RESPONSE FACTS below are pre-computed in business hours — use those numbers verbatim, do not re-derive them.`,
    `2. **ARE we responding at all?** An unanswered customer message outweighs everything else. A customer waiting RIGHT NOW is the single most important fact in this review.`,
    `3. **CUSTOMER FRUSTRATION** — repeating themselves, escalating, chasing updates = red flag regardless of averages.`,
    `4. **HELPFULNESS** — is the tech moving the ticket forward or going through motions?`,
    ``,
    `## RATING ANCHORS (start here, adjust only with cause)`,
    `- Every customer message answered within ${RESPONSE_STANDARD_BH} business hr → start at "great"/"good".`,
    `- Any gap over 4 business hrs, or an unanswered message → at best "needs_improvement".`,
    `- Gap over 8 business hrs (a full business day), or zero tech engagement → "poor".`,
    `- Cite the exact gap numbers from RESPONSE FACTS in your summary and improvement_areas.`,
    ``,
    `## WRITE LIKE A MANAGER, NOT A CHATBOT`,
    `- NO praise sandwiches. If the verdict is a miss, LEAD with the miss. Do not open with what went well.`,
    `- Ban the filler: "however", "that said", "overall the intent is solid", "shows good judgment", "for a delivery perspective", "keep up the good work". Every sentence carries a fact or an instruction.`,
    `- strengths: only something genuinely worth repeating. "Responded politely" is not a strength — null it.`,
    `- improvement_areas: name the failure and its number. "No customer-visible reply for 3.2 business hrs after the Jul 8 message" — not "communication could be more proactive".`,
    `- suggestions: imperatives the tech does TODAY. "Reply to Lauren before 2 PM with the call outcome" — not "consider establishing a documentation habit".`,
    `- summary: max 2 sentences, verdict first, numbers in it. Nobody's feelings are your problem; wrong facts are.`,
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
    `- Business hours are **Mon-Fri, 8 AM - 5 PM Eastern** only.`,
    `- Response gaps are measured in **business hours only** — nights, weekends, and holidays do NOT count.`,
    `- A ticket opened at 9 PM won't start counting response time until 8 AM the next business day.`,
    `- The max_response_gap_hours below is already calculated in business hours.`,
    ``,
    `## WHAT TO CALL OUT HARD`,
    `- No response within 1 business hour = call it out.`,
    `- Customer waiting > 4 business hours with no update on urgent tickets = call it out.`,
    `- Customer waiting > 8 business hours (full business day) = POOR.`,
    `- Customer is visibly frustrated or repeating the same request = the tech is failing.`,
    `- Tech closed/resolved without actually fixing the issue = call it out.`,
    `- Tech gave a generic canned response that doesn't address the specific situation = call it out.`,
    `- Ticket resolved with no usable record of the action or outcome → at best NEEDS IMPROVEMENT. Use POOR only when the outcome is also unclear/failed, the customer was harmed, or the ticket shows a major response failure.`,
    `- A simple routine task only needs a concise issue/action/outcome note. Do not demand a runbook, Hudu update, or lengthy narrative for password resets, account unlocks, MFA resets, or similarly standard work.`,
    `- Hudu opportunities are not part of this tech-performance grade. Judge the response and handling shown on the ticket.`,
    `- Ticket was resolved then reopened with no explanation in the notes → flag it. Say: "This ticket was reopened after being resolved, but there's no note explaining why. What changed?"`,
    `- Tech is doing internal work but hasn't communicated with the customer at all → flag it even if work is happening. Say: "There's internal activity on this ticket but the customer hasn't been updated. Even a quick 'we're working on it' goes a long way."`,
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
    `## RESPONSE FACTS (pre-computed, business hours, customer-VISIBLE replies only)`,
    formatResponseFacts(eligibility.responseFacts),
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
    `  "summary": "MAX 2 sentences. Verdict first, then the number that drove it. Name the tech. No hedging, no praise padding."`,
    `}`,
  ].filter(Boolean).join("\n");

  const feedbackResponse = await feedbackClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 768,
    messages: [{ role: "user", content: feedbackPrompt }],
  });

  const feedbackText = extractResponseText(feedbackResponse);
  const rawFeedback = parseLlmJson<TechFeedback>(feedbackText);
  const feedback = isUnassigned
    ? rawFeedback
    : calibrateTechFeedback(
        rawFeedback,
        eligibility.responseFacts,
        assignedTech ?? "The assigned technician",
        accountableBusinessHours,
      );

  // Build the private coaching note — response facts rendered from the
  // deterministic timeline, not the LLM's restatement of it
  const facts = eligibility.responseFacts;
  const factsBits: string[] = [];
  factsBits.push(
    facts.firstResponseBh === null
      ? `1st reply: <strong style="color:#f87171;">none yet</strong>`
      : `1st reply: <strong style="color:${facts.firstResponseBh <= RESPONSE_STANDARD_BH ? "#4ade80" : "#f87171"};">${facts.firstResponseBh.toFixed(1)}h</strong>`,
  );
  if (facts.exchanges.length > 0) {
    factsBits.push(`answered: <strong style="color:${facts.unanswered === 0 ? "#4ade80" : "#f87171"};">${facts.answered}/${facts.exchanges.length}</strong>`);
    factsBits.push(`worst gap: <strong style="color:${maxResponseGapHours <= RESPONSE_STANDARD_BH ? "#4ade80" : maxResponseGapHours <= 4 ? "#fbbf24" : "#f87171"};">${maxResponseGapHours.toFixed(1)}h</strong>`);
  }
  if (facts.currentlyWaitingBh !== null) {
    factsBits.push(`<strong style="color:#f87171;">⚠ customer waiting ${facts.currentlyWaitingBh.toFixed(1)}h NOW</strong>`);
  }
  const responseFactsLine = `${factsBits.join(" · ")} <span style="color:#64748b;font-size:10px;">(business hrs · standard ${RESPONSE_STANDARD_BH}h)</span>`;

  const coachingNote = buildCoachingNote(feedback, maxResponseGapHours, ticketAgeHours, responseFactsLine);
  // postNote=false: the caller folds this HTML into the triage note as a
  // collapsed "Toby's Analysis" dropdown instead of a separate Halo note.
  if (postNote) await halo.addInternalNote(context.haloId, coachingNote);

  // Store in tech_reviews table for the Review tab
  await supabase.from("tech_reviews").upsert({
    ticket_id: context.ticketId,
    halo_id: context.haloId,
    tech_name: isUnassigned ? "UNASSIGNED" : (context.assignedTechName ?? null),
    rating: feedback.rating,
    communication_score: feedback.communication_score,
    response_time: feedback.response_time_assessment,
    max_gap_hours: feedback.max_response_gap_hours,
    strengths: feedback.strengths ?? null,
    improvement_areas: feedback.improvement_areas ?? null,
    suggestions: feedback.suggestions ?? [],
    summary: feedback.summary,
    created_at: new Date().toISOString(),
  }, { onConflict: "halo_id" });

  await supabase.from("agent_logs").insert({
    ticket_id: context.ticketId,
    agent_name: "toby_flenderson",
    agent_role: "analytics",
    status: "thinking",
    output_summary: `Tech review: ${feedback.rating} (${feedback.communication_score}/5 communication). ${feedback.summary}`,
  });

  return coachingNote;
}

// ── Coaching Note HTML Builder ───────────────────────────────────────

function buildCoachingNote(
  feedback: TechFeedback,
  _maxResponseGapHours: number,
  ticketAgeHours: number,
  responseFactsLine: string,
): string {
  const isBad = feedback.rating === "poor" || feedback.rating === "needs_improvement";
  const ratingEmoji = feedback.rating === "great" ? "🌟" : feedback.rating === "good" ? "👍" : feedback.rating === "needs_improvement" ? "📋" : "⚠️";
  // Header gradient tracks the verdict — it was always green, so a POOR
  // review looked like praise at a glance
  const headerGradient =
    feedback.rating === "great" ? "linear-gradient(135deg,#059669,#10b981)"
    : feedback.rating === "good" ? "linear-gradient(135deg,#1d4ed8,#3b82f6)"
    : feedback.rating === "needs_improvement" ? "linear-gradient(135deg,#b45309,#f59e0b)"
    : "linear-gradient(135deg,#991b1b,#dc2626)";
  // Clamp to 0-5 — an un-schema-checked LLM occasionally returns a score on a
  // 1-10 scale; String.repeat(negative) throws a RangeError that would abort
  // the whole review and lose both the coaching note and the tech_reviews row.
  const commScore = Math.max(0, Math.min(5, Math.round(Number(feedback.communication_score) || 0)));
  const commScoreBar = "█".repeat(commScore) + "░".repeat(5 - commScore);

  const suggestionsHtml = feedback.suggestions.length > 0
    ? `<ol style="margin:4px 0;padding-left:20px;">${feedback.suggestions.map((s) => `<li style="margin-bottom:4px;">${s}</li>`).join("")}</ol>`
    : "No specific suggestions.";

  // Single header band carries rating + comm score + response time — the
  // three dedicated rows they used to occupy are gone
  const header =
    `<tr><td style="padding:8px 12px;background:${headerGradient};color:white;font-size:13px;font-weight:700;">` +
    `${ratingEmoji} Toby's Tech Review — <span style="letter-spacing:0.03em;">${feedback.rating.replace(/_/g, " ").toUpperCase()}</span>` +
    `<span style="float:right;font-weight:500;font-size:11px;opacity:0.9;"><span style="font-family:monospace;">${commScoreBar}</span> ${commScore}/5 · ${feedback.response_time_assessment} · ${ticketAgeHours.toFixed(1)}h</span>` +
    `</td></tr>` +
    // Deterministic response-speed facts — the backbone of the verdict,
    // always visible regardless of rating
    `<tr style="background:#1E2028;"><td style="padding:6px 12px;border-bottom:1px solid #3a3f4b;font-size:11.5px;color:#cbd5e1;">${responseFactsLine}</td></tr>`;

  const gradingBasis =
    `<tr style="background:#1E2028;"><td style="padding:0;border-bottom:1px solid #3a3f4b;">` +
    `<details><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;">How this tech review was scored</summary>` +
    `<div style="padding:8px 12px;border-top:1px solid #3a3f4b;color:#cbd5e1;font-size:11.5px;line-height:1.55;">` +
    `<div><strong style="color:#93c5fd;">Measured by code:</strong> customer-visible reply gaps during Mon–Fri, 8 AM–5 PM ET. Nights and weekends do not count.</div>` +
    `<div style="margin-top:4px;"><strong style="color:#86efac;">Rating anchors:</strong> every reply within 1 business hour starts at Good/Great; a gap over 4 hours or an unanswered message caps the review at Needs Improvement; over 8 hours or no engagement is Poor.</div>` +
    `<div style="margin-top:4px;"><strong style="color:#fde68a;">AI judgment:</strong> the full action history is used for helpfulness, customer frustration, communication, and whether the work moved forward. Internal work is considered, but only visible replies stop the customer-response clock.</div>` +
    `<div style="margin-top:4px;"><strong style="color:#c4b5fd;">Not part of this grade:</strong> optional Hudu ideas and the length of notes for routine work.</div>` +
    `</div></details></td></tr>`;

  const strengthsRow = feedback.strengths
    ? `<div style="margin-bottom:7px;"><span style="color:#4ade80;font-weight:600;font-size:11px;">STRENGTHS</span><br/><span style="color:#bbf7d0;">${feedback.strengths}</span></div>`
    : "";
  const improveBlock = feedback.improvement_areas
    ? `<div style="margin-bottom:7px;"><span style="color:#fbbf24;font-weight:600;font-size:11px;">IMPROVE</span><br/><span style="color:#fde68a;">${feedback.improvement_areas}</span></div>`
    : "";
  const suggestionsBlock = `<div style="margin-bottom:7px;"><span style="color:#60a5fa;font-weight:600;font-size:11px;">SUGGESTIONS</span><br/><span style="color:#bfdbfe;">${suggestionsHtml}</span></div>`;
  const summaryBlock = `<div><span style="color:#94a3b8;font-weight:600;font-size:11px;">SUMMARY</span><br/><span style="color:#e2e8f0;">${feedback.summary}</span></div>`;

  let body: string;
  if (isBad) {
    // Bad review: the coaching (Improve + Suggestions) stays visible — that
    // IS the note. Strengths + full summary collapse.
    const visible =
      (feedback.improvement_areas ? `<tr style="background:#332b1a;"><td style="padding:7px 12px;border-bottom:1px solid #3a3f4b;font-size:12.5px;color:#fde68a;line-height:1.5;"><span style="color:#fbbf24;font-weight:700;font-size:11px;">IMPROVE — </span>${feedback.improvement_areas}</td></tr>` : "") +
      `<tr style="background:#1a2332;"><td style="padding:7px 12px;border-bottom:1px solid #3a3f4b;font-size:12.5px;color:#bfdbfe;line-height:1.5;"><span style="color:#60a5fa;font-weight:700;font-size:11px;">DO THIS — </span>${suggestionsHtml}</td></tr>`;
    const collapsed = [strengthsRow, summaryBlock].filter(Boolean).join("");
    body =
      visible +
      (collapsed
        ? `<tr style="background:#1E2028;"><td style="padding:0;border-bottom:1px solid #3a3f4b;"><details style="margin:0;"><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ Full review</summary><div style="padding:8px 12px;font-size:12px;line-height:1.5;border-top:1px solid #3a3f4b;">${collapsed}</div></details></td></tr>`
        : "");
  } else {
    // Good/great: one-line verdict visible, everything else collapsed —
    // a passing grade shouldn't take half the ticket
    const shortSummary = feedback.summary.length > 180
      ? `${feedback.summary.slice(0, 180).replace(/\s+\S*$/, "")}…`
      : feedback.summary;
    const collapsed = [strengthsRow, improveBlock, suggestionsBlock, summaryBlock].filter(Boolean).join("");
    body =
      `<tr style="background:#252830;"><td style="padding:7px 12px;border-bottom:1px solid #3a3f4b;font-size:12.5px;color:#cbd5e1;line-height:1.5;">${shortSummary}</td></tr>` +
      (collapsed
        ? `<tr style="background:#1E2028;"><td style="padding:0;border-bottom:1px solid #3a3f4b;"><details style="margin:0;"><summary style="cursor:pointer;padding:6px 12px;font-size:11.5px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ Full review — strengths, improvements &amp; suggestions</summary><div style="padding:8px 12px;font-size:12px;line-height:1.5;border-top:1px solid #3a3f4b;">${collapsed}</div></details></td></tr>`
        : "");
  }

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    header +
    gradingBasis +
    body +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9.5px;text-align:right;">Toby Flenderson · TriageIt AI · Employee Feedback · Private Note</td></tr>` +
    `</table>`
  );
}
