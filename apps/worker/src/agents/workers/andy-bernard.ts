import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Andy Bernard — Device Monitoring & RMM (Datto RMM)
 *
 * Queries Datto RMM for device status, open alerts, patch compliance,
 * software inventory, and recent monitoring events.
 */
export class AndyBernardAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Analyze device and endpoint data from Datto RMM relevant to the reported issue.

## What to Check
- Device online/offline status
- Open alerts and their severity
- Patch compliance and missing updates
- Software inventory relevant to the issue
- Recent monitoring events or changes
- Hardware health indicators

## Output Format
Respond with ONLY valid JSON:
{
  "devices_found": [{"hostname": "<name>", "status": "<online/offline>", "os": "<os>", "last_seen": "<when>"}],
  "open_alerts": [{"device": "<hostname>", "alert": "<description>", "severity": "<critical/warning/info>"}],
  "patch_status": "<summary of patch compliance>",
  "relevant_software": ["<software related to the issue>"],
  "endpoint_notes": "<summary of endpoint findings>",
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
      summary: (result.endpoint_notes as string) ?? "No endpoint data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }
}
