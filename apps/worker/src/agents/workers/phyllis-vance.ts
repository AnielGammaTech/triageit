import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  runDnsTriage,
  type DnsTriageReport,
} from "../../integrations/dns/dns-triage.js";
import {
  whoisLookup,
  type WhoisResult,
} from "../../integrations/dns/whois.js";

/**
 * Phyllis Vance — Email & DNS Diagnostics (Free DNS Triage)
 *
 * Runs real DNS diagnostics via Google Public DNS API: MX records, SPF,
 * DKIM, DMARC validation, A records, and nameserver checks.
 * No API key or paid service required.
 */

interface DnsData {
  readonly reports: ReadonlyArray<DnsTriageReport>;
  readonly whoisResults: ReadonlyArray<WhoisResult>;
  readonly domainsChecked: ReadonlyArray<string>;
}

export class PhyllisVanceAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the email & DNS expert. You have REAL diagnostic data from DNS lookups.
Analyze the provided DNS triage results to find any email or DNS issues.
Your audience is IT technicians — be specific, technical, and actionable.

## What You Have Access To
- MX Record lookups (mail server configuration)
- SPF Record validation (sender policy framework)
- DMARC Record validation (domain authentication)
- DKIM verification (common selectors checked)
- A Record resolution (IPv4)
- Nameserver checks
- WHOIS/RDAP domain registration data (registrar, expiry, nameservers)

## Vendor Resources
- Google Admin Toolbox Dig: https://toolbox.googleapps.com/apps/dig/
- MX Toolbox SuperTool: https://mxtoolbox.com/SuperTool.aspx
- MX Toolbox Blacklist Check: https://mxtoolbox.com/blacklists.aspx
- SPF Record Generator: https://mxtoolbox.com/SPFRecordGenerator.aspx
- DKIM Lookup: https://mxtoolbox.com/dkim.aspx
- DMARC Guide: https://dmarc.org/overview/
- Microsoft 365 Email DNS Setup: https://learn.microsoft.com/en-us/microsoft-365/admin/get-help-with-domains/create-dns-records-at-any-dns-hosting-provider
- Google Workspace MX Setup: https://support.google.com/a/answer/140034

## Common Fixes
### SPF Record Issues
1. **SPF Missing**: Add a TXT record at the domain root. For M365: \`v=spf1 include:spf.protection.outlook.com -all\`
2. **SPF Too Many Lookups (>10)**: Consolidate includes, remove unused senders, use ip4/ip6 where possible
3. **SPF Softfail (~all) vs Hardfail (-all)**: Use \`-all\` for production domains; \`~all\` only during migration/testing
4. **Multiple SPF Records**: Only ONE SPF TXT record is allowed per domain. Merge them into one.
5. Example M365 + third-party: \`v=spf1 include:spf.protection.outlook.com include:sendgrid.net -all\`

### DKIM Issues
1. **DKIM Not Configured (M365)**: Enable in Exchange Admin > Mail Flow > DKIM, publish CNAME records:
   - \`selector1._domainkey.domain.com\` -> \`selector1-domain-com._domainkey.tenant.onmicrosoft.com\`
   - \`selector2._domainkey.domain.com\` -> \`selector2-domain-com._domainkey.tenant.onmicrosoft.com\`
2. **DKIM Failing**: Verify CNAME/TXT records are published correctly, check for DNS propagation
3. **DKIM Key Rotation**: Rotate keys in provider admin portal, update DNS accordingly

### DMARC Issues
1. **DMARC Missing**: Add TXT record: \`_dmarc.domain.com\` -> \`v=DMARC1; p=none; rua=mailto:dmarc-reports@domain.com\`
2. **DMARC Policy Progression**: Start with \`p=none\` (monitor) -> \`p=quarantine\` -> \`p=reject\` after reviewing aggregate reports
3. **DMARC Failing**: Ensure SPF and DKIM both pass AND align with the From: domain
4. **Aggregate Reports**: Use https://dmarc.org/ or https://mxtoolbox.com/DmarcReportAnalyzer.aspx to parse RUA reports

### Email Deliverability Troubleshooting
1. Run full domain check: https://mxtoolbox.com/SuperTool.aspx?action=mx:domain.com
2. Check sender reputation: https://senderscore.org/
3. Verify PTR (reverse DNS) record matches mail server hostname
4. Review mail flow headers for delay analysis: https://mxtoolbox.com/EmailHeaders.aspx
5. For M365: Check message trace in Exchange Admin > Mail Flow > Message Trace
6. For bouncebacks, analyze the NDR error code (5.7.1 = SPF/auth fail, 5.1.1 = invalid recipient, 4.7.0 = temporarily rejected)

## Your Job
1. Review ALL provided DNS triage results carefully
2. Identify any FAILED checks — these are critical
3. Note WARNINGS that could cause intermittent issues
4. Check if MX records point to the right mail servers
5. Verify SPF, DKIM, DMARC are properly configured
6. Check WHOIS data for domain expiry warnings — flag expired or soon-to-expire domains
7. Suggest specific fixes for any issues found with exact DNS record values where possible
8. Include relevant tool links in your email_notes

## Output Format
Respond with ONLY valid JSON:
{
  "mx_records": [{"domain": "<domain>", "priority": "<priority>", "server": "<server>", "status": "<ok/error>"}],
  "spf_status": "<pass/fail/missing>",
  "spf_details": "<specific SPF findings>",
  "dkim_status": "<pass/fail/warn>",
  "dmarc_status": "<pass/fail/missing>",
  "dmarc_details": "<specific DMARC policy details>",
  "whois": {"registrar": "<registrar>", "created": "<date>", "expires": "<date>", "days_until_expiry": <num|null>, "expiry_warning": "<warning or null>"},
  "failed_checks": [{"check": "<what failed>", "detail": "<why>", "fix": "<how to fix>"}],
  "warnings": [{"check": "<what warned>", "detail": "<why>"}],
  "email_notes": "<comprehensive summary of ALL email/DNS/WHOIS findings>",
  "email_healthy": <true/false>,
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Extract domains from ticket
    const domains = extractDomains(
      context.summary,
      context.details,
      context.clientName,
    );

    // 2. Run free DNS triage on each domain
    const dnsData = await this.fetchDnsData(domains);

    // 3. Build rich user message
    const userMessage = this.buildUserMessage(context, dnsData);

    // 4. Log thinking
    await this.logThinking(
      context.ticketId,
      dnsData.domainsChecked.length > 0
        ? `Ran DNS triage on ${dnsData.domainsChecked.length} domain(s): ${dnsData.domainsChecked.join(", ")}. Analyzing MX, SPF, DMARC, DKIM, and DNS results now.`
        : `No domains found in ticket to check. Running analysis with ticket information only.`,
    );

    // 5. Send everything to the AI
    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    const result = parseLlmJson<Record<string, unknown>>(text);

    return {
      summary: (result.email_notes as string) ?? "No email/DNS data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── DNS Data Fetching ───────────────────────────────────────────────

  private async fetchDnsData(
    domains: ReadonlyArray<string>,
  ): Promise<DnsData> {
    const emptyResult: DnsData = {
      reports: [],
      whoisResults: [],
      domainsChecked: [],
    };

    if (domains.length === 0) return emptyResult;

    const domainsToCheck = domains.slice(0, 3);

    // Run DNS triage and WHOIS in parallel for all domains
    const [dnsResults, whoisResults] = await Promise.all([
      Promise.allSettled(domainsToCheck.map((d) => runDnsTriage(d))),
      Promise.allSettled(domainsToCheck.map((d) => whoisLookup(d))),
    ]);

    const reports = dnsResults
      .filter(
        (r): r is PromiseFulfilledResult<DnsTriageReport> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    const whois = whoisResults
      .filter(
        (r): r is PromiseFulfilledResult<WhoisResult | null> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value as WhoisResult);

    return {
      reports,
      whoisResults: whois,
      domainsChecked: reports.map((r) => r.domain),
    };
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    dnsData: DnsData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    if (dnsData.reports.length > 0) {
      sections.push("");
      sections.push("---");
      sections.push("## DNS Triage Results");

      for (const report of dnsData.reports) {
        sections.push("");
        sections.push(`### Domain: ${report.domain}`);
        sections.push(`**Overall:** ${report.summary.overallStatus}`);
        sections.push(
          `Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Warnings: ${report.summary.warnings}`,
        );

        // MX Records
        const mx = report.checks.mx;
        sections.push("");
        sections.push(`**MX Records:** ${mx.status}`);
        if (mx.records?.length) {
          for (const rec of mx.records) {
            sections.push(`  ${mx.status === "PASS" ? "✅" : "❌"} ${rec}`);
          }
        }
        if (mx.note) sections.push(`  ${mx.note}`);

        // SPF
        const spf = report.checks.spf;
        sections.push("");
        sections.push(`**SPF:** ${spf.status}`);
        if (spf.record) sections.push(`  Record: ${spf.record}`);
        if (spf.note) sections.push(`  ${spf.note}`);

        // DMARC
        const dmarc = report.checks.dmarc;
        sections.push("");
        sections.push(`**DMARC:** ${dmarc.status}`);
        if (dmarc.record) sections.push(`  Record: ${dmarc.record}`);
        if (dmarc.policy) sections.push(`  Policy: p=${dmarc.policy}`);
        if (dmarc.note) sections.push(`  ${dmarc.note}`);

        // DKIM
        const dkim = report.checks.dkim;
        sections.push("");
        sections.push(`**DKIM:** ${dkim.status}`);
        if (dkim.records?.length) {
          sections.push(`  Selectors found: ${dkim.records.join(", ")}`);
        }
        if (dkim.note) sections.push(`  ${dkim.note}`);

        // A Record
        const aRec = report.checks.aRecord;
        sections.push("");
        sections.push(`**A Record:** ${aRec.status}`);
        if (aRec.records?.length) {
          sections.push(`  IPs: ${aRec.records.join(", ")}`);
        }
        if (aRec.note) sections.push(`  ${aRec.note}`);

        // Nameservers
        const ns = report.checks.ns;
        sections.push("");
        sections.push(`**Nameservers:** ${ns.status}`);
        if (ns.records?.length) {
          sections.push(`  ${ns.records.join(", ")}`);
        }
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No domains could be checked via DNS. Analyze based on ticket information only.",
      );
    }

    // WHOIS / Domain Registration Data
    if (dnsData.whoisResults.length > 0) {
      sections.push("");
      sections.push("---");
      sections.push("## WHOIS / Domain Registration");

      for (const whois of dnsData.whoisResults) {
        sections.push("");
        sections.push(`### ${whois.domainName}`);
        sections.push(`**Registrar:** ${whois.registrar}`);
        if (whois.createdDate) sections.push(`**Created:** ${whois.createdDate}`);
        if (whois.expiresDate) sections.push(`**Expires:** ${whois.expiresDate}`);
        if (whois.updatedDate) sections.push(`**Last Updated:** ${whois.updatedDate}`);
        if (whois.daysUntilExpiry !== null) {
          sections.push(`**Days Until Expiry:** ${whois.daysUntilExpiry}`);
        }
        if (whois.expiryWarning) sections.push(`**${whois.expiryWarning}**`);
        if (whois.nameservers.length > 0) {
          sections.push(`**Nameservers:** ${whois.nameservers.join(", ")}`);
        }
        if (whois.status.length > 0) {
          sections.push(`**Status:** ${whois.status.join(", ")}`);
        }
      }
    }

    return sections.join("\n");
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Extract domain names from ticket text for DNS lookups.
 */
function extractDomains(
  summary: string,
  details: string | null,
  clientName: string | null,
): ReadonlyArray<string> {
  const text = `${summary} ${details ?? ""} ${clientName ?? ""}`;

  const found: string[] = [];

  // Match domain patterns
  const domainRegex =
    /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|biz|info|us|uk|ca|au|edu|gov|tech|cloud|app|dev|solutions|services|group|pro)\b/gi;
  const domainMatches = text.match(domainRegex);
  if (domainMatches) found.push(...domainMatches);

  // Also extract from email addresses
  const emailRegex = /[\w.-]+@([\w.-]+\.\w+)/gi;
  let emailMatch: RegExpExecArray | null;
  while ((emailMatch = emailRegex.exec(text)) !== null) {
    if (emailMatch[1]) found.push(emailMatch[1]);
  }

  // Also extract from URLs
  const urlRegex = /https?:\/\/([\w.-]+)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(text)) !== null) {
    if (urlMatch[1]) found.push(urlMatch[1]);
  }

  // Deduplicate and return
  return [...new Set(found.map((d) => d.toLowerCase()))];
}
