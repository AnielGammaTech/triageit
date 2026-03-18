import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Angela Martin — Security Assessment
 *
 * Cross-references ticket data against security indicators.
 * No specific integration — analyzes all available context for
 * security implications, IOCs, and compliance concerns.
 *
 * Angela is strict and thorough. She doesn't pull from a specific
 * API but uses her security expertise to assess every ticket.
 */
export class AngelaMartin extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the security expert. You are STRICT and THOROUGH.
Perform a comprehensive security assessment of the reported issue.
You don't have a specific integration — your job is to analyze the ticket
for security implications using your deep cybersecurity knowledge.

## What to Analyze
- Indicators of compromise (IOCs) in the ticket description
- Phishing or social engineering red flags
- Account compromise signals (unusual login, password reset, MFA bypass)
- Malware or ransomware indicators (file encryption, unusual processes)
- Data exfiltration risks (unusual data transfers, external sharing)
- Privilege escalation attempts
- Unusual login patterns or locations mentioned
- Compliance implications (HIPAA, PCI, SOC2)
- Email security concerns (spoofing, header anomalies)
- Network security concerns (open ports, lateral movement)

## Severity Levels
- CRITICAL: Active breach, data loss in progress, ransomware
- HIGH: Confirmed phishing, compromised credentials, malware detected
- MEDIUM: Suspicious activity, policy violations, potential threats
- LOW: Minor policy deviations, informational security notes
- NONE: No security concerns identified

## Be Specific
Don't just say "possible phishing" — explain WHY you think so based on specific evidence in the ticket. Reference exact phrases or patterns.

## Output Format
Respond with ONLY valid JSON:
{
  "severity": "<CRITICAL/HIGH/MEDIUM/LOW/NONE>",
  "indicators": [{"type": "<phishing/malware/account_compromise/data_exfil/privilege_escalation/policy_violation/network/other>", "description": "<specific detail from ticket>", "severity": "<CRITICAL/HIGH/MEDIUM/LOW>", "evidence": "<exact text or pattern that triggered this>"}],
  "immediate_actions": ["<specific action the tech must take NOW>"],
  "investigation_steps": ["<deeper investigation steps if needed>"],
  "escalation_required": <true/false>,
  "escalation_reason": "<why escalation is needed, null if not>",
  "compliance_concerns": "<any regulatory or compliance implications, null if none>",
  "security_notes": "<comprehensive security assessment with reasoning>",
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // Build detailed context for security analysis
    const userMessage = this.buildUserMessage(context);

    // Log thinking
    await this.logThinking(
      context.ticketId,
      `Running security assessment on ticket #${context.haloId}. Analyzing for IOCs, phishing indicators, account compromise, malware signs, and compliance concerns.`,
    );

    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    const result = parseLlmJson<Record<string, unknown>>(text);

    const severity = (result.severity as string) ?? "NONE";
    const escalation = result.escalation_required as boolean;

    // Log if security concerns found
    if (severity !== "NONE") {
      await this.logThinking(
        context.ticketId,
        `⚠ Security assessment complete. Severity: ${severity}. ${escalation ? "ESCALATION REQUIRED." : ""} ${(result.indicators as Array<Record<string, string>>)?.length ?? 0} indicators found.`,
      );
    }

    return {
      summary: (result.security_notes as string) ?? "No security concerns",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(context: TriageContext): string {
    const sections: string[] = [
      `## Ticket #${context.haloId} — Security Assessment`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Full Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);
    if (context.originalPriority) {
      sections.push(`**Original Priority:** P${context.originalPriority}`);
    }

    sections.push("");
    sections.push("---");
    sections.push("## Security Analysis Instructions");
    sections.push(
      "Carefully read EVERY word of the ticket above. Look for:",
    );
    sections.push("- Email addresses or domains that seem spoofed");
    sections.push("- Mentions of clicking links, opening attachments, or downloading files");
    sections.push("- Password reset requests or MFA bypass attempts");
    sections.push("- Error codes that could indicate compromise (e.g., 401, 403 in unusual contexts)");
    sections.push("- References to data sharing, external access, or permission changes");
    sections.push("- Unusual service errors that could indicate an attack");
    sections.push("- Tenant IDs, SharePoint URLs, or cloud service references that could be targeted");

    return sections.join("\n");
  }
}
