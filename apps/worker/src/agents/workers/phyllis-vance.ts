import type { MemoryMatch, MxToolboxConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  MxToolboxClient,
  type MxToolboxDomainHealth,
} from "../../integrations/mxtoolbox/client.js";

/**
 * Phyllis Vance — Email & DNS Diagnostics (MX Toolbox)
 *
 * Runs real MX Toolbox diagnostics: MX records, SPF, DKIM, DMARC
 * validation, blacklist checks, and SMTP tests.
 */

interface MxToolboxData {
  readonly domainResults: ReadonlyArray<MxToolboxDomainHealth>;
  readonly domainsChecked: ReadonlyArray<string>;
}

export class PhyllisVanceAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the email & DNS expert. You have REAL diagnostic data from MX Toolbox.
Analyze the provided MX Toolbox results to find any email or DNS issues.

## What You Have Access To
- MX Record lookups (mail server configuration)
- SPF Record validation (sender policy framework)
- DMARC Record validation (domain authentication)
- Blacklist checks (is the domain/IP blacklisted?)
- Pass/Fail/Warning results for each check

## Your Job
1. Review ALL provided MX Toolbox results carefully
2. Identify any FAILED checks — these are critical
3. Note WARNINGS that could cause intermittent issues
4. Check if MX records point to the right mail servers
5. Verify SPF, DKIM, DMARC are properly configured
6. Flag any blacklist hits immediately
7. Suggest specific fixes for any issues found

## Output Format
Respond with ONLY valid JSON:
{
  "mx_records": [{"domain": "<domain>", "priority": <num>, "server": "<server>", "status": "<ok/error>"}],
  "spf_status": "<pass/fail/missing>",
  "spf_details": "<specific SPF findings>",
  "dkim_status": "<pass/fail/missing>",
  "dmarc_status": "<pass/fail/missing>",
  "dmarc_details": "<specific DMARC policy details>",
  "blacklists": [{"list": "<name>", "status": "<clean/listed>"}],
  "failed_checks": [{"check": "<what failed>", "detail": "<why>", "fix": "<how to fix>"}],
  "warnings": [{"check": "<what warned>", "detail": "<why>"}],
  "email_notes": "<comprehensive summary of ALL email/DNS findings>",
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
    const domains = extractDomains(context.summary, context.details, context.clientName);

    // 2. Fetch real MX Toolbox data
    const mxData = await this.fetchMxToolboxData(domains);

    // 3. Build rich user message
    const userMessage = this.buildUserMessage(context, mxData);

    // 4. Log thinking
    await this.logThinking(
      context.ticketId,
      mxData.domainsChecked.length > 0
        ? `Ran MX Toolbox diagnostics on ${mxData.domainsChecked.length} domains: ${mxData.domainsChecked.join(", ")}. Analyzing MX, SPF, DMARC, and blacklist results now.`
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

  // ── MxToolbox Data Fetching ─────────────────────────────────────────

  private async fetchMxToolboxData(
    domains: ReadonlyArray<string>,
  ): Promise<MxToolboxData> {
    const emptyResult: MxToolboxData = {
      domainResults: [],
      domainsChecked: [],
    };

    if (domains.length === 0) return emptyResult;

    const config = await this.getMxToolboxConfig();
    if (!config) return emptyResult;

    const mxtoolbox = new MxToolboxClient(config);

    // Run full domain health check on each domain (max 3)
    const results = await Promise.allSettled(
      domains.slice(0, 3).map((domain) => mxtoolbox.fullDomainCheck(domain)),
    );

    const domainResults = results
      .filter(
        (r): r is PromiseFulfilledResult<MxToolboxDomainHealth> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    return {
      domainResults,
      domainsChecked: domainResults.map((r) => r.domain),
    };
  }

  private async getMxToolboxConfig(): Promise<MxToolboxConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "mxtoolbox")
      .eq("is_active", true)
      .single();

    return data ? (data.config as MxToolboxConfig) : null;
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    mxData: MxToolboxData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    if (mxData.domainResults.length > 0) {
      sections.push("");
      sections.push("---");
      sections.push("## MX Toolbox Diagnostic Results");

      for (const result of mxData.domainResults) {
        sections.push("");
        sections.push(`### Domain: ${result.domain}`);

        // MX Records
        if (result.mx) {
          sections.push("");
          sections.push("**MX Records:**");
          if (result.mx.Passed?.length) {
            for (const p of result.mx.Passed) {
              sections.push(`  ✅ ${p.Name ?? ""}: ${p.Info ?? ""}`);
            }
          }
          if (result.mx.Failed?.length) {
            for (const f of result.mx.Failed) {
              sections.push(`  ❌ FAILED: ${f.Name ?? ""}: ${f.Info ?? ""}`);
            }
          }
          if (result.mx.Warnings?.length) {
            for (const w of result.mx.Warnings) {
              sections.push(`  ⚠ WARNING: ${w.Name ?? ""}: ${w.Info ?? ""}`);
            }
          }
        }

        // SPF
        if (result.spf) {
          sections.push("");
          sections.push("**SPF Record:**");
          if (result.spf.Passed?.length) {
            for (const p of result.spf.Passed) {
              sections.push(`  ✅ ${p.Name ?? ""}: ${p.Info ?? ""}`);
            }
          }
          if (result.spf.Failed?.length) {
            for (const f of result.spf.Failed) {
              sections.push(`  ❌ FAILED: ${f.Name ?? ""}: ${f.Info ?? ""}`);
            }
          }
          if (result.spf.Warnings?.length) {
            for (const w of result.spf.Warnings) {
              sections.push(`  ⚠ WARNING: ${w.Name ?? ""}: ${w.Info ?? ""}`);
            }
          }
        }

        // DMARC
        if (result.dmarc) {
          sections.push("");
          sections.push("**DMARC Record:**");
          if (result.dmarc.Passed?.length) {
            for (const p of result.dmarc.Passed) {
              sections.push(`  ✅ ${p.Name ?? ""}: ${p.Info ?? ""}`);
            }
          }
          if (result.dmarc.Failed?.length) {
            for (const f of result.dmarc.Failed) {
              sections.push(`  ❌ FAILED: ${f.Name ?? ""}: ${f.Info ?? ""}`);
            }
          }
          if (result.dmarc.Warnings?.length) {
            for (const w of result.dmarc.Warnings) {
              sections.push(`  ⚠ WARNING: ${w.Name ?? ""}: ${w.Info ?? ""}`);
            }
          }
        }

        // Blacklist
        if (result.blacklist) {
          sections.push("");
          sections.push("**Blacklist Check:**");
          const failedCount = result.blacklist.Failed?.length ?? 0;
          if (failedCount > 0) {
            sections.push(`  🚨 LISTED ON ${failedCount} BLACKLISTS:`);
            for (const f of result.blacklist.Failed ?? []) {
              sections.push(`  ❌ ${f.Name ?? ""}: ${f.Info ?? ""}`);
            }
          } else {
            sections.push(`  ✅ Clean — not found on any blacklists`);
          }
        }
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No domains could be checked via MX Toolbox. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Extract domain names from ticket text for MX Toolbox lookups.
 */
function extractDomains(
  summary: string,
  details: string | null,
  clientName: string | null,
): ReadonlyArray<string> {
  const text = `${summary} ${details ?? ""} ${clientName ?? ""}`;

  const found: string[] = [];

  // Match domain patterns
  const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|biz|info|us|uk|ca|au|edu|gov|tech|cloud|app|dev|solutions|services|group|pro)\b/gi;
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
