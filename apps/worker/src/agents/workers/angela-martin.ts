import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";

/**
 * Angela Martin — Security Assessment
 *
 * Analyzes all gathered findings for security implications.
 * Flags potential security incidents, compromised accounts,
 * or vulnerabilities requiring immediate escalation.
 */
export class AngelaMartin extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
Perform a security assessment of the reported issue. You are strict and thorough.

## What to Analyze
- Indicators of compromise (IOCs)
- Phishing or social engineering attempts
- Account compromise or unauthorized access
- Malware or ransomware indicators
- Data exfiltration risks
- Privilege escalation attempts
- Unusual login patterns or locations
- Compliance implications

## Severity Levels
- CRITICAL: Active breach, data loss in progress, ransomware
- HIGH: Confirmed phishing, compromised credentials, malware detected
- MEDIUM: Suspicious activity, policy violations, potential threats
- LOW: Minor policy deviations, informational security notes
- NONE: No security concerns identified

## Output Format
Respond with ONLY valid JSON:
{
  "severity": "<CRITICAL/HIGH/MEDIUM/LOW/NONE>",
  "indicators": [{"type": "<ioc_type>", "description": "<detail>", "severity": "<level>"}],
  "immediate_actions": ["<action required>"],
  "escalation_required": <true/false>,
  "escalation_reason": "<why escalation is needed, null if not>",
  "security_notes": "<comprehensive security assessment>",
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
      summary: (result.security_notes as string) ?? "No security concerns",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }
}
