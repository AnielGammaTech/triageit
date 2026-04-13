import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig } from "@triageit/shared";
import { HaloClient } from "../../integrations/halo/client.js";
import type { TriageContext } from "../types.js";
import { getDispatcherName } from "../../db/staff.js";

// ── Types ────────────────────────────────────────────────────────────

interface DispatcherReview {
  readonly rating: "great" | "good" | "needs_improvement" | "poor";
  readonly assignmentTimeMinutes: number | null;
  readonly promiseKept: boolean | null;
  readonly promiseDetails: string | null;
  readonly unassignedDuringBusinessHours: boolean;
  readonly customerReplyHandled: boolean;
  readonly issues: string[];
  readonly summary: string;
}

// ── Constants ────────────────────────────────────────────────────────

const BUSINESS_START_HOUR = 7;
const BUSINESS_END_HOUR = 18;
const TIMEZONE = "America/New_York";

// Max acceptable time (in business minutes) to assign a ticket
const MAX_ASSIGNMENT_MINUTES = 30;

// ── Promise Detection ────────────────────────────────────────────────

// Patterns that indicate someone promised to contact the customer
const PROMISE_PATTERNS = [
  /(?:we(?:'ll| will)|i(?:'ll| will)|someone will|a tech will|our team will)\s+(?:contact|call|reach out|get back|follow up|respond|email|update|let you know)/i,
  /(?:contact|call|reach out|get back|follow up|respond)\s+(?:by|before|within|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  /(?:by|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  /(?:within|in)\s+(\d+)\s*(?:hour|hr|minute|min)/i,
  /(?:expect|expecting)\s+(?:a\s+)?(?:call|response|update|reply)/i,
  /(?:scheduled|schedule)\s+(?:a\s+)?(?:call|callback|follow.?up)/i,
  /(?:we'?re|i'?m)\s+(?:looking into|working on)\s+(?:this|it|the issue)/i,
  /(?:will|going to)\s+(?:have|get)\s+(?:someone|a tech|an engineer)/i,
];

// Patterns that extract a promised time
const TIME_PROMISE_PATTERNS = [
  /(?:by|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  /(?:within|in)\s+(\d+)\s*(?:hour|hr|minute|min)/i,
  /(?:around|approximately|about)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(?:today|tomorrow)/i,
];

// ── Business Hours Utilities ─────────────────────────────────────────

function isBusinessHours(date: Date): boolean {
  const etDate = new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const day = etDate.getDay();
  const hour = etDate.getHours();
  return day >= 1 && day <= 5 && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

function calculateBusinessMinutes(startTime: number, endTime: number): number {
  if (endTime <= startTime) return 0;

  let businessMs = 0;
  const STEP_MS = 60 * 1000; // 1-minute increments
  let cursor = startTime;

  while (cursor < endTime) {
    if (isBusinessHours(new Date(cursor))) {
      const stepEnd = Math.min(cursor + STEP_MS, endTime);
      businessMs += stepEnd - cursor;
    }
    cursor += STEP_MS;
  }

  return businessMs / (1000 * 60);
}

// ── Eligibility Check ────────────────────────────────────────────────

export function checkDispatcherReviewEligibility(
  context: TriageContext,
  ticketCreatedAt: string,
): boolean {
  const ticketAgeMs = Date.now() - new Date(ticketCreatedAt).getTime();
  const ticketAgeHours = ticketAgeMs / (1000 * 60 * 60);

  // Need at least 1 hour of ticket age
  if (ticketAgeHours < 1) return false;

  // Need ticket to have been created during business hours for assignment check
  // OR have actions to analyze for promise detection
  const actions = context.actions ?? [];
  const createdDuringBH = isBusinessHours(new Date(ticketCreatedAt));

  return createdDuringBH || actions.length > 0;
}

// ── Core Review Logic ────────────────────────────────────────────────

export function evaluateDispatcher(
  context: TriageContext,
  ticketCreatedAt: string,
  dispatcherName: string = "Bryanna",
): DispatcherReview {
  const actions = context.actions ?? [];
  const issues: string[] = [];
  const createdAt = new Date(ticketCreatedAt).getTime();

  // ── 1. Assignment Time Check ──────────────────────────────────────
  // How long did it take for the ticket to get assigned to a tech?
  const isAssigned = !!(context.assignedTechName) &&
    context.assignedTechName.toLowerCase() !== "unassigned";
  const createdDuringBH = isBusinessHours(new Date(ticketCreatedAt));

  let assignmentTimeMinutes: number | null = null;
  let unassignedDuringBusinessHours = false;

  if (!isAssigned && createdDuringBH) {
    // Ticket was created during business hours and STILL isn't assigned
    const businessMinutesSinceCreation = calculateBusinessMinutes(createdAt, Date.now());
    assignmentTimeMinutes = businessMinutesSinceCreation;
    unassignedDuringBusinessHours = true;

    if (businessMinutesSinceCreation > MAX_ASSIGNMENT_MINUTES) {
      issues.push(
        `Ticket created ${Math.round(businessMinutesSinceCreation)} business minutes ago during business hours but still unassigned.`,
      );
    }
  } else if (isAssigned) {
    // Find when the ticket was first assigned (look for first tech action or assignment)
    const firstTechAction = actions.find((a) => {
      if (!a.who || !a.date) return false;
      const whoLower = a.who.toLowerCase();
      return whoLower !== dispatcherName.toLowerCase() &&
        whoLower !== "system" &&
        whoLower !== "triageit" &&
        a.isInternal;
    });

    if (firstTechAction?.date) {
      const assignTime = new Date(firstTechAction.date).getTime();
      assignmentTimeMinutes = calculateBusinessMinutes(createdAt, assignTime);
    }
  }

  // ── 2. Promise Detection & Fulfillment ────────────────────────────
  let promiseKept: boolean | null = null;
  let promiseDetails: string | null = null;

  for (const action of actions) {
    if (!action.note || !action.date) continue;

    // Check if this action contains a promise
    const hasPromise = PROMISE_PATTERNS.some((p) => p.test(action.note));
    if (!hasPromise) continue;

    // Extract the promised time if available
    let promisedTimeStr: string | null = null;
    for (const pattern of TIME_PROMISE_PATTERNS) {
      const match = action.note.match(pattern);
      if (match) {
        promisedTimeStr = match[1];
        break;
      }
    }

    const promiseDate = new Date(action.date).getTime();

    // Check if anyone followed up after this promise
    const subsequentActions = actions.filter((a) => {
      if (!a.date) return false;
      const aTime = new Date(a.date).getTime();
      return aTime > promiseDate;
    });

    const techFollowedUp = subsequentActions.some((a) => {
      if (!a.who) return false;
      const whoLower = a.who.toLowerCase();
      return whoLower !== dispatcherName.toLowerCase() &&
        whoLower !== "system" &&
        whoLower !== "triageit";
    });

    const customerFollowedUp = subsequentActions.some((a) => !a.isInternal);

    // If customer followed up but no tech did — broken promise
    if (customerFollowedUp && !techFollowedUp) {
      promiseKept = false;
      const who = action.who ?? "Someone";
      promiseDetails = `${who} said "${extractPromiseQuote(action.note)}"${promisedTimeStr ? ` by ${promisedTimeStr}` : ""} but no tech followed up. Customer had to follow up instead.`;
      issues.push(promiseDetails);
    } else if (!techFollowedUp && !customerFollowedUp) {
      // Nobody followed up at all — check if enough time has passed
      const businessMinutesSince = calculateBusinessMinutes(promiseDate, Date.now());
      if (businessMinutesSince > 120) { // 2 business hours
        promiseKept = false;
        const who = action.who ?? "Someone";
        promiseDetails = `${who} promised "${extractPromiseQuote(action.note)}"${promisedTimeStr ? ` by ${promisedTimeStr}` : ""} but no follow-up has occurred in ${Math.round(businessMinutesSince)} business minutes.`;
        issues.push(promiseDetails);
      }
    } else if (techFollowedUp) {
      promiseKept = true;
      promiseDetails = "Promise was kept — tech followed up after commitment.";
    }

    // Only check the first promise found
    break;
  }

  // ── 3. Customer Reply Handling ────────────────────────────────────
  // When a customer replies, is Bryanna making sure someone handles it?
  let customerReplyHandled = true;

  const customerReplies = actions.filter((a) => !a.isInternal && a.date);
  for (const reply of customerReplies) {
    if (!reply.date) continue;
    const replyTime = new Date(reply.date).getTime();

    // Only check replies during business hours
    if (!isBusinessHours(new Date(reply.date))) continue;

    // Check if a tech responded within 2 business hours
    const techResponseAfter = actions.find((a) => {
      if (!a.date || !a.who) return false;
      const whoLower = a.who.toLowerCase();
      if (whoLower === dispatcherName.toLowerCase() || whoLower === "system") return false;
      const aTime = new Date(a.date).getTime();
      return aTime > replyTime && a.isInternal;
    });

    if (!techResponseAfter) {
      // Check how long it's been since the customer replied
      const minutesSince = calculateBusinessMinutes(replyTime, Date.now());
      if (minutesSince > 120) { // 2 business hours with no tech response
        customerReplyHandled = false;
        issues.push(
          `Customer replied ${Math.round(minutesSince)} business minutes ago but no tech has responded. Dispatcher should ensure someone picks this up.`,
        );
      }
    }
  }

  // ── 4. Calculate Rating ───────────────────────────────────────────
  let rating: "great" | "good" | "needs_improvement" | "poor";

  if (issues.length === 0) {
    rating = assignmentTimeMinutes !== null && assignmentTimeMinutes <= 15 ? "great" : "good";
  } else if (issues.length === 1 && !promiseKept === false) {
    rating = "needs_improvement";
  } else if (promiseKept === false || (unassignedDuringBusinessHours && assignmentTimeMinutes && assignmentTimeMinutes > 60)) {
    rating = "poor";
  } else {
    rating = "needs_improvement";
  }

  // ── 5. Build Summary ──────────────────────────────────────────────
  const summaryParts: string[] = [];

  if (unassignedDuringBusinessHours && assignmentTimeMinutes) {
    summaryParts.push(`Ticket has been unassigned for ${Math.round(assignmentTimeMinutes)} business minutes during business hours.`);
  } else if (assignmentTimeMinutes !== null && isAssigned) {
    summaryParts.push(`Ticket was assigned in ${Math.round(assignmentTimeMinutes)} business minutes.`);
  }

  if (promiseKept === false && promiseDetails) {
    summaryParts.push(promiseDetails);
  } else if (promiseKept === true) {
    summaryParts.push("Callback/contact promise was honored.");
  }

  if (!customerReplyHandled) {
    summaryParts.push("Customer reply went unhandled during business hours.");
  }

  if (issues.length === 0) {
    summaryParts.push("Dispatch handling looks good — ticket was routed promptly.");
  }

  return {
    rating,
    assignmentTimeMinutes,
    promiseKept,
    promiseDetails,
    unassignedDuringBusinessHours,
    customerReplyHandled,
    issues,
    summary: summaryParts.join(" "),
  };
}

// ── Generate & Post Dispatcher Review ────────────────────────────────

export async function generateDispatcherReview(
  context: TriageContext,
  ticketCreatedAt: string,
  haloConfig: HaloConfig,
  supabase: SupabaseClient,
): Promise<void> {
  const dispatcherName = await getDispatcherName(supabase);
  const review = evaluateDispatcher(context, ticketCreatedAt, dispatcherName);

  // Only post a Halo note for issues (don't spam "good" reviews)
  if (review.issues.length > 0) {
    const halo = new HaloClient(haloConfig);
    const note = buildDispatcherNote(review, context.haloId);
    await halo.addInternalNote(context.haloId, note);
  }

  // Store in DB (all ratings, for analytics)
  await supabase.from("dispatcher_reviews").insert({
    ticket_id: context.ticketId,
    halo_id: context.haloId,
    dispatcher_name: dispatcherName,
    rating: review.rating,
    assignment_time_minutes: review.assignmentTimeMinutes,
    promise_kept: review.promiseKept,
    promise_details: review.promiseDetails,
    unassigned_during_business_hours: review.unassignedDuringBusinessHours,
    customer_reply_handled: review.customerReplyHandled,
    issues: review.issues,
    summary: review.summary,
  });

  console.log(
    `[DISPATCH-REVIEW] #${context.haloId}: ${review.rating} — ${review.issues.length} issues`,
  );
}

// ── Halo Note Builder ────────────────────────────────────────────────

function buildDispatcherNote(review: DispatcherReview, _haloId: number): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const ratingColor = review.rating === "poor" ? "#f87171" : review.rating === "needs_improvement" ? "#fbbf24" : "#4ade80";
  const ratingEmoji = review.rating === "poor" ? "🔴" : review.rating === "needs_improvement" ? "🟡" : "🟢";

  const issueItems = review.issues
    .map((i) => `<li style="margin-bottom:4px;">${i}</li>`)
    .join("");

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;font-size:13px;font-weight:700;">📋 Dispatch Review — TriageIt</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:6px 12px;font-weight:600;width:80px;${border}font-size:12px;color:#94a3b8;">Rating</td><td style="padding:6px 12px;${border}font-size:13px;color:${ratingColor};font-weight:700;">${ratingEmoji} ${review.rating.replace("_", " ").toUpperCase()}</td></tr>` +
    (review.assignmentTimeMinutes !== null
      ? `<tr style="background:#1E2028;"><td style="padding:6px 12px;font-weight:600;width:80px;${border}font-size:12px;color:#94a3b8;">Assignment</td><td style="padding:6px 12px;${border}font-size:12px;color:#e2e8f0;">${review.unassignedDuringBusinessHours ? `⚠ Still unassigned after ${Math.round(review.assignmentTimeMinutes)} business minutes` : `Assigned in ${Math.round(review.assignmentTimeMinutes)} business minutes`}</td></tr>`
      : "") +
    (review.promiseKept !== null
      ? `<tr style="background:#252830;"><td style="padding:6px 12px;font-weight:600;width:80px;${border}font-size:12px;color:#94a3b8;">Promise</td><td style="padding:6px 12px;${border}font-size:12px;color:${review.promiseKept ? "#4ade80" : "#f87171"};">${review.promiseKept ? "✅ Kept" : "❌ Broken"} — ${review.promiseDetails ?? ""}</td></tr>`
      : "") +
    (review.issues.length > 0
      ? `<tr style="background:#1E2028;"><td style="padding:6px 12px;font-weight:600;width:80px;${border}font-size:12px;vertical-align:top;color:#fbbf24;">Issues</td><td style="padding:6px 12px;${border}font-size:12px;color:#fde68a;line-height:1.5;"><ul style="margin:0;padding-left:18px;">${issueItems}</ul></td></tr>`
      : "") +
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · dispatch review</td></tr>` +
    `</table>`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractPromiseQuote(note: string): string {
  // Extract the relevant sentence containing the promise
  const sentences = note.split(/[.!?]+/).filter(Boolean);
  for (const sentence of sentences) {
    if (PROMISE_PATTERNS.some((p) => p.test(sentence))) {
      return sentence.trim().substring(0, 100);
    }
  }
  return note.substring(0, 80);
}
