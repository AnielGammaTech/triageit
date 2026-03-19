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
Your audience is IT technicians — be specific, technical, and actionable.

## Security Resources
- CISA Known Exploited Vulnerabilities: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- CISA Alerts & Advisories: https://www.cisa.gov/news-events/cybersecurity-advisories
- NIST Incident Response Guide: https://csrc.nist.gov/publications/detail/sp/800-61/rev-2/final
- MITRE ATT&CK Framework: https://attack.mitre.org/
- Microsoft 365 Security Center: https://security.microsoft.com/
- Microsoft Incident Response Playbooks: https://learn.microsoft.com/en-us/security/operations/incident-response-playbooks
- Have I Been Pwned: https://haveibeenpwned.com/
- VirusTotal (file/URL analysis): https://www.virustotal.com/
- AbuseIPDB (IP reputation): https://www.abuseipdb.com/
- Phishtank (phishing URL check): https://phishtank.org/

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

## Incident Response Checklists

### Phishing Response Procedure
1. **Contain**: Instruct user NOT to click any more links or provide additional information
2. **Preserve Evidence**: Screenshot the email, note sender address, subject, timestamps, and any URLs/attachments
3. **Block Sender**: Add sender to block list in Exchange Admin > Mail Flow > Rules or Security Center
4. **Check for Clicks**: Review email trace — did other users receive the same email? Did anyone click?
   - M365: Security Center > Threat Explorer > search by sender/subject
5. **Scan for Compromise**: If user clicked a link or opened attachment:
   - Reset user password immediately
   - Revoke active sessions: \`Revoke-AzureADUserAllRefreshToken\` or via Azure AD Portal
   - Check Azure AD Sign-in Logs for suspicious activity
   - Run AV scan on user's device
6. **Report**: Submit to Microsoft: Security Center > Submissions; Report to https://phishtank.org/
7. **Communicate**: Notify affected users and management per incident response policy

### Microsoft 365 Account Compromise Remediation
1. **Immediate Actions**:
   - Reset user password: M365 Admin > Users > select user > Reset Password
   - Revoke all sessions: Azure AD > Users > select user > Revoke Sessions
   - Disable account temporarily if active exfiltration is suspected
2. **Check for Damage**:
   - Review Unified Audit Log: Security Center > Audit > search by user (last 30 days)
   - Check inbox rules: Exchange Admin > select mailbox > Mail Flow Rules — look for forwarding rules
   - Check OAuth app grants: Azure AD > Enterprise Apps > filter by user consent
   - Review sent items for phishing emails sent FROM the compromised account
3. **Remediate**:
   - Remove malicious inbox rules (forwarding to external addresses)
   - Remove unauthorized OAuth app consents
   - Re-enable MFA or reset MFA registration
   - Check and remove any added delegates on the mailbox
4. **Harden**:
   - Enable MFA if not already active
   - Set up Conditional Access policies (block legacy auth, require compliant device)
   - Enable Azure AD Identity Protection risk-based policies
   - Ref: https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/responding-to-a-compromised-email-account

### Malware / Ransomware Response
1. **Isolate**: Disconnect affected device(s) from the network immediately (do NOT power off)
2. **Identify**: Note the malware name, ransom message, encrypted file extensions
3. **Scope**: Check if other devices are affected — review network shares, lateral movement indicators
4. **Preserve**: Image the affected drive if possible for forensic analysis
5. **Scan**: Run full AV scans on all devices in the same network segment
6. **Check Backups**: Verify backup integrity BEFORE restoring — ensure backups are not infected
7. **Restore**: Wipe and reimage affected device, restore data from known-good backup
8. **Report**: Report ransomware to CISA: https://www.cisa.gov/report and law enforcement (FBI IC3: https://ic3.gov/)

## Severity Levels
- CRITICAL: Active breach, data loss in progress, ransomware
- HIGH: Confirmed phishing, compromised credentials, malware detected
- MEDIUM: Suspicious activity, policy violations, potential threats
- LOW: Minor policy deviations, informational security notes
- NONE: No security concerns identified

## Be Specific
Don't just say "possible phishing" — explain WHY you think so based on specific evidence in the ticket. Reference exact phrases or patterns. Include relevant reference URLs (CISA, MITRE, Microsoft docs) in your security_notes so the tech has immediate access to guidance.

## Output Format
Respond with ONLY valid JSON:
{
  "severity": "<CRITICAL/HIGH/MEDIUM/LOW/NONE>",
  "indicators": [{"type": "<phishing/malware/account_compromise/data_exfil/privilege_escalation/policy_violation/network/other>", "description": "<specific detail from ticket>", "severity": "<CRITICAL/HIGH/MEDIUM/LOW>", "evidence": "<exact text or pattern that triggered this>"}],
  "immediate_actions": ["<specific action the tech must take NOW — include commands/URLs>"],
  "investigation_steps": ["<deeper investigation steps with specific tools and commands>"],
  "reference_links": ["<relevant CISA/MITRE/vendor security advisory URLs for this issue>"],
  "escalation_required": <true/false>,
  "escalation_reason": "<why escalation is needed, null if not>",
  "compliance_concerns": "<any regulatory or compliance implications, null if none>",
  "security_notes": "<comprehensive security assessment with reasoning — include relevant reference URLs>",
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
