import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";

/**
 * Jim Halpert — User & Device Identity (JumpCloud)
 *
 * Checks JumpCloud for user identity, MFA enrollment status,
 * device associations, group memberships, and policy compliance.
 */
export class JimHalpertAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Analyze user identity and access context for the reported issue using JumpCloud data.

## What to Check
- User account status (active, locked, suspended)
- MFA enrollment and compliance
- Device associations and OS versions
- Group memberships and policies applied
- Recent login activity or anomalies
- SSO application access

## Output Format
Respond with ONLY valid JSON:
{
  "user_status": "<active/locked/suspended/unknown>",
  "mfa_enrolled": <true/false/null>,
  "devices": [{"name": "<device>", "os": "<os>", "status": "<status>"}],
  "groups": ["<group names>"],
  "identity_notes": "<summary of identity findings>",
  "access_concerns": "<any access or security concerns>",
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
    const result = JSON.parse(text) as Record<string, unknown>;

    return {
      summary: (result.identity_notes as string) ?? "No identity data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }
}
