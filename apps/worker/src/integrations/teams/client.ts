import type { TeamsConfig } from "@triageit/shared";

interface AdaptiveCardFact {
  readonly title: string;
  readonly value: string;
}

interface ReTriageTicket {
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly status: string;
  readonly flags: ReadonlyArray<string>;
  readonly recommendation: string;
  readonly daysOpen: number;
  readonly severity: "critical" | "warning" | "info";
}

interface DailySummary {
  readonly totalOpen: number;
  readonly scanned: number;
  readonly critical: ReadonlyArray<ReTriageTicket>;
  readonly warnings: ReadonlyArray<ReTriageTicket>;
  readonly processingTimeMs: number;
}

/**
 * Escalating tone. 1st notice = directive. Repeat alerts get serious, and
 * NO tech activity since the previous alert gets the hardest version
 * (user: "if it's a second alert since the last update, get more serious").
 */
function buildBreachHeadline(breach: {
  readonly haloId: number;
  readonly techName: string | null;
  readonly attempt?: number;
  readonly noUpdateSinceLastAlert?: boolean;
}): string {
  const attempt = breach.attempt ?? 1;
  const tech = breach.techName ?? "Unassigned";
  if (attempt <= 1) {
    return `🚨 ${tech} — ticket #${breach.haloId} is SLA BREACHED. Fix as soon as possible to prevent any negative feedback.`;
  }
  if (breach.noUpdateSinceLastAlert) {
    if (attempt === 2) {
      return `🔴 2nd ALERT — ${tech} has posted NO update on ticket #${breach.haloId} since the last alert. Still SLA breached. Drop what you're doing and handle this ticket or escalate it to management NOW.`;
    }
    return `🔴🔴 ${ordinal(attempt)} ALERT — ticket #${breach.haloId} STILL breached with ZERO movement from ${tech} after ${attempt - 1} alerts. This is now a management problem — Aniel/David, direct intervention needed.`;
  }
  return `🚨🚨 ${ordinal(attempt)} ALERT — ${tech}, ticket #${breach.haloId} has activity but is STILL SLA breached. Get it resolved or properly on hold NOW.`;
}

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * Business hours for real-time alerts: 8am–5pm ET, Monday–Friday. Every
 * reactive Teams alert (SLA breach, triage summary, response/update-request,
 * onsite, etc.) is suppressed outside this window — no more 11pm pings.
 * Scheduled digests (daily/weekly/Toby) bypass this via sendCard's allowAnytime.
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const hour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const day = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
  return hour >= 8 && hour < 17 && !["Sat", "Sun"].includes(day);
}

const FLAG_LABELS: Record<string, string> = {
  wot_overdue: "WOT > 24hrs",
  customer_waiting: "Customer waiting 24hrs+",
  sla_risk: "SLA at risk",
  stale: "Stale ticket",
  unassigned: "Unassigned",
  needs_escalation: "Needs escalation",
};

export class TeamsClient {
  constructor(private readonly config: TeamsConfig) {}

  /**
   * channel "ops" = everything (webhook_url).
   * channel "sla" = SLA breach alerts ONLY (sla_webhook_url when
   * configured, else falls back to the ops webhook so nothing is lost).
   */
  private async sendCard(card: Record<string, unknown>, channel: "ops" | "sla" = "ops", allowAnytime = false): Promise<void> {
    // Suppress reactive alerts outside 8am–5pm ET, Mon–Fri. Scheduled digests
    // pass allowAnytime=true so they still fire at their set times.
    if (!allowAnytime && !isWithinBusinessHours()) {
      console.log(`[TEAMS] Suppressed ${channel} alert — outside business hours (8am–5pm ET, Mon–Fri)`);
      return;
    }
    const url = channel === "sla" && this.config.sla_webhook_url ? this.config.sla_webhook_url : this.config.webhook_url;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Teams webhook (${channel}) failed (${response.status}): ${text}`);
    }
  }

  async sendDailySummary(summary: DailySummary): Promise<void> {
    const processingSeconds = (summary.processingTimeMs / 1000).toFixed(1);

    const criticalSection = summary.critical.length > 0
      ? summary.critical.map((t) => ({
          type: "Container",
          style: "attention",
          items: [
            {
              type: "TextBlock",
              text: `**#${t.haloId}** — ${t.summary}`,
              wrap: true,
              weight: "Bolder",
            },
            {
              type: "FactSet",
              facts: [
                { title: "Client", value: t.clientName ?? "Unknown" },
                { title: "Status", value: t.status },
                { title: "Days Open", value: String(t.daysOpen) },
                { title: "Flags", value: t.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ") },
              ],
            },
            {
              type: "TextBlock",
              text: t.recommendation,
              wrap: true,
              color: "Attention",
              size: "Small",
            },
          ],
        }))
      : [];

    const warningSection = summary.warnings.length > 0
      ? summary.warnings.map((t) => ({
          type: "Container",
          style: "warning",
          items: [
            {
              type: "TextBlock",
              text: `**#${t.haloId}** — ${t.summary}`,
              wrap: true,
            },
            {
              type: "FactSet",
              facts: [
                { title: "Client", value: t.clientName ?? "Unknown" },
                { title: "Status", value: t.status },
                { title: "Flags", value: t.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ") },
              ] as AdaptiveCardFact[],
            },
            {
              type: "TextBlock",
              text: t.recommendation,
              wrap: true,
              size: "Small",
            },
          ],
        }))
      : [];

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "TriageIt — Daily Re-Triage Summary",
                weight: "Bolder",
                size: "Large",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Open Tickets", value: String(summary.totalOpen) },
                  { title: "Critical", value: String(summary.critical.length) },
                  { title: "Warnings", value: String(summary.warnings.length) },
                  { title: "Scan Time", value: `${processingSeconds}s` },
                ],
              },
              ...(summary.critical.length > 0
                ? [
                    {
                      type: "TextBlock",
                      text: "CRITICAL — Immediate Action Required",
                      weight: "Bolder",
                      color: "Attention",
                      spacing: "Large",
                    },
                    ...criticalSection,
                  ]
                : []),
              ...(summary.warnings.length > 0
                ? [
                    {
                      type: "TextBlock",
                      text: "WARNINGS — Review Needed",
                      weight: "Bolder",
                      color: "Warning",
                      spacing: "Large",
                    },
                    ...warningSection,
                  ]
                : []),
              ...(summary.critical.length === 0 && summary.warnings.length === 0
                ? [
                    {
                      type: "TextBlock",
                      text: "All open tickets look good — no action needed.",
                      color: "Good",
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    };

    await this.sendCard(card, "ops", true);
  }

  async sendTriageSummary(triage: {
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly classification: string;
    readonly urgencyScore: number;
    readonly recommendedPriority: number;
    readonly recommendedTeam: string;
    readonly rootCause: string;
    readonly securityFlag: boolean;
    readonly escalationNeeded: boolean;
    readonly processingTimeMs: number;
    readonly agentCount: number;
  }): Promise<void> {
    const urgencyColor = triage.urgencyScore >= 4 ? "Attention" : triage.urgencyScore >= 3 ? "Warning" : "Default";
    const securityBadge = triage.securityFlag ? " | SECURITY" : "";
    const escalationBadge = triage.escalationNeeded ? " | ESCALATION" : "";

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: `TriageIt — New Triage Complete`,
                weight: "Bolder",
                size: "Large",
              },
              {
                type: "TextBlock",
                text: `**#${triage.haloId}** — ${triage.summary}`,
                wrap: true,
                weight: "Bolder",
                size: "Medium",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Client", value: triage.clientName ?? "Unknown" },
                  { title: "Classification", value: triage.classification },
                  { title: "Urgency", value: `${triage.urgencyScore}/5` },
                  { title: "Priority", value: `P${triage.recommendedPriority}` },
                  { title: "Team", value: triage.recommendedTeam },
                  { title: "Agents", value: `${triage.agentCount} specialists` },
                  { title: "Time", value: `${(triage.processingTimeMs / 1000).toFixed(1)}s` },
                ],
              },
              {
                type: "TextBlock",
                text: `**Root Cause:** ${triage.rootCause}`,
                wrap: true,
                color: urgencyColor,
              },
              ...(triage.securityFlag || triage.escalationNeeded
                ? [
                    {
                      type: "TextBlock",
                      text: `**FLAGS:**${securityBadge}${escalationBadge}`,
                      color: "Attention" as const,
                      weight: "Bolder" as const,
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }

  async sendTobyReport(result: {
    readonly techProfilesUpdated: number;
    readonly customerInsightsUpdated: number;
    readonly trendsDetected: number;
    readonly triagesEvaluated: number;
    readonly tokensUsed: number;
    readonly processingTimeMs: number;
    readonly summary: string;
  }): Promise<void> {
    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "TriageIt — Toby's Daily Learning Report",
                weight: "Bolder",
                size: "Large",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Tech Profiles", value: String(result.techProfilesUpdated) },
                  { title: "Customer Insights", value: String(result.customerInsightsUpdated) },
                  { title: "Trends Detected", value: String(result.trendsDetected) },
                  { title: "Triages Evaluated", value: String(result.triagesEvaluated) },
                  { title: "Tokens Used", value: String(result.tokensUsed) },
                  { title: "Processing Time", value: `${(result.processingTimeMs / 1000).toFixed(1)}s` },
                ],
              },
              {
                type: "TextBlock",
                text: result.summary,
                wrap: true,
                size: "Small",
              },
            ],
          },
        },
      ],
    };

    await this.sendCard(card, "ops", true);
  }

  async sendTechPerformanceSummary(reviews: ReadonlyArray<{
    readonly techName: string;
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly rating: string;
    readonly responseTime: string;
    readonly maxGapHours: number;
    readonly improvementAreas: string | null;
  }>): Promise<void> {
    if (reviews.length === 0) return;

    const poorReviews = reviews.filter((r) => r.rating === "poor" || r.rating === "needs_improvement");
    if (poorReviews.length === 0) return;

    const ratingColor = (rating: string) => {
      switch (rating) {
        case "poor": return "Attention";
        case "needs_improvement": return "Warning";
        default: return "Default";
      }
    };

    const reviewCards = poorReviews.map((r) => ({
      type: "Container",
      style: r.rating === "poor" ? "attention" : "warning",
      items: [
        {
          type: "TextBlock",
          text: `**${r.techName}** — #${r.haloId} ${r.summary}`,
          wrap: true,
          weight: "Bolder",
        },
        {
          type: "FactSet",
          facts: [
            { title: "Client", value: r.clientName ?? "Unknown" },
            { title: "Rating", value: r.rating.replace("_", " ").toUpperCase() },
            { title: "Response", value: r.responseTime },
            { title: "Max Gap", value: `${r.maxGapHours.toFixed(1)}h` },
          ],
        },
        ...(r.improvementAreas
          ? [
              {
                type: "TextBlock",
                text: r.improvementAreas,
                wrap: true,
                size: "Small",
                color: ratingColor(r.rating),
              },
            ]
          : []),
      ],
    }));

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "TriageIt — Tech Performance Concerns",
                weight: "Bolder",
                size: "Large",
                color: "Attention",
              },
              {
                type: "TextBlock",
                text: `${poorReviews.length} tech review(s) flagged for poor response or communication:`,
                wrap: true,
              },
              ...reviewCards,
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }

  async sendImmediateAlert(ticket: ReTriageTicket, reason: string): Promise<void> {
    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: `TriageIt ALERT — ${reason}`,
                weight: "Bolder",
                size: "Large",
                color: "Attention",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Ticket", value: `#${ticket.haloId}` },
                  { title: "Summary", value: ticket.summary },
                  { title: "Client", value: ticket.clientName ?? "Unknown" },
                  { title: "Status", value: ticket.status },
                  { title: "Days Open", value: String(ticket.daysOpen) },
                ],
              },
              {
                type: "TextBlock",
                text: ticket.recommendation,
                wrap: true,
                weight: "Bolder",
              },
              ...(ticket.flags.includes("customer_update_request") || ticket.flags.includes("customer_waiting")
                ? [
                    {
                      type: "TextBlock",
                      text: "Management and superiors have been notified. A private note has been posted to the assigned technician in Halo.",
                      wrap: true,
                      color: "Warning" as const,
                      size: "Small" as const,
                      spacing: "Small" as const,
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }

  /**
   * A ticket just crossed into SLA breach — one alert per breach, addressed
   * to management (Aniel & David) with the details they act on.
   */
  async sendSlaBreachAlert(breach: {
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly techName: string | null;
    readonly status: string | null;
    readonly hoursOver: number | null;
    readonly ticketUrl: string | null;
    /** 1 = first notice; 2+ = still breached an hour later, escalate the wording. */
    readonly attempt?: number;
    /** True when the ticket shows NO tech activity since the previous alert — hardest tone. */
    readonly noUpdateSinceLastAlert?: boolean;
  }): Promise<string> {
    const overText =
      breach.hoursOver != null
        ? breach.hoursOver >= 1
          ? `${breach.hoursOver.toFixed(1)} hours over`
          : `${Math.round(breach.hoursOver * 60)} minutes over`
        : "just breached";
    const info = [
      breach.summary,
      breach.clientName,
      breach.status ? `Status: ${breach.status}` : null,
      overText,
    ]
      .filter(Boolean)
      .join(" · ");
    const headline = buildBreachHeadline(breach);
    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            // 1.2 = maximum client compatibility — 1.4 rendered as
            // "cards.unsupported" in some Teams surfaces
            version: "1.2",
            body: [
              {
                type: "TextBlock",
                text: headline,
                weight: "Bolder",
                color: "Attention",
                wrap: true,
              },
              {
                type: "TextBlock",
                text: info,
                size: "Small",
                isSubtle: true,
                wrap: true,
                spacing: "Small",
              },
            ],
            ...(breach.ticketUrl
              ? {
                  actions: [
                    { type: "Action.OpenUrl", title: "Open in Halo", url: breach.ticketUrl },
                  ],
                }
              : {}),
          },
        },
      ],
    };
    await this.sendCard(card, "sla");
    // Return the composed message so callers can persist exactly what was sent
    // (surfaced on the SLA Hunter tab for accountability).
    return info ? `${headline}\n${info}` : headline;
  }

  /** Onsite visit evidence but zero charged hours — lost revenue tripwire. */
  async sendUnbilledOnsiteAlert(a: {
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly techName: string | null;
    readonly evidence: string;
  }): Promise<void> {
    await this.sendCard({
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: [
            { type: "TextBlock", text: `💸 UNBILLED ONSITE — ticket #${a.haloId} closed with onsite work but 0 charged hours.`, weight: "Bolder", color: "Attention", wrap: true },
            { type: "TextBlock", text: `${a.summary} · ${a.clientName ?? "?"} · ${a.techName ?? "unassigned"}`, size: "Small", isSubtle: true, wrap: true },
            { type: "TextBlock", text: `Evidence: ${a.evidence}`, size: "Small", wrap: true },
          ],
        },
      }],
    });
  }

  /**
   * Voicemail from a number we couldn't match to any ticket — without this
   * alert the message only lands in call_messages, which nobody watches.
   */
  async sendUnknownVoicemailAlert(msg: {
    readonly callerNumber: string;
    readonly transcript: string;
    readonly durationSeconds: number;
  }): Promise<void> {
    const prettyNumber = msg.callerNumber.replace(/^\+?1(?=\d{10}$)/, "");
    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "New phone message — caller not matched to a ticket",
                weight: "Bolder",
                size: "Large",
                color: "Warning",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Caller", value: prettyNumber },
                  { title: "Length", value: `${msg.durationSeconds}s` },
                ],
              },
              {
                type: "TextBlock",
                text: msg.transcript,
                wrap: true,
              },
              {
                type: "TextBlock",
                text: "Call the number back or create a ticket if this needs follow-up. Recorded on the TriageIt phone line.",
                wrap: true,
                size: "Small",
                color: "Accent",
              },
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }

  async sendResponseAlert(alert: {
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly techName: string | null;
    readonly hoursSinceReply: number;
    readonly isEscalation: boolean;
  }): Promise<void> {
    const color = alert.isEscalation ? "Attention" : "Warning";
    const header = alert.isEscalation
      ? `ESCALATION — Tech #${alert.haloId} No Response (${alert.hoursSinceReply}h)`
      : `WARNING — Tech #${alert.haloId} No Response (${alert.hoursSinceReply}h)`;

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: header, weight: "Bolder", size: "Large", color },
              {
                type: "FactSet",
                facts: [
                  { title: "Ticket", value: `#${alert.haloId}` },
                  { title: "Summary", value: alert.summary },
                  { title: "Client", value: alert.clientName ?? "Unknown" },
                  { title: "Assigned Tech", value: alert.techName ?? "UNASSIGNED" },
                  { title: "Waiting", value: `${alert.hoursSinceReply}h since customer reply` },
                ],
              },
              ...(alert.isEscalation
                ? [{ type: "TextBlock", text: "David — this ticket needs your attention. Customer has been waiting over 2 hours.", wrap: true, weight: "Bolder" as const, color: "Attention" as const }]
                : [{ type: "TextBlock", text: `${alert.techName ?? "Tech"} — please respond to this customer ASAP.`, wrap: true, weight: "Bolder" as const, color: "Warning" as const }]),
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }

  async sendWeeklyReport(report: {
    readonly weekOf: string;
    readonly totalTickets: number;
    readonly closedTickets: number;
    readonly avgResponseHours: number;
    readonly feedbackScore: number;
    readonly mvpName: string | null;
    readonly mvpReason: string | null;
    readonly techScores: ReadonlyArray<{
      readonly name: string;
      readonly ticketsHandled: number;
      readonly avgResponseHours: number;
      readonly rating: string;
      readonly trend: "improving" | "stable" | "declining";
    }>;
    readonly topIssues: ReadonlyArray<string>;
  }): Promise<void> {
    const trendIcon = (t: string) => t === "improving" ? "+" : t === "declining" ? "-" : "=";

    const techRows = report.techScores.map((t) => ({
      type: "ColumnSet",
      columns: [
        { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: t.name, weight: "Bolder" }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: String(t.ticketsHandled) }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: `${t.avgResponseHours.toFixed(1)}h` }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: t.rating }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: trendIcon(t.trend) }] },
      ],
    }));

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: `Weekly Team Report Card — Week of ${report.weekOf}`, weight: "Bolder", size: "Large", color: "Accent" },
              {
                type: "FactSet",
                facts: [
                  { title: "Tickets Opened", value: String(report.totalTickets) },
                  { title: "Tickets Closed", value: String(report.closedTickets) },
                  { title: "Avg Response", value: `${report.avgResponseHours}h` },
                  { title: "Triage Feedback", value: report.feedbackScore > 0 ? `${report.feedbackScore}% helpful` : "No feedback yet" },
                  ...(report.mvpName ? [{ title: "MVP", value: `${report.mvpName} — ${report.mvpReason ?? "Top performer"}` }] : []),
                ],
              },
              { type: "TextBlock", text: "Tech Scorecard", weight: "Bolder", size: "Medium", spacing: "Large" },
              {
                type: "ColumnSet",
                columns: [
                  { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: "Tech", weight: "Bolder", size: "Small" }] },
                  { type: "Column", width: "auto", items: [{ type: "TextBlock", text: "Tix", weight: "Bolder", size: "Small" }] },
                  { type: "Column", width: "auto", items: [{ type: "TextBlock", text: "Resp", weight: "Bolder", size: "Small" }] },
                  { type: "Column", width: "auto", items: [{ type: "TextBlock", text: "Rating", weight: "Bolder", size: "Small" }] },
                  { type: "Column", width: "auto", items: [{ type: "TextBlock", text: "Trend", weight: "Bolder", size: "Small" }] },
                ],
              },
              ...techRows,
              ...(report.topIssues.length > 0
                ? [
                    { type: "TextBlock", text: "Top Issues This Week", weight: "Bolder", size: "Medium", spacing: "Large" },
                    { type: "TextBlock", text: report.topIssues.join(", "), wrap: true, size: "Small" },
                  ]
                : []),
              { type: "TextBlock", text: "TriageIt AI — Weekly Report", size: "Small", isSubtle: true, spacing: "Large" },
            ],
          },
        },
      ],
    };

    await this.sendCard(card, "ops", true);
  }

  async sendPermanentFailureAlert(tickets: ReadonlyArray<{
    readonly haloId: number;
    readonly summary: string;
    readonly clientName: string | null;
    readonly errorMessage: string | null;
  }>): Promise<void> {
    const ticketItems = tickets.map((t) => ({
      type: "Container",
      style: "attention",
      items: [
        { type: "TextBlock", text: `#${t.haloId} — ${t.summary}`, weight: "Bolder", wrap: true },
        { type: "TextBlock", text: `Client: ${t.clientName ?? "Unknown"}`, size: "Small" },
        { type: "TextBlock", text: `Error: ${t.errorMessage ?? "Unknown error"}`, size: "Small", wrap: true, isSubtle: true },
      ],
    }));

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: `PERMANENT FAILURE — ${tickets.length} ticket(s) need manual intervention`, weight: "Bolder", size: "Large", color: "Attention" },
              { type: "TextBlock", text: "These tickets failed triage 3 times. Manual intervention required.", wrap: true },
              ...ticketItems,
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }
}
