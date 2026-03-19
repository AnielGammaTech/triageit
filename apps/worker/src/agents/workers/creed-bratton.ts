import type { MemoryMatch } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Creed Bratton — UniFi Network Specialist
 *
 * "Quality Assurance"
 * Queries UniFi Network Controller for site health, AP status,
 * client connectivity, switch port details, and network topology.
 */

export class CreedBrattonAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the network infrastructure specialist. You have access to UniFi Network Controller data.

## What You Have Access To
- Site health dashboard (WAN uptime, throughput, latency)
- Access Point status (connected, disconnected, adoption, firmware)
- Client connectivity (connected clients, signal strength, roaming)
- Switch port details (PoE, link speed, errors, VLANs)
- Network topology and device map
- Alerts and anomalies from UniFi
- Firewall rules and traffic stats

## Output Format
Respond with ONLY valid JSON:
{
  "network_findings": "<summary of network-related findings>",
  "site_health": {"wan_status": "<status>", "ap_count": <number>, "client_count": <number>},
  "affected_devices": [{"name": "<device>", "type": "<AP/switch/gateway>", "status": "<status>", "issue": "<description>"}],
  "recommendations": ["<actionable network recommendations>"],
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // TODO: Integrate with UniFi Controller API when available
    await this.logThinking(
      context.ticketId,
      `UniFi integration not yet configured. Analyzing network context from ticket information only.`,
    );

    const userMessage = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      context.details ? `**Description:** ${context.details}` : "",
      context.clientName ? `**Client:** ${context.clientName}` : "",
      context.userName ? `**Reported By:** ${context.userName}` : "",
      "",
      "**Note:** UniFi integration is not yet configured. Analyze based on ticket context only and recommend what network checks should be performed.",
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
      summary: (result.network_findings as string) ?? "Network analysis based on ticket context",
      data: result,
      confidence: (result.confidence as number) ?? 0.4,
    };
  }
}
