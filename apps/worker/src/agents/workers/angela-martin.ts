import type { DattoConfig, MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import { DattoClient } from "../../integrations/datto/client.js";
import {
  DattoEdrClient,
  dedupeAlerts,
  type DattoEdrConfig,
  type EdrAlert,
} from "../../integrations/datto-edr/client.js";
import { ApiNinjasClient, extractPublicIps, extractForeignDomains } from "../../integrations/apininjas/client.js";

interface EdrData {
  readonly alerts: ReadonlyArray<EdrAlert & { readonly occurrences: number; readonly reporterDevice: boolean }>;
  readonly reporterHostnames: ReadonlyArray<string>;
}

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
  "edr_correlation": "<if Datto EDR detections were provided: one or two sentences on whether any detection matches what the customer describes, naming the hostname and detection. null if no EDR data or nothing correlates>",
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
    // Pull real EDR detections for this client so the assessment can
    // correlate the customer's complaint against actual endpoint alerts
    const edrData = await this.fetchEdrData(context);
    const ipIntel = await this.fetchIpIntel(context);

    // Build detailed context for security analysis
    const userMessage = this.buildUserMessage(context, edrData, ipIntel);

    // Log thinking
    await this.logThinking(
      context.ticketId,
      edrData && edrData.alerts.length > 0
        ? `Running security assessment on ticket #${context.haloId}. Datto EDR has ${edrData.alerts.length} recent detection group(s) for this client — correlating against the reported issue.`
        : `Running security assessment on ticket #${context.haloId}. Analyzing for IOCs, phishing indicators, account compromise, malware signs, and compliance concerns.`,
    );

    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 3072,
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

  // ── Datto EDR ───────────────────────────────────────────────────────

  private async fetchEdrData(context: TriageContext): Promise<EdrData | null> {
    if (!context.clientName) return null;

    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "datto-edr")
      .eq("is_active", true)
      .single();
    if (!data) return null;

    try {
      const edr = new DattoEdrClient(data.config as DattoEdrConfig);

      // Resolve the reporter's device hostnames via Datto RMM so alerts on
      // THEIR machine can be flagged distinctly from site-wide noise
      let reporterHostnames: string[] = [];
      if (context.userName) {
        try {
          const { data: dattoRow } = await this.supabase
            .from("integrations")
            .select("config")
            .eq("service", "datto")
            .eq("is_active", true)
            .single();
          if (dattoRow) {
            const datto = new DattoClient(dattoRow.config as DattoConfig);
            const devices = await datto.findDevicesByUser(context.userName, undefined, context.userEmail);
            reporterHostnames = devices
              .map((d) => d.hostname)
              .filter((h): h is string => Boolean(h))
              .slice(0, 5);
          }
        } catch {
          // Datto lookup is best-effort; EDR client-name scoping still applies
        }
      }

      const alerts = await edr.getRecentAlerts({
        clientName: context.clientName,
        hostnames: reporterHostnames,
        days: 7,
        limit: 50,
      });
      if (alerts.length === 0) return { alerts: [], reporterHostnames };

      const reporterSet = new Set(reporterHostnames.map((h) => h.toLowerCase()));
      const deduped = dedupeAlerts(alerts)
        .map((alert) => ({
          ...alert,
          reporterDevice: Boolean(alert.hostname && reporterSet.has(alert.hostname.toLowerCase())),
        }))
        .sort((a, b) => Number(b.reporterDevice) - Number(a.reporterDevice))
        .slice(0, 15);

      console.log(
        `[ANGELA] EDR: ${alerts.length} alerts (${deduped.length} unique) for "${context.clientName}", ${deduped.filter((a) => a.reporterDevice).length} on reporter's device(s)`,
      );
      return { alerts: deduped, reporterHostnames };
    } catch (error) {
      console.warn("[ANGELA] Datto EDR fetch failed (continuing without):", error);
      return null;
    }
  }

  private async fetchIpIntel(context: TriageContext): Promise<string[]> {
    const client = ApiNinjasClient.fromEnv();
    if (!client) return [];
    const text = `${context.summary} ${context.details ?? ""}`;
    const lines: string[] = [];

    for (const ip of extractPublicIps(text)) {
      const info = await client.ipLookup(ip);
      if (!info) continue;
      const parts = [info.city, info.region, info.country, info.isp].filter(Boolean);
      if (parts.length > 0) lines.push(`IP ${ip}: ${parts.join(", ")}`);
    }

    // Domain age on foreign domains (sender domains, links) — a domain
    // registered days/weeks ago is a top phishing signal
    const ownDomain = context.userEmail?.split("@")[1] ?? "";
    for (const domain of extractForeignDomains(text, [ownDomain])) {
      const who = await client.whois(domain);
      const created = who?.creation_date;
      if (typeof created === "number" && created > 0) {
        const ageDays = Math.floor((Date.now() / 1000 - created) / 86400);
        const flag = ageDays < 90 ? " ⚠ YOUNG DOMAIN — strong phishing signal" : "";
        lines.push(`Domain ${domain}: registered ${ageDays} days ago (registrar ${who?.registrar ?? "unknown"})${flag}`);
      }
    }
    return lines;
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(context: TriageContext, edrData: EdrData | null, ipIntel: ReadonlyArray<string> = []): string {
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

    // IP intelligence: geolocate public IPs mentioned in the ticket so
    // "sign-in from 203.0.113.7" becomes "sign-in from Lagos, Nigeria (ISP X)"
    if (ipIntel.length > 0) {
      sections.push("");
      sections.push("## IP Intelligence (API Ninjas — REAL lookups)");
      for (const entry of ipIntel) {
        sections.push(`- ${entry}`);
      }
      sections.push("Compare these locations/ISPs against where this customer's users actually are — an unexpected country or hosting-provider ISP on a sign-in is a strong compromise indicator.");
    }

    if (edrData) {
      sections.push("");
      sections.push("---");
      if (edrData.reporterHostnames.length > 0) {
        sections.push(`**Reporter's devices (from Datto RMM):** ${edrData.reporterHostnames.join(", ")}`);
      }
      if (edrData.alerts.length > 0) {
        sections.push(`## Datto EDR Detections — last 7 days for this client (REAL data)`);
        for (const alert of edrData.alerts) {
          const marker = alert.reporterDevice ? " ⚠ REPORTER'S DEVICE" : "";
          const times = alert.occurrences > 1 ? ` ×${alert.occurrences}` : "";
          sections.push(
            `- [${(alert.severity ?? "?").toUpperCase()}]${marker} ${alert.hostname ?? "unknown-host"}: ${alert.description ?? alert.name}${times} (${alert.mitreTactic ?? "n/a"}, latest ${alert.createdOn ?? "n/a"})`,
          );
        }
        sections.push("");
        sections.push(
          "## EDR Correlation Task\nCompare what the customer DESCRIBES with the detections above. If the customer's symptoms (slowness, popups, locked files, weird behavior, crashes) plausibly line up with a detection — especially one on the reporter's own device — call it out explicitly in edr_correlation with the hostname and detection, raise severity accordingly, and make isolating/scanning that device an immediate action. If nothing correlates, say so in one sentence.",
        );
      } else {
        sections.push("## Datto EDR: no detections in the last 7 days for this client (REAL data — a clean EDR feed is meaningful evidence against active malware).");
      }
    }

    return sections.join("\n");
  }
}
