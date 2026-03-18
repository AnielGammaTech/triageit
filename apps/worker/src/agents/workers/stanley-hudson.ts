import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Stanley Hudson — Cloud Infrastructure (Vultr)
 *
 * Checks Vultr for cloud instance status, bandwidth usage,
 * DNS records, and firewall configurations.
 */
export class StanleyHudsonAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Analyze cloud infrastructure status from Vultr relevant to the reported issue.

## What to Check
- Server/instance status and uptime
- Bandwidth and resource utilization
- DNS record configurations
- Firewall rules and security groups
- Recent restarts or incidents
- Backup status

## Output Format
Respond with ONLY valid JSON:
{
  "instances": [{"label": "<name>", "status": "<running/stopped>", "ip": "<ip>", "region": "<region>"}],
  "dns_records": [{"domain": "<domain>", "type": "<A/MX/CNAME>", "value": "<value>"}],
  "firewall_notes": "<summary of firewall config>",
  "resource_usage": "<bandwidth/CPU/memory summary>",
  "cloud_notes": "<summary of cloud findings>",
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
      summary: (result.cloud_notes as string) ?? "No cloud data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }
}
