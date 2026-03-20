import Anthropic from "@anthropic-ai/sdk";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Erin Hannon — Alert Specialist (The Receptionist)
 *
 * Handles automated alert tickets cheaply and quickly:
 * - Spanning backup failures/warnings
 * - 3CX IP blocked / trunk errors
 * - Datto RMM monitoring alerts
 * - System-generated security alerts
 * - Any ticket that looks like an automated alert
 *
 * Uses Haiku with a minimal prompt to produce a quick summary
 * instead of deploying expensive specialist agents.
 */

const ALERT_PROMPT = `You are a concise IT alert summarizer. You receive automated monitoring alerts forwarded as tickets.

Your job: produce a SHORT, actionable summary for the technician. No fluff.

## Rules
1. Identify the alert SOURCE (Spanning, 3CX, Datto, RocketCyber, SaaS Alerts, etc.)
2. Identify WHAT triggered the alert (backup failure, IP blocked, device offline, etc.)
3. State the AFFECTED resource (user, device, site, tenant)
4. Suggest a ONE-LINE action (check the portal, verify the device, whitelist the IP, etc.)
5. Determine if this is ACTIONABLE (tech needs to do something) or INFORMATIONAL (just FYI)

Respond with ONLY valid JSON:
{
  "alert_source": "<source system>",
  "alert_type": "<what triggered it>",
  "affected_resource": "<user, device, site, or tenant affected>",
  "severity": "<critical | warning | info>",
  "actionable": <true/false>,
  "suggested_action": "<one-line action for the tech>",
  "summary": "<1-2 sentence plain-English summary>"
}`;

export interface AlertResult {
  readonly alert_source: string;
  readonly alert_type: string;
  readonly affected_resource: string;
  readonly severity: string;
  readonly actionable: boolean;
  readonly suggested_action: string;
  readonly summary: string;
}

/**
 * Detect whether a ticket looks like an automated alert based on
 * subject + description keywords and patterns.
 */
export function isAlertTicket(
  summary: string,
  details: string | null,
  classType: string,
  subtype: string,
): boolean {
  const text = `${summary} ${details ?? ""} ${subtype}`.toLowerCase();

  // Direct alert source matches
  const alertSources = [
    "spanning",
    "3cx",
    "datto",
    "rocketcyber",
    "rocket cyber",
    "saas alerts",
    "saas alert",
    "unitrends",
    "cove backup",
    "n-able",
    "veeam",
    "barracuda",
    "sophos",
    "sentinel",
    "crowdstrike",
    "huntress",
    "watchguard",
    "fortinet",
    "fortigate",
    "meraki",
    "unifi",
    "backupiq",
    "backup iq",
    "client-alert",
    "phish911",
    "phishalarm",
  ];

  const hasAlertSource = alertSources.some((src) => text.includes(src));

  // Alert pattern keywords
  const alertPatterns = [
    "alert:",
    "alert -",
    "warning:",
    "critical:",
    "monitoring alert",
    "automated alert",
    "system alert",
    "backup fail",
    "backup error",
    "backup warning",
    "ip blocked",
    "ip block",
    "blocked ip",
    "device offline",
    "device down",
    "agent offline",
    "threshold exceeded",
    "disk space",
    "disk usage",
    "cpu usage",
    "memory usage",
    "certificate expir",
    "ssl expir",
    "license expir",
    "subscription expir",
    "patch failed",
    "update failed",
    "sync failed",
    "replication failed",
    "job failed",
    "task failed",
    "service stopped",
    "service down",
    "trunk registration",
    "trunk failed",
    "sip registration",
    "firewall block",
    "intrusion detect",
    "threat detect",
    "malware detect",
    "virus detect",
    "quarantine",
    "endpoint protection",
    "risk detection",
    "report domain:",
    "report domain",
    "phishing report",
    "submitter: google",
    "microsoft 365 alert",
    "o365 p2",
    "o365 p1",
  ];

  const hasAlertPattern = alertPatterns.some((pat) => text.includes(pat));

  // Email-forwarded alerts (common pattern: vendor sends alert email, gets forwarded as ticket)
  const emailAlertPatterns = [
    "do not reply",
    "noreply@",
    "no-reply@",
    "automated message",
    "this is an automated",
    "this alert was generated",
    "alert notification",
  ];

  const isEmailAlert = emailAlertPatterns.some((pat) => text.includes(pat));

  // Classification-based detection
  const alertClassTypes = ["backup", "security", "infrastructure", "endpoint"];
  const isAlertClassType = alertClassTypes.includes(classType);

  // Must match: (alert source OR alert pattern OR email alert) AND not a human-written ticket
  // Human tickets tend to have "please", "help", "can you", "I need"
  const humanIndicators = [
    "please help",
    "can you",
    "i need",
    "could you",
    "i'm having",
    "i am having",
    "we need",
    "we're having",
    "we are having",
    "is there a way",
    "how do i",
    "how can i",
  ];
  const looksHuman = humanIndicators.some((pat) => text.includes(pat));

  // Alert if: has source + pattern, or has alert pattern + alert class type
  // But NOT if it clearly looks human-written
  if (looksHuman) return false;

  // Strong alert signals — any one of these is enough on its own
  const strongPatterns = [
    "client-alert",
    "report domain:",
    "backupiq:",
    "phish911",
  ];
  const hasStrongSignal = strongPatterns.some((pat) => text.includes(pat));

  return (
    hasStrongSignal ||
    (hasAlertSource && hasAlertPattern) ||
    (hasAlertSource && isAlertClassType) ||
    (isEmailAlert && hasAlertPattern)
  );
}

/**
 * Summarize an alert ticket cheaply using Haiku.
 */
export async function summarizeAlert(
  context: TriageContext,
): Promise<AlertResult> {
  const client = new Anthropic();

  const userMessage = [
    `## Alert Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Description:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: ALERT_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";

  return parseLlmJson<AlertResult>(text);
}
