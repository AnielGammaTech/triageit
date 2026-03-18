import type { MemoryMatch, DattoConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  DattoClient,
  type DattoDevice,
  type DattoAlert,
  type DattoSite,
} from "../../integrations/datto/client.js";

/**
 * Andy Bernard — Device Monitoring & RMM (Datto RMM)
 *
 * Queries real Datto RMM data: device status, open alerts,
 * patch compliance, and software inventory.
 */

interface DattoData {
  readonly siteId: number | null;
  readonly siteName: string | null;
  readonly devices: ReadonlyArray<DattoDevice>;
  readonly alerts: ReadonlyArray<DattoAlert>;
  readonly siteStatus: DattoSite | null;
}

export class AndyBernardAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the endpoint/RMM expert. You have REAL data from Datto RMM (the device monitoring platform).
Analyze the provided Datto data to find anything relevant to the reported issue.

## What You Have Access To
- Devices (workstations, servers, network devices — with status, OS, last seen)
- Open Alerts (active monitoring alerts with severity)
- Patch Status (missing patches, compliance)
- Site Overview (total devices, online/offline counts)

## Your Job
1. Review ALL provided Datto data carefully
2. Identify which devices are relevant to the ticket
3. Flag any open alerts that might be related
4. Check if offline devices or patch issues could be the cause
5. Note any patterns (multiple devices affected, specific OS issues, etc.)

## Output Format
Respond with ONLY valid JSON:
{
  "devices_found": [{"hostname": "<name>", "status": "<online/offline>", "os": "<os>", "last_seen": "<when>", "relevance": "<why this device matters>"}],
  "open_alerts": [{"device": "<hostname>", "alert": "<description>", "severity": "<critical/warning/info>", "timestamp": "<when>"}],
  "patch_status": "<summary of patch compliance across relevant devices>",
  "site_health": "<overall site device health summary>",
  "relevant_software": ["<software related to the issue>"],
  "endpoint_notes": "<comprehensive summary of ALL endpoint findings>",
  "has_related_alerts": <true/false>,
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real Datto data
    const dattoData = await this.fetchDattoData(context);

    // 2. Build rich user message with real data
    const userMessage = this.buildUserMessage(context, dattoData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      dattoData.siteId
        ? `Found site "${dattoData.siteName}" in Datto RMM (ID: ${dattoData.siteId}). Retrieved ${dattoData.devices.length} devices, ${dattoData.alerts.length} open alerts. Analyzing endpoint data now.`
        : `Could not find client "${context.clientName}" in Datto RMM. Running analysis with ticket info only.`,
    );

    // 4. Send everything to the AI
    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 2048,
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

  // ── Datto Data Fetching ─────────────────────────────────────────────

  private async fetchDattoData(context: TriageContext): Promise<DattoData> {
    const emptyResult: DattoData = {
      siteId: null,
      siteName: null,
      devices: [],
      alerts: [],
      siteStatus: null,
    };

    const config = await this.getDattoConfig();
    if (!config) return emptyResult;

    const datto = new DattoClient(config);

    // Find the site by client name
    const site = await this.findSite(datto, context.clientName);
    if (!site) return emptyResult;

    // Fetch devices and alerts in parallel
    const [devices, alerts] = await Promise.all([
      this.fetchDevices(datto, site.id),
      this.fetchAlerts(datto, site.id),
    ]);

    return {
      siteId: site.id,
      siteName: site.name,
      devices,
      alerts,
      siteStatus: site,
    };
  }

  private async findSite(
    datto: DattoClient,
    clientName: string | null,
  ): Promise<DattoSite | null> {
    if (!clientName) return null;

    try {
      const sites = await datto.getSites();
      const lower = clientName.toLowerCase();

      // Exact match first
      const exact = sites.find(
        (s) => s.name.toLowerCase() === lower,
      );
      if (exact) return exact;

      // Partial match
      const partial = sites.find(
        (s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
      );
      return partial ?? null;
    } catch (error) {
      console.error("[ANDY] Failed to search Datto sites:", error);
      return null;
    }
  }

  private async fetchDevices(
    datto: DattoClient,
    siteId: number,
  ): Promise<ReadonlyArray<DattoDevice>> {
    try {
      return await datto.getDevices(siteId);
    } catch (error) {
      console.error("[ANDY] Failed to fetch Datto devices:", error);
      return [];
    }
  }

  private async fetchAlerts(
    datto: DattoClient,
    siteId: number,
  ): Promise<ReadonlyArray<DattoAlert>> {
    try {
      return await datto.getOpenAlerts(siteId);
    } catch (error) {
      console.error("[ANDY] Failed to fetch Datto alerts:", error);
      return [];
    }
  }

  private async getDattoConfig(): Promise<DattoConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "datto")
      .eq("is_active", true)
      .single();

    return data ? (data.config as DattoConfig) : null;
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    dattoData: DattoData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    if (dattoData.siteId) {
      sections.push("");
      sections.push("---");
      sections.push(
        `## Datto RMM Data for ${dattoData.siteName} (Site ID: ${dattoData.siteId})`,
      );

      // Site overview
      if (dattoData.siteStatus?.devicesStatus) {
        const ds = dattoData.siteStatus.devicesStatus;
        sections.push("");
        sections.push("### Site Overview");
        sections.push(
          `- Total Devices: ${ds.numberOfDevices ?? "N/A"}`,
        );
        sections.push(
          `- Online: ${ds.numberOfOnlineDevices ?? "N/A"}`,
        );
        sections.push(
          `- Offline: ${ds.numberOfOfflineDevices ?? "N/A"}`,
        );
      }

      // Devices
      if (dattoData.devices.length > 0) {
        sections.push("");
        sections.push(`### Devices (${dattoData.devices.length} found)`);
        for (const device of dattoData.devices) {
          const status = device.online ? "🟢 Online" : "🔴 Offline";
          const patches = device.patchStatus
            ? `Missing: ${device.patchStatus.patchesMissing ?? 0}`
            : "";
          sections.push(
            `- **${device.hostname ?? "Unknown"}** — ${status} | OS: ${device.operatingSystem ?? "N/A"} | Last Seen: ${device.lastSeen ?? "N/A"} | IP: ${device.intIpAddress ?? "N/A"} ${patches ? `| Patches ${patches}` : ""}`,
          );
        }
      }

      // Open Alerts
      if (dattoData.alerts.length > 0) {
        sections.push("");
        sections.push(
          `### ⚠ Open Alerts (${dattoData.alerts.length} active)`,
        );
        for (const alert of dattoData.alerts) {
          sections.push(
            `- **[${alert.priority ?? "N/A"}]** ${alert.alertMessage ?? "No message"} — Device: ${alert.hostname ?? "Unknown"} | Time: ${alert.timestamp ?? "N/A"}`,
          );
        }
      } else {
        sections.push("");
        sections.push("### ✅ No Open Alerts");
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No Datto RMM site found for this client. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}
