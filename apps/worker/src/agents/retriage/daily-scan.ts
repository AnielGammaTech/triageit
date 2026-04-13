import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloTicket, HaloAction, HaloConfig } from "@triageit/shared";
import { HaloClient } from "../../integrations/halo/client.js";
import { isUpdateRequest, handleUpdateRequest } from "./update-request.js";
import { isAlertTicket } from "../workers/erin-hannon.js";
import { parseLlmJson } from "../parse-json.js";
import { getStaffNames } from "../../db/staff.js";
import { getCachedHaloConfig } from "../../integrations/get-config.js";


interface ReTriageResult {
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly status: string;
  readonly assignedTech: string | null;
  readonly flags: ReadonlyArray<string>;
  readonly positives: ReadonlyArray<string>;
  readonly recommendation: string;
  readonly daysOpen: number;
  readonly lastActivity: string | null;
  readonly severity: "critical" | "warning" | "info";
}

interface DailyScanResult {
  readonly totalOpen: number;
  readonly scanned: number;
  readonly critical: ReadonlyArray<ReTriageResult>;
  readonly warnings: ReadonlyArray<ReTriageResult>;
  readonly info: ReadonlyArray<ReTriageResult>;
  readonly processingTimeMs: number;
  readonly tokensUsed: number;
}

const RETRIAGE_PROMPT = `You are Michael Scott, Regional Manager at Gamma Tech Services. You're reviewing an open support ticket to determine if the assigned technician is handling it properly.

You are the MANAGER. These are YOUR employees. You hold them to YOUR standards. Be honest, fair, but firm.

ALL times must be in Eastern Time (ET). Never use UTC.

## What You're Evaluating

1. **Customer Communication** — Has the tech communicated with the customer? If the customer is waiting and hasn't heard anything, that's a failure. Internal notes don't count — the CUSTOMER needs to know what's happening.

2. **Response Time** — How fast did the tech respond to the customer's messages? Over 1 hour during business hours is concerning. Over 4 hours is unacceptable for urgent tickets.

3. **Documentation** — Is the tech documenting their work? If the ticket gets resolved with no notes about what they did, that's a red flag. We need this for Hudu and for the team to learn.

4. **Progress** — Is the tech actually making progress, or just touching the ticket without advancing it? Look at the conversation — is the issue getting closer to resolution?

5. **Ticket Hygiene** — If the ticket was resolved and reopened, is there a reason? If it's been open for days with no movement, why?

## Your Judgment Calls

Use what you've learned from past tickets (your memories) to inform your assessment. If you've seen this tech handle similar tickets well before, note it. If they have a pattern of slow responses, call it out.

When you're not sure if something is acceptable, err on the side of flagging it. It's better to ask than to let a customer wait.

## Output Format
Respond with ONLY valid JSON:
{
  "flags": ["list any issues — use: customer_waiting_no_reply, no_documentation, slow_response, stale_no_progress, reopened_no_explanation, unassigned, sla_at_risk, closed_without_documentation"],
  "positives": ["list good behaviors — use: fast_response, good_communication, well_documented, proactive_followup, thorough_troubleshooting"],
  "severity": "critical|warning|info",
  "recommendation": "What should the tech do RIGHT NOW? Be specific and direct. Address the tech by name. Max 3 sentences.",
  "customer_impact": "How is the customer being affected? Is someone waiting? Is their business impacted?"
}`;

// Common Halo status ID → name map (fallback when API doesn't return status name)
const HALO_STATUS_MAP: Record<number, string> = {
  1: "New",
  2: "In Progress",
  3: "Waiting on Customer",
  4: "Customer Reply",
  5: "Scheduled",
  6: "On Hold",
  7: "Pending Vendor",
  8: "Waiting on Tech",
  9: "Closed",
  10: "Resolved",
  23: "In Progress",
  24: "Resolved Remotely",
  25: "Waiting on Parts",
  26: "Resolved Onsite",
  27: "Cancelled",
  29: "Waiting on Customer",
  30: "Waiting on Customer",
  32: "New",
};

/**
 * Extract the action date from a Halo action.
 * Halo returns `actiondatecreated` or `datetime` — NOT `datecreated` on the actions endpoint.
 */
function actionDate(a: HaloAction): string {
  return a.actiondatecreated ?? a.datetime ?? a.datecreated ?? "";
}

function getStatusName(ticket: HaloTicket): string {
  // Halo returns status name in various fields depending on includecolumns
  const raw = ticket as unknown as Record<string, unknown>;
  const name = (raw.statusname as string | undefined)
    ?? (raw.status_name as string | undefined)
    ?? ticket.status;

  if (name && typeof name === "string" && !name.startsWith("status_")) {
    return name;
  }

  return HALO_STATUS_MAP[ticket.status_id] ?? `Unknown (${ticket.status_id})`;
}

function daysBetween(date1: string | undefined | null, date2: string): number {
  if (!date1) return 0;
  const ms = new Date(date2).getTime() - new Date(date1).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function getLastActivity(actions: ReadonlyArray<HaloAction>): string | null {
  if (actions.length === 0) return null;
  const sorted = [...actions].sort(
    (a, b) =>
      new Date(actionDate(b)).getTime() -
      new Date(actionDate(a)).getTime(),
  );
  return sorted[0] ? actionDate(sorted[0]) || null : null;
}

function getLastCustomerReply(actions: ReadonlyArray<HaloAction>): string | null {
  const customerActions = actions.filter(
    (a) => !a.hiddenfromuser && a.who && !a.who.includes("TriageIt"),
  );
  if (customerActions.length === 0) return null;
  const sorted = [...customerActions].sort(
    (a, b) =>
      new Date(actionDate(b)).getTime() -
      new Date(actionDate(a)).getTime(),
  );
  return sorted[0] ? actionDate(sorted[0]) || null : null;
}

function getLastTechAction(actions: ReadonlyArray<HaloAction>): string | null {
  const techActions = actions.filter((a) => a.hiddenfromuser);
  if (techActions.length === 0) return null;
  const sorted = [...techActions].sort(
    (a, b) =>
      new Date(actionDate(b)).getTime() -
      new Date(actionDate(a)).getTime(),
  );
  return sorted[0] ? actionDate(sorted[0]) || null : null;
}

/**
 * Get the retriage interval in hours based on ticket urgency.
 * Critical tickets get checked more frequently.
 */
function getRetriageIntervalHours(urgencyScore: number | null): number {
  if (urgencyScore === null) return 3;
  if (urgencyScore >= 4) return 1;    // critical: every hour
  if (urgencyScore === 3) return 2;   // medium: every 2 hours
  return 3;                           // low: every 3 hours
}

/**
 * Get the last customer-facing activity timestamp.
 * Only visible replies count — internal notes do NOT reset the clock.
 * Falls back to ticket creation date if no customer-facing activity exists.
 */
function getLastCustomerFacingActivity(
  actions: ReadonlyArray<HaloAction>,
  ticketCreatedAt: string | undefined,
): string {
  const customerFacing = actions.filter(
    (a) => !a.hiddenfromuser && a.who && !a.who.toLowerCase().includes("triageit"),
  );

  if (customerFacing.length === 0) return ticketCreatedAt ?? new Date().toISOString();

  const sorted = [...customerFacing].sort(
    (a, b) =>
      new Date(actionDate(b)).getTime() -
      new Date(actionDate(a)).getTime(),
  );

  return (sorted[0] ? actionDate(sorted[0]) : null) ?? ticketCreatedAt ?? new Date().toISOString();
}

const POSITIVE_LABELS: Record<string, string> = {
  fast_response: "Fast response times",
  consistent_engagement: "Consistent engagement",
  well_documented: "Well documented",
  good_communication: "Good customer communication",
  proactive_followup: "Proactive follow-up",
  thorough_troubleshooting: "Thorough troubleshooting",
};

function getAgentName(ticket: HaloTicket): string | null {
  const raw = ticket as unknown as Record<string, unknown>;
  return (raw.agent_name as string | undefined) ?? null;
}

// Quick rule-based check before using AI (saves tokens)
function quickRuleCheck(
  ticket: HaloTicket,
  actions: ReadonlyArray<HaloAction>,
): ReTriageResult | null {
  const now = new Date().toISOString();
  const status = getStatusName(ticket);
  const statusLower = status.toLowerCase();
  const daysOpen = daysBetween(ticket.datecreated, now);
  const lastActivity = getLastActivity(actions);
  const assignedTech = getAgentName(ticket);
  const flags: string[] = [];
  let severity: "critical" | "warning" | "info" = "info";

  // WOT > 1 day
  if (statusLower.includes("waiting on tech")) {
    const lastChange = lastActivity ?? ticket.datecreated;
    const hoursInStatus =
      (Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60);
    if (hoursInStatus > 24) {
      flags.push("wot_overdue");
      severity = "critical";
    }
  }

  // Customer Reply > 1 day with no tech response
  if (statusLower.includes("customer reply")) {
    const lastCustomer = getLastCustomerReply(actions);
    if (lastCustomer) {
      const hoursSinceReply =
        (Date.now() - new Date(lastCustomer).getTime()) / (1000 * 60 * 60);
      if (hoursSinceReply > 24) {
        flags.push("customer_waiting");
        severity = "critical";
      }
    }
  }

  // Unassigned
  if (!ticket.agent_id) {
    flags.push("unassigned");
    if (severity === "info") severity = "warning";
  }

  // Stale — no activity in 3+ days
  if (lastActivity) {
    const daysSinceActivity = daysBetween(lastActivity, now);
    if (daysSinceActivity >= 3) {
      flags.push("stale");
      if (severity === "info") severity = "warning";
    }
  }

  // No tech notes — ticket has been open 1+ days but tech hasn't added any
  // internal notes (no documentation of what they've done)
  const techNotes = actions.filter((a) => a.hiddenfromuser && a.who && !a.who.toLowerCase().includes("triageit"));
  if (daysOpen >= 1 && techNotes.length === 0) {
    flags.push("no_tech_notes");
    if (severity === "info") severity = "warning";
  }

  // Long-running — open 7+ days with low tech activity (< 3 notes)
  if (daysOpen >= 7 && techNotes.length < 3) {
    flags.push("low_progress");
    if (severity === "info") severity = "warning";
  }

  // High priority aging — P1/P2 open more than 2 days
  if (ticket.priority_id && ticket.priority_id <= 2 && daysOpen >= 2) {
    flags.push("high_priority_aging");
    severity = "critical";
  }

  // SLA breach — response or fix target not met
  const responseBreached = (ticket as unknown as { responsetargetmet?: boolean }).responsetargetmet === false;
  const fixBreached = (ticket as unknown as { fixtargetmet?: boolean }).fixtargetmet === false;
  if (responseBreached || fixBreached) {
    flags.push("sla_breached");
    severity = "critical";
  }

  // ── Positive pattern detection ──────────────────────────────────────
  const positives: string[] = [];

  // Fast response — tech replied within 2 hours of customer replies
  const customerReplies = actions.filter(
    (a) => !a.hiddenfromuser && a.who && !a.who.toLowerCase().includes("triageit"),
  );
  if (customerReplies.length > 0 && techNotes.length > 0) {
    let fastResponses = 0;
    for (const cr of customerReplies) {
      const crTime = new Date(actionDate(cr)).getTime();
      // Find the next tech action after this customer reply
      const nextTechAction = techNotes.find(
        (t) => new Date(actionDate(t)).getTime() > crTime,
      );
      if (nextTechAction) {
        const responseHours =
          (new Date(actionDate(nextTechAction)).getTime() - crTime) / (1000 * 60 * 60);
        if (responseHours <= 2) fastResponses++;
      }
    }
    if (fastResponses > 0 && fastResponses >= customerReplies.length * 0.5) {
      positives.push("fast_response");
    }
  }

  // Consistent engagement — tech has 3+ actions spread across multiple days
  if (techNotes.length >= 3) {
    const techDays = new Set(
      techNotes.map((t) => new Date(actionDate(t)).toISOString().slice(0, 10)),
    );
    if (techDays.size >= 2) {
      positives.push("consistent_engagement");
    }
  }

  // Well documented — tech has internal notes with substantive content
  const substantiveNotes = techNotes.filter(
    (t) => t.note && t.note.length > 50,
  );
  if (substantiveNotes.length >= 2) {
    positives.push("well_documented");
  }

  // Good communication — tech has customer-visible replies
  const techVisibleReplies = actions.filter(
    (a) => !a.hiddenfromuser && a.who && a.hiddenfromuser === false &&
      techNotes.some((t) => t.who === a.who),
  );
  if (techVisibleReplies.length >= 2) {
    positives.push("good_communication");
  }

  // Nothing to report — no flags and no notable positives
  if (flags.length === 0 && positives.length === 0) return null;

  // If only positives and no problems, still return for the note
  if (flags.length === 0 && positives.length > 0) {
    return {
      haloId: ticket.id,
      summary: ticket.summary,
      clientName: ticket.client_name ?? null,
      status,
      assignedTech,
      flags: [],
      positives,
      recommendation: `Good work on this ticket${assignedTech ? ` by ${assignedTech}` : ""} — ${positives.map((p) => POSITIVE_LABELS[p] ?? p).join(", ")}.`,
      daysOpen,
      lastActivity,
      severity: "info",
    };
  }

  const techLabel = assignedTech ?? "The assigned tech";
  const recommendations: string[] = [];
  if (flags.includes("wot_overdue"))
    recommendations.push(`${techLabel} has not acted on this ticket for 24+ hours — needs immediate attention.`);
  if (flags.includes("customer_waiting"))
    recommendations.push(`Customer replied 24+ hours ago with no follow-up from ${techLabel} — respond ASAP.`);
  if (flags.includes("unassigned"))
    recommendations.push("Ticket is unassigned — dispatcher (Bryanna) needs to assign a technician immediately.");
  if (flags.includes("stale"))
    recommendations.push(`No activity from ${techLabel} for ${daysBetween(lastActivity!, now)} days — review and update.`);
  if (flags.includes("no_tech_notes"))
    recommendations.push(`${techLabel} has no internal notes — document what's been done and next steps.`);
  if (flags.includes("low_progress"))
    recommendations.push(`Open ${daysOpen} days with minimal activity from ${techLabel} (${techNotes.length} notes) — needs attention.`);
  if (flags.includes("high_priority_aging"))
    recommendations.push(`P${ticket.priority_id} ticket open ${daysOpen} days — ${techLabel} should escalate if blocked.`);
  if (flags.includes("sla_breached"))
    recommendations.push(`SLA BREACHED — ${techLabel} must take immediate action. Customer was promised a response/resolution time that has passed.`);

  // Acknowledge positives even when there are issues
  if (positives.length > 0) {
    recommendations.push(`Note: ${positives.map((p) => POSITIVE_LABELS[p] ?? p).join(", ")}.`);
  }

  return {
    haloId: ticket.id,
    summary: ticket.summary,
    clientName: ticket.client_name ?? null,
    status,
    assignedTech,
    flags,
    positives,
    recommendation: recommendations.join(" "),
    daysOpen,
    lastActivity,
    severity,
  };
}

/**
 * Ensure a local ticket record exists for a Halo ticket, then update
 * its tracking columns with live Halo data. Creates the record if the
 * ticket was opened directly in Halo (not via our webhook).
 */
async function upsertTicketFromHalo(
  supabase: SupabaseClient,
  ticket: HaloTicket,
  actions: ReadonlyArray<HaloAction>,
  halo?: HaloClient,
): Promise<string> {
  const now = new Date().toISOString();

  const agentName = halo
    ? await halo.resolveAgentName(getAgentName(ticket), ticket.agent_id)
    : getAgentName(ticket);

  const trackingData = {
    halo_status: getStatusName(ticket),
    halo_status_id: ticket.status_id,
    halo_team: ticket.team ?? null,
    halo_agent: agentName,
    // NOTE: Do NOT set last_retriage_at here — only set it when we actually post a retriage note.
    // Setting it on every scan pass prevents the timer from ever firing.
    last_customer_reply_at: getLastCustomerReply(actions),
    last_tech_action_at: getLastTechAction(actions),
    updated_at: now,
  };

  // Check if we already have this ticket locally
  const { data: existing } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", ticket.id)
    .single();

  if (existing) {
    await supabase
      .from("tickets")
      .update(trackingData)
      .eq("id", existing.id);
    return existing.id;
  }

  // Create a local record for this Halo ticket
  const { data: inserted } = await supabase
    .from("tickets")
    .insert({
      halo_id: ticket.id,
      summary: ticket.summary,
      details: ticket.details ?? null,
      client_name: ticket.client_name ?? null,
      client_id: ticket.client_id ?? null,
      user_name: ticket.user_name ?? null,
      original_priority: ticket.priority_id ?? null,
      status: "pending" as const,
      ...trackingData,
    })
    .select("id")
    .single();

  return inserted?.id ?? "";
}

/**
 * Build and post a retriage note to Halo so the tech sees the AI analysis.
 */
async function postReTriageNote(
  halo: HaloClient,
  haloId: number,
  result: ReTriageResult,
  supabase?: SupabaseClient,
): Promise<void> {
  // Dedup: if a full triage (not daily-scan) was posted within the last 10 minutes, skip
  if (supabase) {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: localTicket } = await supabase
      .from("tickets")
      .select("id")
      .eq("halo_id", haloId)
      .maybeSingle();

    if (localTicket) {
      const { data: recentTriage } = await supabase
        .from("triage_results")
        .select("created_at")
        .eq("ticket_id", localTicket.id)
        .gte("created_at", tenMinAgo)
        .is("triage_type", null)  // full triages have null triage_type; daily scan sets "retriage"
        .limit(1)
        .maybeSingle();

      if (recentTriage) {
        console.log(`[RETRIAGE] Skipping duplicate daily-scan note for #${haloId} — full triage posted at ${recentTriage.created_at}`);
        return;
      }
    }
  }
  const severityColors: Record<string, { bg: string; text: string; label: string }> = {
    critical: { bg: "#7f1d1d", text: "#fecaca", label: "🚨 CRITICAL" },
    warning: { bg: "#78350f", text: "#fef3c7", label: "⚠️ WARNING" },
    info: { bg: "#1e3a5f", text: "#bfdbfe", label: "ℹ️ INFO" },
  };

  const style = severityColors[result.severity] ?? severityColors.info;

  const flagBadges = result.flags
    .map((f) => `<span style="background:#374151;color:#d1d5db;padding:2px 6px;border-radius:3px;font-size:11px;margin-right:4px;">${f}</span>`)
    .join("");

  const positiveBadges = result.positives
    .map((p) => `<span style="background:#064e3b;color:#6ee7b7;padding:2px 6px;border-radius:3px;font-size:11px;margin-right:4px;">✓ ${POSITIVE_LABELS[p] ?? p}</span>`)
    .join("");

  const rows: string[] = [
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">`,
    `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Re-Triage Review<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">daily scan</span></td></tr>`,
    `<tr style="background:${style.bg};"><td colspan="2" style="padding:10px 14px;font-size:14px;color:${style.text};line-height:1.6;border-bottom:1px solid #3a3f4b;"><strong style="font-size:15px;">${style.label}</strong> — ${result.recommendation}</td></tr>`,
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Status</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${result.status} · Open ${result.daysOpen} day${result.daysOpen === 1 ? "" : "s"}</td></tr>`,
    result.assignedTech
      ? `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Assigned</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;font-weight:600;">${result.assignedTech}</td></tr>`
      : `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#f87171;">Assigned</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#f87171;font-weight:600;">UNASSIGNED</td></tr>`,
  ];

  if (flagBadges) {
    rows.push(
      `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#f87171;">Issues</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${flagBadges}</td></tr>`,
    );
  }

  if (positiveBadges) {
    rows.push(
      `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Good</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${positiveBadges}</td></tr>`,
    );
  }

  rows.push(
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · daily re-triage scan</td></tr>`,
    `</table>`,
  );

  const note = rows.join("");

  try {
    await halo.addInternalNote(haloId, note);
  } catch (err) {
    console.error(`[RETRIAGE] Failed to post note to Halo for #${haloId}:`, err);
  }
}

export async function runDailyScan(supabase: SupabaseClient): Promise<DailyScanResult> {
  const startTime = Date.now();
  let tokensUsed = 0;

  // Only run during business hours: Mon-Fri, 7 AM - 6 PM Eastern
  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = eastern.getHours();
  const day = eastern.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6 || hour < 7 || hour >= 18) {
    console.log(`[RETRIAGE] Outside business hours (${eastern.toLocaleString("en-US")} ET) — skipping scan`);
    return {
      totalOpen: 0, scanned: 0, critical: [], warnings: [], info: [],
      processingTimeMs: Date.now() - startTime, tokensUsed: 0,
    };
  }

  // Get Halo config (cached for 1 hour)
  const haloConfig = await getCachedHaloConfig(supabase);

  if (!haloConfig) {
    throw new Error("Halo PSA integration not configured or inactive");
  }

  const halo = new HaloClient(haloConfig);

  // Pull open tickets from Halo — only "Gamma Default" type (id=31)
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const openTickets = await halo.getOpenTickets(GAMMA_DEFAULT_TYPE_ID);

  const critical: ReTriageResult[] = [];
  const warnings: ReTriageResult[] = [];
  const info: ReTriageResult[] = [];

  const client = new Anthropic();
  const staffNames = await getStaffNames(supabase);

  // Batch pre-fetch: all local tickets for open Halo IDs (fixes N+1 queries)
  const haloIds = openTickets.map((t) => t.id);
  const { data: batchLocalTickets } = await supabase
    .from("tickets")
    .select("id, halo_id")
    .in("halo_id", haloIds);

  const localTicketMap = new Map(
    (batchLocalTickets ?? []).map((t: { id: string; halo_id: number }) => [t.halo_id, t.id]),
  );

  // Batch pre-fetch: latest triage result per local ticket
  const allLocalIds = [...localTicketMap.values()];
  const triageMap = new Map<string, { internal_notes: string | null; urgency_score: number | null; created_at: string | null }>();

  if (allLocalIds.length > 0) {
    const { data: triageResults } = await supabase
      .from("triage_results")
      .select("ticket_id, internal_notes, urgency_score, created_at")
      .in("ticket_id", allLocalIds)
      .order("created_at", { ascending: false });

    // Keep only the latest per ticket_id
    for (const tr of triageResults ?? []) {
      if (!triageMap.has(tr.ticket_id)) {
        triageMap.set(tr.ticket_id, {
          internal_notes: tr.internal_notes,
          urgency_score: tr.urgency_score,
          created_at: tr.created_at,
        });
      }
    }
  }

  for (const ticket of openTickets) {
    try {
      // Pull actions for this ticket
      const actions = await halo.getTicketActions(ticket.id);

      // Check if the latest CUSTOMER reply is an update request (skip staff messages)
      const latestCustomerAction = [...actions]
        .filter((a) => {
          if (a.hiddenfromuser || !a.note || !a.who) return false;
          const whoLower = (a.who ?? "").toLowerCase();
          if (staffNames.some((n) => whoLower.includes(n))) return false;
          if (whoLower.includes("gamma.tech") || whoLower.includes("gtmail") || whoLower.includes("triageit") || whoLower.includes("triggr")) return false;
          if (a.note.startsWith("<")) return false;
          return true;
        })
        .sort((a, b) => new Date(actionDate(b)).getTime() - new Date(actionDate(a)).getTime())[0];

      if (latestCustomerAction?.note && isUpdateRequest(latestCustomerAction.note)) {
        try {
          await handleUpdateRequest(ticket.id, latestCustomerAction.note, supabase);
          console.log(`[RETRIAGE] Detected update request in ticket #${ticket.id}`);
        } catch (err) {
          console.error(`[RETRIAGE] Failed to handle update request for #${ticket.id}:`, err);
        }
      }

      // Skip alert tickets — they were triaged cheaply and don't need re-review
      const isAlert = isAlertTicket(
        ticket.summary,
        ticket.details ?? null,
        "",  // no classification type available here
        "",
      );
      if (isAlert) {
        // Still upsert tracking data so we have fresh status info
        await upsertTicketFromHalo(supabase, ticket, actions, halo);
        continue;
      }

      // Also skip if this ticket was previously triaged via alert/notification fast path
      const cachedLocalId = localTicketMap.get(ticket.id) ?? null;
      const cachedTriage = cachedLocalId ? triageMap.get(cachedLocalId) ?? null : null;

      if (cachedTriage?.internal_notes) {
        const notes = cachedTriage.internal_notes;
        if (
          notes.startsWith("Alert:") ||
          notes === "Notification/transactional ticket — no action required."
        ) {
          await upsertTicketFromHalo(supabase, ticket, actions, halo);
          continue;
        }
      }

      // If the list API didn't return agent data, fetch the individual ticket
      // to get accurate assignment info before running checks
      let enrichedTicket = ticket;
      if (!ticket.agent_id && !getAgentName(ticket)) {
        try {
          const full = await halo.getTicket(ticket.id);
          enrichedTicket = full;
        } catch {
          // Non-critical — proceed with list data
        }
      }

      // Resolve agent name from agent_id if agent_name is missing
      // (Halo list API often returns agent_id but not agent_name)
      if (!getAgentName(enrichedTicket) && enrichedTicket.agent_id) {
        const resolvedName = await halo.resolveAgentName(null, enrichedTicket.agent_id);
        if (resolvedName) {
          enrichedTicket = { ...enrichedTicket, agent_name: resolvedName } as typeof enrichedTicket;
        }
      }

      // ── Urgency-based timer check ──
      // Look up the last triage's urgency score from pre-fetched maps
      const localIdForUrgency = localTicketMap.get(enrichedTicket.id) ?? null;
      const latestTriage = localIdForUrgency ? triageMap.get(localIdForUrgency) ?? null : null;
      const urgencyScore: number | null = (latestTriage?.urgency_score as number) ?? null;
      const lastTriageAt: string | null = (latestTriage?.created_at as string) ?? null;

      const intervalHours = getRetriageIntervalHours(urgencyScore);

      // Check both: time since last customer-facing activity AND time since last triage
      // Use whichever is MORE RECENT (don't retriage if we just triaged)
      const lastCustomerFacing = getLastCustomerFacingActivity(actions, enrichedTicket.datecreated);
      const customerFacingTime = new Date(lastCustomerFacing).getTime();
      const lastTriageTime = lastTriageAt ? new Date(lastTriageAt).getTime() : 0;
      const mostRecentEvent = Math.max(customerFacingTime, lastTriageTime);
      const hoursSinceMostRecent = (Date.now() - mostRecentEvent) / (1000 * 60 * 60);

      // Skip if timer hasn't expired since the most recent event
      if (hoursSinceMostRecent < intervalHours) {
        await upsertTicketFromHalo(supabase, enrichedTicket, actions, halo);
        continue;
      }

      console.log(`[RETRIAGE] Timer expired for #${enrichedTicket.id}: ${hoursSinceMostRecent.toFixed(1)}h since last event (interval: ${intervalHours}h, urgency: ${urgencyScore ?? "unknown"})`);

      // Quick rule-based check first (free, no tokens)
      const ruleResult = quickRuleCheck(enrichedTicket, actions);
      if (ruleResult) {
        if (ruleResult.severity === "critical") critical.push(ruleResult);
        else if (ruleResult.severity === "warning") warnings.push(ruleResult);
        else info.push(ruleResult);

        // Upsert ticket tracking in Supabase (creates record if ticket only exists in Halo)
        const ruleTicketId = await upsertTicketFromHalo(supabase, enrichedTicket, actions, halo);

        // Post note to Halo and flag for manager review
        if (ruleResult.severity === "critical" || ruleResult.severity === "warning") {
          await postReTriageNote(halo, enrichedTicket.id, ruleResult, supabase);

          if (ruleTicketId) {
            await supabase
              .from("tickets")
              .update({
                status: "needs_review",
                last_retriage_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", ruleTicketId);
          }
        } else if (ruleTicketId) {
          // Even for info-level results, mark that we actually reviewed it
          await supabase
            .from("tickets")
            .update({ last_retriage_at: new Date().toISOString() })
            .eq("id", ruleTicketId);
        }

        continue;
      }

      // For non-obvious tickets, use Haiku for a quick assessment
      const now = new Date().toISOString();
      const daysOpen = daysBetween(enrichedTicket.datecreated, now);
      const lastActivity = getLastActivity(actions);
      const status = getStatusName(enrichedTicket);

      const assignedTech = getAgentName(enrichedTicket);

      const contextMessage = [
        `Ticket #${enrichedTicket.id}: ${enrichedTicket.summary}`,
        `Client: ${enrichedTicket.client_name ?? "Unknown"}`,
        `Status: ${status}`,
        `Priority: ${enrichedTicket.priority ?? "Unknown"}`,
        `Team: ${enrichedTicket.team ?? "Unassigned"}`,
        `Assigned Tech: ${assignedTech ?? "UNASSIGNED"}`,
        `Created: ${enrichedTicket.datecreated} (${daysOpen} days ago)`,
        `Last Activity: ${lastActivity ?? "None"}`,
        "",
        `Recent Actions (last 10):`,
        ...actions.slice(0, 10).map(
          (a) =>
            `  [${actionDate(a) || "?"}] ${a.hiddenfromuser ? "(internal)" : "(customer-visible)"} ${a.who ?? "unknown"}: ${a.note?.substring(0, 200) ?? ""}`,
        ),
      ].join("\n");

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: RETRIAGE_PROMPT,
        messages: [{ role: "user", content: contextMessage }],
      });

      tokensUsed += response.usage.input_tokens + response.usage.output_tokens;

      const text =
        response.content[0].type === "text" ? response.content[0].text : "{}";
      const parsed = parseLlmJson<{
        flags: string[];
        positives?: string[];
        severity: "critical" | "warning" | "info";
        recommendation: string;
      }>(text);

      const result: ReTriageResult = {
        haloId: enrichedTicket.id,
        summary: enrichedTicket.summary,
        clientName: enrichedTicket.client_name ?? null,
        status,
        assignedTech,
        flags: parsed.flags,
        positives: parsed.positives ?? [],
        recommendation: parsed.recommendation,
        daysOpen,
        lastActivity,
        severity: parsed.severity,
      };

      if (parsed.severity === "critical") critical.push(result);
      else if (parsed.severity === "warning") warnings.push(result);
      else info.push(result);

      // Upsert ticket tracking (creates record if ticket only exists in Halo)
      const localTicketId = await upsertTicketFromHalo(supabase, enrichedTicket, actions, halo);

      if (localTicketId) {
        await supabase.from("triage_results").insert({
          id: crypto.randomUUID(),
          ticket_id: localTicketId,
          classification: { type: "retriage", subtype: parsed.severity },
          urgency_score: parsed.severity === "critical" ? 5 : parsed.severity === "warning" ? 3 : 1,
          urgency_reasoning: parsed.recommendation,
          recommended_priority: parsed.severity === "critical" ? 1 : parsed.severity === "warning" ? 3 : 5,
          recommended_team: enrichedTicket.team ?? "General",
          security_flag: false,
          findings: { daily_scan: { flags: parsed.flags, positives: parsed.positives ?? [], recommendation: parsed.recommendation } },
          internal_notes: parsed.recommendation,
          processing_time_ms: Date.now() - startTime,
          model_tokens_used: { manager: 0, workers: { daily_scan: tokensUsed } },
          triage_type: "retriage",
        });

        // Post note to Halo and flag for manager review
        if (parsed.severity === "critical" || parsed.severity === "warning") {
          await postReTriageNote(halo, enrichedTicket.id, result, supabase);

          await supabase
            .from("tickets")
            .update({
              status: "needs_review",
              last_retriage_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", localTicketId);
        } else {
          // Mark that we reviewed it even if no issues found
          await supabase
            .from("tickets")
            .update({ last_retriage_at: new Date().toISOString() })
            .eq("id", localTicketId);
        }
      }
    } catch (err) {
      console.error(`[RETRIAGE] Error scanning ticket #${ticket.id}:`, err);
    }
  }

  const processingTime = Date.now() - startTime;

  // Log the daily scan (use first ticket as reference, or skip if no tickets)
  if (openTickets.length > 0) {
    const { data: refTicket } = await supabase
      .from("tickets")
      .select("id")
      .eq("halo_id", openTickets[0].id)
      .single();

    if (refTicket) {
      await supabase.from("agent_logs").insert({
        ticket_id: refTicket.id,
        agent_name: "daily_scan",
        agent_role: "retriage",
        status: "completed",
        output_summary: `Scanned ${openTickets.length} tickets: ${critical.length} critical, ${warnings.length} warnings, ${info.length} info`,
        tokens_used: tokensUsed,
        duration_ms: processingTime,
      });
    }
  }

  return {
    totalOpen: openTickets.length,
    scanned: openTickets.length,
    critical,
    warnings,
    info,
    processingTimeMs: processingTime,
    tokensUsed,
  };
}
