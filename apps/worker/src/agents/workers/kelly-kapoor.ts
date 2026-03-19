import type { MemoryMatch, ThreeCxConfig, TwilioConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  ThreeCxClient,
  type ThreeCxSystemStatus,
  type ThreeCxTrunk,
  type ThreeCxTrunkStatus,
  type ThreeCxExtension,
  type ThreeCxInboundRule,
} from "../../integrations/threecx/client.js";
import {
  TwilioClient,
  type TwilioAccount,
  type TwilioCall,
  type TwilioPhoneNumber,
  type TwilioSipTrunk,
  type TwilioAlert,
} from "../../integrations/twilio/client.js";

/**
 * Kelly Kapoor — VoIP & Telephony (3CX + Twilio)
 *
 * Queries 3CX for system status, trunk registrations, extensions,
 * and call logs. Also queries Twilio for SIP trunk status, failed calls,
 * and number configuration.
 *
 * IMPORTANT: Kelly understands the difference between:
 * - A single trunk/DID registration failure (common, usually config or provider issue)
 * - A system-wide VoIP outage (rare, all trunks down, no calls possible)
 * She does NOT over-escalate single 404/registration errors.
 */

interface VoipData {
  readonly threeCx: ThreeCxData | null;
  readonly twilio: TwilioData | null;
}

interface ThreeCxData {
  readonly systemStatus: ThreeCxSystemStatus | null;
  readonly trunks: ReadonlyArray<ThreeCxTrunk>;
  readonly trunkStatuses: ReadonlyArray<ThreeCxTrunkStatus>;
  readonly matchedTrunk: ThreeCxTrunk | null;
  readonly matchedDid: ThreeCxInboundRule | null;
  readonly extensions: ReadonlyArray<ThreeCxExtension>;
  readonly registeredExtensions: number;
  readonly totalExtensions: number;
}

interface TwilioData {
  readonly account: TwilioAccount | null;
  readonly recentFailedCalls: ReadonlyArray<TwilioCall>;
  readonly phoneNumbers: ReadonlyArray<TwilioPhoneNumber>;
  readonly matchedNumber: TwilioPhoneNumber | null;
  readonly sipTrunks: ReadonlyArray<TwilioSipTrunk>;
  readonly recentAlerts: ReadonlyArray<TwilioAlert>;
}

export class KellyKapoorAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the VoIP & telephony specialist. You have REAL data from 3CX and/or Twilio.
Analyze the phone system data to diagnose the reported issue accurately.
Your audience is IT technicians — be specific, technical, and actionable.

## Vendor Resources
- 3CX Documentation: https://www.3cx.com/docs/
- 3CX Admin Manual: https://www.3cx.com/docs/manual/
- 3CX SIP Trunk Guide: https://www.3cx.com/docs/manual/sip-trunk-configuration/
- 3CX Firewall Checker: https://www.3cx.com/docs/manual/firewall-check/
- 3CX Status Page: https://status.3cx.com/
- Twilio Status Page: https://status.twilio.com/
- Twilio SIP Trunking Docs: https://www.twilio.com/docs/sip-trunking
- Twilio Error & Warning Dictionary: https://www.twilio.com/docs/api/errors
- FlowRoute Status: https://status.flowroute.com/
- FlowRoute Support: https://support.flowroute.com/

## Common Fixes
### Trunk Registration Failure
1. Verify SIP trunk credentials (username, password, auth ID) match provider settings
2. Check provider IP whitelist — ensure 3CX public IP is authorized
3. Verify DNS resolution: \`nslookup <provider-host>\` from the 3CX server
4. Check firewall: SIP uses UDP/TCP 5060 (or 5061 for TLS), RTP uses UDP 9000-10999
5. Run 3CX Firewall Checker: 3CX Admin > Dashboard > Firewall Check
6. Review trunk options: re-register interval, keep-alive, outbound proxy settings
7. Check provider portal for account suspension or billing issues

### No Audio / One-Way Audio
1. Check NAT/STUN settings in 3CX: Admin > Network > STUN
2. Verify RTP port range (9000-10999) is open on firewall for UDP
3. Check if SIP ALG is enabled on the router — DISABLE IT (common cause)
4. Verify codec negotiation: ensure both sides support the same codec (G.711, G.729)
5. Check for double-NAT scenarios — 3CX needs a single public IP or proper STUN config
6. Ref: https://www.3cx.com/docs/manual/one-way-audio/

### DID Not Routing / 404 Errors
1. Verify DID is assigned in 3CX: Admin > Inbound Rules > check DID number
2. Confirm DID is active with the provider (check provider portal)
3. Check if number was ported — verify with losing/gaining carrier
4. Ensure trunk associated with the DID is registered
5. Check inbound rule destination (ring group, extension, IVR)

### SIP Troubleshooting Flowchart
1. Can the device register? YES -> Check call routing. NO -> Check credentials, firewall, DNS
2. Can outbound calls connect? YES -> Check inbound. NO -> Check trunk, outbound rules, provider
3. Is there audio? YES -> Check quality (jitter, packet loss). NO -> Check NAT, STUN, SIP ALG, codecs
4. Is call quality poor? -> Check QoS settings, bandwidth, jitter buffer, switch to G.711

## CRITICAL: Scope Assessment
DO NOT assume a system-wide outage unless ALL evidence points to it. You MUST assess the SCOPE of the issue:

### Single Trunk/DID Failure (MOST COMMON)
- One SIP trunk returning 404/403/503 errors
- One DID not routing calls
- One provider (FlowRoute, Twilio, etc.) having issues
- This is NOT an outage — it's a trunk registration or config issue
- Scope: "single_trunk" or "single_did"

### Partial Degradation
- Multiple trunks failing but some still working
- Intermittent call quality issues
- Some extensions not registering
- Scope: "partial"

### System-Wide Outage (RARE — requires strong evidence)
- ALL trunks unregistered
- 3CX service itself is down
- No extensions registered
- FQDN unreachable
- Scope: "system_wide"

## SIP Response Code Reference
- 404 Not Found: DID not configured at provider, trunk misconfigured, or number ported away
- 403 Forbidden: Authentication failed, IP not whitelisted, or account suspended
- 408 Request Timeout: Network connectivity issue, firewall blocking SIP
- 480 Temporarily Unavailable: Endpoint offline, DND enabled, or no registered devices
- 486 Busy Here: All channels busy on the trunk
- 487 Request Terminated: Call cancelled by caller
- 500 Server Internal Error: Provider-side issue
- 503 Service Unavailable: Provider overloaded or maintenance

## 3CX-Specific Knowledge
- stahlman.fl.3cx.us format = 3CX instance FQDN (customer.region.3cx.us)
- Trunk names like "Ln.10000@FlowRoute" = Line 10000 using FlowRoute provider
- Registration failures ≠ outage. A trunk can fail to register for many reasons.
- Check if OTHER trunks on the same system are still working
- Check how many extensions are still registered (if most are, the system is UP)

## FlowRoute-Specific Knowledge
- FlowRoute is a SIP trunking provider (now part of Lumen)
- 404 from FlowRoute usually means: DID not found, number ported, or trunk misconfigured
- Check: DID assignment, trunk credentials, IP whitelisting
- FlowRoute status page: status.flowroute.com

## Output Format
Respond with ONLY valid JSON:
{
  "scope": "<single_trunk/single_did/partial/system_wide/unknown>",
  "scope_reasoning": "<WHY you determined this scope — be specific about evidence>",
  "affected_component": "<specific trunk name, DID, extension, or 'entire system'>",
  "sip_error_analysis": "<detailed analysis of any SIP error codes found>",
  "provider_status": "<status of the SIP provider if identifiable>",
  "system_health": {
    "trunks_registered": "<X of Y registered>",
    "extensions_registered": "<X of Y registered>",
    "system_reachable": <true/false/null>
  },
  "root_cause": "<most likely root cause based on all evidence>",
  "troubleshooting_steps": ["<ordered steps the tech should follow>"],
  "immediate_actions": ["<what to do RIGHT NOW>"],
  "is_provider_issue": <true/false>,
  "provider_action": "<action to take with the provider, null if not applicable>",
  "kb_references": ["<relevant vendor KB/doc URLs for this specific issue>"],
  "voip_notes": "<comprehensive VoIP assessment with all findings — include relevant KB links>",
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    const ticketText = `${context.summary} ${context.details ?? ""}`;

    // Extract VoIP-specific signals
    const sipCode = extractSipCode(ticketText);
    const phoneNumber = extractPhoneNumber(ticketText);
    const trunkName = extractTrunkName(ticketText);
    const fqdn = extractFqdn(ticketText);

    await this.logThinking(
      context.ticketId,
      `Analyzing VoIP issue for ticket #${context.haloId}. ${sipCode ? `SIP code: ${sipCode}.` : ""} ${trunkName ? `Trunk: ${trunkName}.` : ""} ${phoneNumber ? `Number: ${phoneNumber}.` : ""} ${fqdn ? `FQDN: ${fqdn}.` : ""} Querying 3CX and Twilio...`,
    );

    const voipData = await this.fetchVoipData(
      context,
      trunkName,
      phoneNumber,
    );

    const userMessage = this.buildUserMessage(
      context,
      voipData,
      sipCode,
      phoneNumber,
      trunkName,
      fqdn,
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

    const scope = (result.scope as string) ?? "unknown";
    const affectedComponent =
      (result.affected_component as string) ?? "unknown";

    await this.logThinking(
      context.ticketId,
      `VoIP analysis complete. Scope: ${scope}. Affected: ${affectedComponent}. ${(result.is_provider_issue as boolean) ? "Provider-side issue suspected." : "Local config issue suspected."}`,
    );

    return {
      summary: (result.voip_notes as string) ?? "No VoIP data available",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Data Fetcher ───────────────────────────────────────────────────

  private async fetchVoipData(
    context: TriageContext,
    trunkName: string | null,
    phoneNumber: string | null,
  ): Promise<VoipData> {
    const [threeCxData, twilioData] = await Promise.all([
      this.fetchThreeCxData(context, trunkName, phoneNumber),
      this.fetchTwilioData(context, phoneNumber),
    ]);

    return { threeCx: threeCxData, twilio: twilioData };
  }

  private async fetchThreeCxData(
    context: TriageContext,
    trunkName: string | null,
    phoneNumber: string | null,
  ): Promise<ThreeCxData | null> {
    const config = await this.getThreeCxConfig();
    if (!config) {
      await this.logThinking(
        context.ticketId,
        "3CX integration not configured — skipping 3CX data lookup.",
      );
      return null;
    }

    const client = new ThreeCxClient(config);

    try {
      const [systemStatus, trunks, trunkStatuses, extensions] =
        await Promise.all([
          client.getSystemStatus().catch(() => null),
          client.getTrunks().catch(() => []),
          client.getTrunkStatus().catch(() => []),
          client.getExtensions().catch(() => []),
        ]);

      // Find the specific trunk mentioned in the ticket
      let matchedTrunk: ThreeCxTrunk | null = null;
      if (trunkName) {
        matchedTrunk = await client.findTrunkByName(trunkName).catch(() => null);
      }

      // Find the DID if a phone number is mentioned
      let matchedDid: ThreeCxInboundRule | null = null;
      if (phoneNumber) {
        matchedDid = await client.findDid(phoneNumber).catch(() => null);
      }

      const registeredExtensions = extensions.filter(
        (e) => e.IsRegistered,
      ).length;

      await this.logThinking(
        context.ticketId,
        `3CX data: ${trunks.length} trunks, ${registeredExtensions}/${extensions.length} extensions registered. ${matchedTrunk ? `Found trunk: ${matchedTrunk.Name}.` : ""}`,
      );

      return {
        systemStatus,
        trunks,
        trunkStatuses,
        matchedTrunk,
        matchedDid,
        extensions,
        registeredExtensions,
        totalExtensions: extensions.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await this.logThinking(
        context.ticketId,
        `⚠ 3CX API error: ${message}. Falling back to AI analysis.`,
      );
      return null;
    }
  }

  private async fetchTwilioData(
    context: TriageContext,
    phoneNumber: string | null,
  ): Promise<TwilioData | null> {
    const config = await this.getTwilioConfig();
    if (!config) {
      await this.logThinking(
        context.ticketId,
        "Twilio integration not configured — skipping Twilio data lookup.",
      );
      return null;
    }

    const client = new TwilioClient(config);

    try {
      const [account, recentFailedCalls, phoneNumbers, sipTrunks, recentAlerts] =
        await Promise.all([
          client.getAccount().catch(() => null),
          client.getFailedCalls(10).catch(() => []),
          client.getPhoneNumbers().catch(() => []),
          client.getSipTrunks().catch(() => []),
          client.getAlerts({ pageSize: 10 }).catch(() => []),
        ]);

      let matchedNumber: TwilioPhoneNumber | null = null;
      if (phoneNumber) {
        matchedNumber = await client.findNumber(phoneNumber).catch(() => null);
      }

      await this.logThinking(
        context.ticketId,
        `Twilio data: Account ${account?.status ?? "unknown"}, ${phoneNumbers.length} numbers, ${sipTrunks.length} SIP trunks, ${recentFailedCalls.length} recent failed calls, ${recentAlerts.length} alerts.`,
      );

      return {
        account,
        recentFailedCalls,
        phoneNumbers,
        matchedNumber,
        sipTrunks,
        recentAlerts,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await this.logThinking(
        context.ticketId,
        `⚠ Twilio API error: ${message}. Falling back to AI analysis.`,
      );
      return null;
    }
  }

  // ── Config Getters ─────────────────────────────────────────────────

  private async getThreeCxConfig(): Promise<ThreeCxConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "threecx")
      .eq("is_active", true)
      .single();

    return data ? (data.config as ThreeCxConfig) : null;
  }

  private async getTwilioConfig(): Promise<TwilioConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "twilio")
      .eq("is_active", true)
      .single();

    return data ? (data.config as TwilioConfig) : null;
  }

  // ── Message Builder ────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    data: VoipData,
    sipCode: number | null,
    phoneNumber: string | null,
    trunkName: string | null,
    fqdn: string | null,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId} — VoIP & Telephony Assessment`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details)
      sections.push(`**Full Description:** ${context.details}`);
    if (context.clientName)
      sections.push(`**Client:** ${context.clientName}`);
    if (context.userName)
      sections.push(`**Reported By:** ${context.userName}`);

    // Extracted signals
    sections.push("");
    sections.push("## Extracted VoIP Signals");
    if (sipCode) sections.push(`**SIP Response Code:** ${sipCode}`);
    if (trunkName) sections.push(`**Trunk Name:** ${trunkName}`);
    if (phoneNumber) sections.push(`**Phone Number:** ${phoneNumber}`);
    if (fqdn) sections.push(`**3CX FQDN:** ${fqdn}`);
    if (!sipCode && !trunkName && !phoneNumber && !fqdn) {
      sections.push(
        "_No specific SIP codes, trunk names, or phone numbers found in ticket._",
      );
    }

    // 3CX Data
    if (data.threeCx) {
      const tcx = data.threeCx;
      sections.push("");
      sections.push("## 3CX System Data");

      if (tcx.systemStatus) {
        sections.push(`**Version:** ${tcx.systemStatus.Version ?? "Unknown"}`);
        sections.push(`**FQDN:** ${tcx.systemStatus.FQDN ?? "Unknown"}`);
        sections.push(
          `**Trunks Registered:** ${tcx.systemStatus.TrunksRegistered ?? "?"}/${tcx.systemStatus.TrunksTotal ?? "?"}`,
        );
        sections.push(
          `**Extensions Registered:** ${tcx.registeredExtensions}/${tcx.totalExtensions}`,
        );
        if (tcx.systemStatus.HasNotRunningServices) {
          sections.push("**⚠ Has Not-Running Services: YES**");
        }
      }

      if (tcx.trunks.length > 0) {
        sections.push("");
        sections.push("### All Trunks");
        for (const trunk of tcx.trunks) {
          const status = trunk.IsRegistered ? "✅ Registered" : "❌ Not Registered";
          sections.push(
            `- **${trunk.Name ?? "Unknown"}** (${trunk.ProviderName ?? "?"}): ${status} | Host: ${trunk.Host ?? "?"} | SIM Calls: ${trunk.NumberOfSimCalls ?? "?"}`,
          );
        }
      }

      if (tcx.trunkStatuses.length > 0) {
        sections.push("");
        sections.push("### Trunk Registration Status");
        for (const ts of tcx.trunkStatuses) {
          sections.push(
            `- **${ts.TrunkName ?? "Trunk " + ts.TrunkId}**: ${ts.Status ?? ts.RegistrarStatus ?? "Unknown"} ${ts.LastError ? `| Last Error: ${ts.LastError}` : ""}`,
          );
        }
      }

      if (tcx.matchedTrunk) {
        sections.push("");
        sections.push("### ⭐ Matched Trunk (from ticket)");
        sections.push(
          `**Name:** ${tcx.matchedTrunk.Name} | **Provider:** ${tcx.matchedTrunk.ProviderName ?? "?"} | **Registered:** ${tcx.matchedTrunk.IsRegistered ?? "?"} | **Host:** ${tcx.matchedTrunk.Host ?? "?"}`,
        );
      }

      if (tcx.matchedDid) {
        sections.push("");
        sections.push("### ⭐ Matched DID/Inbound Rule");
        sections.push(
          `**DID:** ${tcx.matchedDid.DID} | **Trunk:** ${tcx.matchedDid.Trunk ?? "?"} | **Destination:** ${tcx.matchedDid.Destination ?? "?"} (${tcx.matchedDid.DestinationType ?? "?"})`,
        );
      }
    }

    // Twilio Data
    if (data.twilio) {
      const tw = data.twilio;
      sections.push("");
      sections.push("## Twilio Data");

      if (tw.account) {
        sections.push(
          `**Account:** ${tw.account.friendly_name ?? "Unknown"} | **Status:** ${tw.account.status ?? "Unknown"}`,
        );
      }

      if (tw.sipTrunks.length > 0) {
        sections.push("");
        sections.push("### SIP Trunks");
        for (const trunk of tw.sipTrunks) {
          sections.push(
            `- **${trunk.friendly_name ?? "Unknown"}**: Domain: ${trunk.domain_name ?? "?"} | Secure: ${trunk.secure ?? "?"}`,
          );
        }
      }

      if (tw.matchedNumber) {
        sections.push("");
        sections.push("### ⭐ Matched Phone Number");
        sections.push(
          `**Number:** ${tw.matchedNumber.phone_number} | **Name:** ${tw.matchedNumber.friendly_name ?? "?"} | **Trunk SID:** ${tw.matchedNumber.trunk_sid ?? "None"}`,
        );
      }

      if (tw.recentFailedCalls.length > 0) {
        sections.push("");
        sections.push(
          `### Recent Failed Calls (${tw.recentFailedCalls.length})`,
        );
        for (const call of tw.recentFailedCalls.slice(0, 5)) {
          sections.push(
            `- ${call.from ?? "?"} → ${call.to ?? "?"} | Status: ${call.status ?? "?"} | ${call.start_time ?? ""}`,
          );
        }
      }

      if (tw.recentAlerts.length > 0) {
        sections.push("");
        sections.push(`### Recent Alerts (${tw.recentAlerts.length})`);
        for (const alert of tw.recentAlerts.slice(0, 5)) {
          sections.push(
            `- Error ${alert.error_code ?? "?"}: ${alert.alert_text ?? "?"} | ${alert.date_created ?? ""}`,
          );
        }
      }
    }

    // No data fallback
    if (!data.threeCx && !data.twilio) {
      sections.push("");
      sections.push("## ⚠ No VoIP Integration Data Available");
      sections.push(
        "Neither 3CX nor Twilio is configured. " +
          "Analyze the ticket using your VoIP/SIP expertise. " +
          "Remember: a single trunk 404 is NOT a system-wide outage.",
      );
    }

    return sections.join("\n");
  }
}

// ── Extraction Helpers ─────────────────────────────────────────────────

function extractSipCode(text: string): number | null {
  // Match SIP response codes like "404", "replied: Not Found (404)", "SIP 503"
  const patterns = [
    /\((\d{3})\)/,
    /replied:?\s*\w[\w\s]*\((\d{3})\)/i,
    /sip\s*[:/]?\s*(\d{3})/i,
    /response\s*(\d{3})/i,
    /error\s*(\d{3})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const code = parseInt(match[1], 10);
      // Only return valid SIP response codes (1xx-6xx)
      if (code >= 100 && code <= 699) return code;
    }
  }
  return null;
}

function extractPhoneNumber(text: string): string | null {
  // Match phone numbers like 12392528348, +1-239-252-8348, (239) 252-8348
  const match = text.match(
    /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  );
  if (!match) {
    // Try raw digit string (11+ digits)
    const rawMatch = text.match(/\b(\d{10,11})\b/);
    return rawMatch ? rawMatch[1] : null;
  }
  return match[0];
}

function extractTrunkName(text: string): string | null {
  // Match trunk patterns like "Ln.10000@FlowRoute", "trunk: MyTrunk"
  const patterns = [
    /Ln\.\d+@[\w]+/i,
    /trunk[:\s]+["']?([^"'\n,]+)["']?/i,
    /@(FlowRoute|Twilio|Bandwidth|Lumen|VoIPms|Vonage|Telnyx|SIPStation)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractFqdn(text: string): string | null {
  // Match 3CX FQDNs like stahlman.fl.3cx.us
  const match = text.match(/[\w.-]+\.3cx\.\w+/i);
  return match ? match[0] : null;
}
