import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Dwight Schrute — IT Documentation & Assets (Hudu)
 *
 * "Assistant to the Regional Manager"
 * Searches Hudu for client assets, passwords, KB articles, procedures,
 * and any existing documentation relevant to the ticket.
 */
export class DwightSchruteAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Search through IT documentation to find relevant assets, knowledge base articles,
procedures, and configurations for the reported issue.

## What to Look For
- Client assets (servers, workstations, network devices)
- Related KB articles or procedures
- Configuration documentation
- Password/credential vaults relevant to the issue
- Previous similar issues documented

## Output Format
Respond with ONLY valid JSON:
{
  "relevant_assets": [{"name": "<asset>", "type": "<type>", "relevance": "<why relevant>"}],
  "kb_articles": [{"title": "<title>", "summary": "<how it helps>"}],
  "procedures": [{"title": "<title>", "steps_summary": "<key steps>"}],
  "documentation_notes": "<summary of relevant documentation found>",
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
      summary: (result.documentation_notes as string) ?? "No documentation found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }
}
