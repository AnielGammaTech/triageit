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
    "dmarc",
    "dmarc report",
    "aggregate report",
    "phishing report",
    "submitter: google",
    "report-id:",
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
    "report-id:",
    "dmarc",
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

// ── Alert Expert — remediation + prevention advice ──────────────────────

const ALERT_EXPERT_PROMPT = `You are an MSP alert remediation expert. You receive an alert summary and must produce a detailed, actionable remediation plan that a tech can follow step by step.

## Your job:
1. **Explain** what this alert means in plain English — why did it trigger?
2. **Fix it** — step-by-step remediation with specific actions, console URLs, commands, or settings to check
3. **Prevent it** — what to change so this alert stops recurring (config change, policy update, scheduled task, etc.)
4. **Classify** — is this a one-off (fluke) or a pattern that needs a permanent fix?

## Rules:
- Be SPECIFIC to the alert source (Datto, Spanning, 3CX, SentinelOne, M365, etc.)
- Include actual console paths: "Datto RMM > Devices > [device] > Alerts" not just "check the console"
- If it's a backup failure, say which backup job and what to verify
- If it's a security alert, explain the risk level honestly
- Keep it under 300 words — techs won't read a novel
- ALL times in Eastern Time (ET)

## Output JSON:
{
  "what_happened": "<1-2 sentences explaining the alert in plain English>",
  "fix_steps": ["<step 1 with specific action>", "<step 2>", "<step 3>"],
  "prevent_recurrence": "<what to change so this doesn't happen again — be specific>",
  "is_recurring": <true if this type of alert tends to repeat, false if likely one-off>,
  "urgency": "<act_now | schedule | monitor — how urgent is the fix>",
  "console_url_hint": "<which console/portal to check, e.g. 'Datto RMM > Alerts' or 'M365 Admin > Service Health'>"
}`;

export interface AlertExpertResult {
  readonly what_happened: string;
  readonly fix_steps: ReadonlyArray<string>;
  readonly prevent_recurrence: string;
  readonly is_recurring: boolean;
  readonly urgency: string;
  readonly console_url_hint: string;
}

/**
 * Generate detailed remediation advice for an alert ticket.
 * Runs AFTER Erin's summary to provide actionable fix + prevention steps.
 */
export async function generateAlertRemediation(
  context: TriageContext,
  alertSummary: AlertResult,
): Promise<AlertExpertResult> {
  const client = new Anthropic();

  const userMessage = [
    `## Alert: ${alertSummary.alert_type}`,
    `**Source:** ${alertSummary.alert_source}`,
    `**Affected:** ${alertSummary.affected_resource}`,
    `**Severity:** ${alertSummary.severity}`,
    `**Summary:** ${alertSummary.summary}`,
    "",
    `## Original Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Full Description:** ${context.details.slice(0, 2000)}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
  ].filter(Boolean).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: ALERT_EXPERT_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";

  try {
    return parseLlmJson<AlertExpertResult>(text);
  } catch {
    return {
      what_happened: alertSummary.summary,
      fix_steps: [alertSummary.suggested_action],
      prevent_recurrence: "Review alert settings in the source console.",
      is_recurring: false,
      urgency: "schedule",
      console_url_hint: "",
    };
  }
}

/**
 * Build an HTML note for the alert remediation to post to Halo.
 */
export function buildAlertRemediationNote(
  alert: AlertResult,
  remediation: AlertExpertResult,
): string {
  const urgencyColors: Record<string, { bg: string; text: string }> = {
    act_now: { bg: "#7f1d1d", text: "#fca5a5" },
    schedule: { bg: "#78350f", text: "#fde68a" },
    monitor: { bg: "#1e3a5f", text: "#93c5fd" },
  };
  const uc = urgencyColors[remediation.urgency] ?? urgencyColors.monitor;

  const steps = remediation.fix_steps
    .map((s, i) => `<tr><td style="padding:4px 10px;color:#6366f1;font-weight:700;font-size:13px;vertical-align:top;">${i + 1}.</td><td style="padding:4px 10px;font-size:13px;color:#e2e8f0;line-height:1.5;">${s}</td></tr>`)
    .join("");

  return [
    `<table style="font-family:'Segoe UI',Roboto,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:6px;overflow:hidden;">`,
    `<tr><td colspan="2" style="padding:10px 14px;background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;font-size:14px;font-weight:700;">Alert Remediation — ${alert.alert_source}</td></tr>`,
    `<tr><td colspan="2" style="padding:8px 14px;background:${uc.bg};font-size:13px;color:${uc.text};font-weight:600;border-bottom:1px solid #3a3f4b;">${remediation.urgency.replace("_", " ").toUpperCase()} — ${remediation.what_happened}</td></tr>`,
    `<tr><td colspan="2" style="padding:6px 14px;font-size:11px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Source: ${alert.alert_source} | Affected: ${alert.affected_resource} | ${remediation.is_recurring ? "Recurring pattern" : "Likely one-off"}</td></tr>`,
    steps,
    `<tr><td colspan="2" style="padding:8px 14px;background:#064e3b15;border-top:1px solid #3a3f4b;"><span style="font-size:11px;font-weight:700;color:#34d399;">PREVENT:</span> <span style="font-size:12px;color:#a7f3d0;">${remediation.prevent_recurrence}</span></td></tr>`,
    remediation.console_url_hint ? `<tr><td colspan="2" style="padding:4px 14px;font-size:11px;color:#64748b;">Console: ${remediation.console_url_hint}</td></tr>` : "",
    `<tr><td colspan="2" style="padding:4px 14px;background:#1A1C22;text-align:right;font-size:10px;color:#475569;">TriageIt AI &middot; alert expert</td></tr>`,
    `</table>`,
  ].join("");
}
