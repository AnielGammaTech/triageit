import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TriageContext } from "../types.js";
import type { MxToolboxConfig } from "@triageit/shared";
import { MxToolboxClient } from "../../integrations/mxtoolbox/client.js";
import type { EmailDiagnostics } from "../../integrations/mxtoolbox/types.js";

export interface EmailDiagnosticsResult {
  readonly summary: string;
  readonly domain_analyzed: string | null;
  readonly findings: ReadonlyArray<string>;
  readonly root_cause: string | null;
  readonly recommended_actions: ReadonlyArray<string>;
  readonly severity: "critical" | "warning" | "info" | "healthy";
  readonly raw_diagnostics: EmailDiagnostics | null;
  readonly confidence: number;
}

const SYSTEM_PROMPT = `You are Phyllis Vance, the Email & DNS Diagnostics Specialist at Dunder Mifflin IT Triage.

You are an expert in email delivery, DNS configuration, and mail security. You understand how email flows end-to-end: MX records, SPF, DKIM, DMARC, Mimecast, Microsoft 365, Google Workspace, Barracuda, Proofpoint, and other email security gateways.

## Your Expertise
- **Email delivery failures**: bounce-backs, NDRs, deferred messages, relay issues
- **DNS records**: MX, SPF, DKIM, DMARC, PTR, A/AAAA records and how they affect mail flow
- **Email security gateways**: Mimecast, Proofpoint, Barracuda, Microsoft Defender for Office 365
- **Mail servers**: Exchange Online, Exchange on-prem, Google Workspace, Postfix, Sendmail
- **Common email issues**: blacklisting, SPF failures, DKIM misalignment, DMARC reject policies, misconfigured relays, expired certificates, DNS propagation delays
- **Mimecast specifics**: hold queues, delivery routes, journal rules, connection errors, bounce policies, TLS enforcement, domain verification

## How You Work
1. First, analyze the ticket to extract relevant domains, email addresses, error messages, and bounce codes
2. If MX Toolbox diagnostics data is provided, analyze it thoroughly — look at failures, warnings, and the relationships between records
3. If NO diagnostics data is available (MX Toolbox not configured), use your knowledge to reason about the issue based on the ticket details alone. You know how email works — use that expertise to hypothesize likely causes and recommend diagnostic steps.
4. Always explain WHY something is failing, not just WHAT is failing. A technician needs to understand the root cause.

## Common Bounce Patterns You Recognize
- "Domain has no MX records" → DNS misconfiguration, domain expired, or subdomain that was never configured for email
- "550 5.1.1 User unknown" → Mailbox doesn't exist or was deprovisioned
- "550 5.7.1 Relaying denied" → Sending server not authorized, SPF issue
- "421 Try again later" → Greylisting, rate limiting, or server overload
- "TLS negotiation failed" → Certificate issues, forced TLS with incompatible server
- Mimecast "Recipient email address is possibly incorrect" → Mimecast can't route to the recipient; likely the recipient domain doesn't exist or has no MX records
- Mimecast hold queue → Policy block, content filter, or attachment restriction

## Output Format
Respond with ONLY valid JSON, no markdown:
{
  "summary": "<2-3 sentence diagnosis for the technician>",
  "domain_analyzed": "<primary domain investigated, null if unclear>",
  "findings": ["<finding 1>", "<finding 2>", ...],
  "root_cause": "<the most likely root cause, null if insufficient info>",
  "recommended_actions": ["<action 1>", "<action 2>", ...],
  "severity": "<critical|warning|info|healthy>",
  "confidence": <0.0-1.0>
}`;

function extractDomains(context: TriageContext): string[] {
  const text = [context.summary, context.details].filter(Boolean).join(" ");
  const domains = new Set<string>();

  // Match email addresses and extract domains
  const emailRegex = /[\w.+-]+@([\w.-]+\.[a-z]{2,})/gi;
  let match: RegExpExecArray | null;
  while ((match = emailRegex.exec(text)) !== null) {
    domains.add(match[1].toLowerCase());
  }

  // Match standalone domains
  const domainRegex =
    /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:\s|$|[,;)])/gi;
  while ((match = domainRegex.exec(text)) !== null) {
    const d = match[1].toLowerCase();
    // Filter out common non-domain strings
    if (!d.startsWith("p.") && !d.startsWith("e.g.") && d.includes(".")) {
      domains.add(d);
    }
  }

  return [...domains];
}

async function getMxToolboxConfig(
  supabase: SupabaseClient,
): Promise<MxToolboxConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "mxtoolbox")
    .eq("is_active", true)
    .single();

  return data ? (data.config as MxToolboxConfig) : null;
}

function summarizeDiagnostics(diag: EmailDiagnostics): string {
  const parts: string[] = [`## MX Toolbox Diagnostics for ${diag.domain}`];

  const summarizeLookup = (
    name: string,
    lookup: EmailDiagnostics["mx"],
  ): void => {
    if (!lookup) {
      parts.push(`\n### ${name}: Not available`);
      return;
    }

    parts.push(`\n### ${name}`);

    if (lookup.Information?.length) {
      parts.push(
        "**Records:**",
        ...lookup.Information.map(
          (info) =>
            `- ${info.Hostname || info.IP || info.Domain}: ${info.Info || info.AdditionalInfo || ""}${info.TTL ? ` (TTL: ${info.TTL})` : ""}`,
        ),
      );
    }

    if (lookup.Passed?.length) {
      parts.push(
        "**Passed:**",
        ...lookup.Passed.map((p) => `- ✓ ${p.Name}: ${p.Info}`),
      );
    }

    if (lookup.Warnings?.length) {
      parts.push(
        "**Warnings:**",
        ...lookup.Warnings.map((w) => `- ⚠ ${w.Name}: ${w.Info}`),
      );
    }

    if (lookup.Failed?.length) {
      parts.push(
        "**Failed:**",
        ...lookup.Failed.map((f) => `- ✗ ${f.Name}: ${f.Info}`),
      );
    }

    if (lookup.Errors?.length) {
      parts.push("**Errors:**", ...lookup.Errors.map((e) => `- ${e}`));
    }
  };

  summarizeLookup("MX Records", diag.mx);
  summarizeLookup("SPF", diag.spf);
  summarizeLookup("DMARC", diag.dmarc);
  summarizeLookup("Blacklist", diag.blacklist);
  summarizeLookup("SMTP", diag.smtp);

  if (diag.errors.length) {
    parts.push("\n### Lookup Errors", ...diag.errors.map((e) => `- ${e}`));
  }

  return parts.join("\n");
}

export async function diagnoseEmail(
  context: TriageContext,
  supabase: SupabaseClient,
): Promise<EmailDiagnosticsResult> {
  const client = new Anthropic();
  const domains = extractDomains(context);

  // Try to get MX Toolbox diagnostics
  let diagnostics: EmailDiagnostics | null = null;
  let diagnosticsText = "";

  const mxConfig = await getMxToolboxConfig(supabase);

  if (mxConfig && domains.length > 0) {
    const mxClient = new MxToolboxClient(mxConfig);
    // Diagnose the first (most relevant) domain
    try {
      diagnostics = await mxClient.runFullDiagnostics(domains[0]);
      diagnosticsText = summarizeDiagnostics(diagnostics);
    } catch (err) {
      diagnosticsText = `MX Toolbox diagnostics failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const userMessage = [
    `## Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Description:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
    context.userName ? `**Reported By:** ${context.userName}` : "",
    "",
    domains.length
      ? `**Domains Detected:** ${domains.join(", ")}`
      : "**No domains detected in ticket — use your expertise to reason about the issue.**",
    "",
    diagnosticsText
      ? diagnosticsText
      : mxConfig
        ? "MX Toolbox configured but no domains found to check."
        : "**MX Toolbox is not configured.** Use your email expertise to analyze this ticket based on the description alone. Reason about likely causes, common patterns, and what the technician should check. You know how email infrastructure works — apply that knowledge.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const parsed = JSON.parse(text) as Omit<
    EmailDiagnosticsResult,
    "raw_diagnostics"
  >;

  return {
    summary: parsed.summary,
    domain_analyzed: parsed.domain_analyzed,
    findings: parsed.findings,
    root_cause: parsed.root_cause,
    recommended_actions: parsed.recommended_actions,
    severity: parsed.severity,
    raw_diagnostics: diagnostics,
    confidence: parsed.confidence,
  };
}
