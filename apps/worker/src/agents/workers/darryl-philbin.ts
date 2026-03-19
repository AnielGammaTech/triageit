import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Darryl Philbin — Microsoft 365 & CIPP Specialist
 *
 * "The Warehouse Manager"
 * Queries CIPP (CyberDrain Improved Partner Portal) for Microsoft 365 tenant data:
 * user mailbox status, MFA enrollment, license assignments, conditional access,
 * device compliance, and security defaults.
 */

export class DarrylPhilbinAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the Microsoft 365 specialist. You have access to CIPP (CyberDrain Improved Partner Portal) data for the client's M365 tenant.

## What You Have Access To
- User mailbox status (active, blocked, shared, resource)
- MFA enrollment status (enabled, enforced, per-user or Conditional Access)
- License assignments (E3, E5, Business Basic, etc.)
- Conditional Access policies
- Device compliance (Intune)
- Security defaults and tenant settings
- Sign-in logs and risky user flags

## Output Format
Respond with ONLY valid JSON:
{
  "m365_findings": "<summary of all M365-related findings>",
  "user_status": {"mailbox": "<status>", "mfa": "<status>", "licenses": ["<license list>"], "compliance": "<status>"},
  "tenant_notes": "<any tenant-wide concerns or configurations>",
  "recommendations": ["<actionable recommendations>"],
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // TODO: Integrate with CIPP API when available
    // For now, analyze based on ticket context only
    await this.logThinking(
      context.ticketId,
      `CIPP integration not yet configured. Analyzing M365 context from ticket information only.`,
    );

    const userMessage = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      context.details ? `**Description:** ${context.details}` : "",
      context.clientName ? `**Client:** ${context.clientName}` : "",
      context.userName ? `**Reported By:** ${context.userName}` : "",
      "",
      "**Note:** CIPP integration is not yet configured. Analyze based on ticket context only and recommend what M365 checks should be performed.",
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
      summary: (result.m365_findings as string) ?? "M365 analysis based on ticket context",
      data: result,
      confidence: (result.confidence as number) ?? 0.4,
    };
  }
}
