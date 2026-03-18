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

  private async sendCard(card: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.config.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Teams webhook failed (${response.status}): ${text}`);
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
            ],
          },
        },
      ],
    };

    await this.sendCard(card);
  }
}
