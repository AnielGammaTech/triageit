import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Phyllis Vance — Email & DNS Diagnostics (MX Toolbox)
 *
 * Runs MX Toolbox diagnostics for email-related tickets:
 * MX records, SPF, DKIM, DMARC validation, blacklist checks.
 */
export class PhyllisVanceAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Analyze email and DNS configurations relevant to the reported issue.

## What to Check
- MX record configuration and validity
- SPF record analysis
- DKIM signatures and selectors
- DMARC policy and alignment
- Blacklist status across major RBLs
- SMTP connectivity and TLS
- DNS propagation issues

## Output Format
Respond with ONLY valid JSON:
{
  "mx_records": [{"domain": "<domain>", "priority": <num>, "server": "<server>", "status": "<ok/error>"}],
  "spf_status": "<pass/fail/missing>",
  "dkim_status": "<pass/fail/missing>",
  "dmarc_status": "<pass/fail/missing>",
  "blacklists": [{"list": "<name>", "status": "<clean/listed>"}],
  "email_notes": "<summary of email/DNS findings>",
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    const userMessage = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      context.details ? `**Description:** ${context.details}` : "",
      context.clientName ? `**Client:** ${context.clientName}` : "",
      context.userName ? `**Reported By:** ${context.userName}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 1024,
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
}
