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
Your audience is IT technicians — be specific, technical, and actionable.

## What You Have Access To
- Devices (workstations, servers, network devices — with status, OS, last seen)
- Open Alerts (active monitoring alerts with severity)
- Patch Status (missing patches, compliance)
- Site Overview (total devices, online/offline counts)

## Vendor Resources
- Datto RMM Help Center: https://rmm.datto.com/help/
- Datto RMM API Docs: https://help.datto.com/s/article/Datto-RMM-API
- Datto Agent Troubleshooting: https://rmm.datto.com/help/en/Content/1INTRODUCTION/Requirements.htm
- Datto Component Library: https://rmm.datto.com/help/en/Content/4WEBPORTAL/Components/ComponentLibrary.htm
- Datto Patch Management: https://rmm.datto.com/help/en/Content/4WEBPORTAL/PatchManagement/PatchManagement.htm
- Datto Community Forum: https://community.datto.com/rmm

## Common Fixes
### Agent Offline / Not Checking In
1. Verify network connectivity on the device (ping, DNS resolution)
2. Check the Datto Agent service: \`Get-Service CagService\` (Windows) or \`systemctl status datto-agent\` (Linux)
3. Restart the agent service: \`Restart-Service CagService\` or \`net stop CagService && net start CagService\`
4. Check agent log: \`C:\\ProgramData\\CentraStage\\Logs\\\` for errors
5. If agent is corrupted, re-download the site installer from Datto RMM and reinstall
6. Verify firewall allows outbound HTTPS (443) to *.centrastage.net and *.datto.com

### Patch Compliance Issues
1. Check Windows Update service: \`Get-Service wuauserv\` — ensure it is running
2. Review pending patches in Datto: Site > Device > Patch Management tab
3. Force patch scan via Quick Job: "Windows Update Scan" component
4. For stuck updates, run: \`DISM /Online /Cleanup-Image /RestoreHealth\` then \`sfc /scannow\`
5. Check WSUS/GPO conflicts if patches are not applying
6. Review patch approval policy in Datto RMM > Setup > Patch Management

### High Resource Usage Alerts
1. Push the "Top Processes" component via Quick Job to identify culprits
2. Check disk space: push "Disk Space Check" component
3. Review event logs remotely: push "Event Log Export" component
4. For memory leaks, schedule a reboot via maintenance window

### Suggested Datto RMM Actions
- **Run Quick Job**: Push ad-hoc scripts/components to a device for immediate remediation
- **Push Component**: Deploy a component from the library (e.g., "Clear Print Spooler", "Flush DNS", "Force Group Policy Update")
- **Restart Agent Service**: If agent is unresponsive, push a restart via Quick Job or instruct on-site tech
- **Schedule Reboot**: Use maintenance window to schedule off-hours reboot for patch application
- **Remote Access**: Use Datto RMM Splashtop integration for direct remote control

## Your Job
1. Review ALL provided Datto data carefully
2. Identify which devices are relevant to the ticket
3. Flag any open alerts that might be related
4. Check if offline devices or patch issues could be the cause
5. Note any patterns (multiple devices affected, specific OS issues, etc.)
6. Suggest specific Datto RMM actions the tech should take (Quick Jobs, components, etc.)
7. Include relevant KB links from https://rmm.datto.com/help/ in your endpoint_notes

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

    // Find the site by client name/ID
    const site = await this.findSite(datto, context.clientName, context.clientId);
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
    clientId?: number | null,
  ): Promise<DattoSite | null> {
    if (!clientName) return null;

    try {
      // 1. Check integration_mappings — try customer_id first (more reliable),
      //    then fall back to case-insensitive name match
      let mapping: { external_id: string; external_name: string } | null = null;

      // Try by Halo client_id if available
      if (clientId) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "datto")
          .eq("customer_id", String(clientId))
          .single();
        mapping = data;
      }

      // Fall back to case-insensitive name lookup
      if (!mapping) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "datto")
          .ilike("customer_name", clientName)
          .single();
        mapping = data;
      }

      if (mapping) {
        const siteId = Number(mapping.external_id);
        if (!isNaN(siteId)) {
          try {
            const site = await datto.getSite(siteId);
            if (site) {
              console.log(
                `[ANDY] Found Datto site via mapping: "${mapping.external_name}" (ID: ${siteId}) for Halo customer "${clientName}"`,
              );
              return site;
            }
          } catch (err) {
            console.error(
              `[ANDY] Mapping found for "${clientName}" → site ${mapping.external_id}, but fetch failed:`,
              err,
            );
            // Fall through to name search
          }
        }
      } else {
        console.log(
          `[ANDY] No mapping found for client "${clientName}"${clientId ? ` (ID: ${clientId})` : ""} — trying name search`,
        );
      }

      // 2. Fallback: search by name
      const sites = await datto.getSites();
      const lower = clientName.toLowerCase();

      // Exact match first
      const exact = sites.find(
        (s) => s.name.toLowerCase() === lower,
      );
      if (exact) return exact;

      // Partial match — strip common suffixes like LLC, Inc, Corp
      const normalize = (name: string) =>
        name.toLowerCase().replace(/[,.]|\b(llc|inc|corp|ltd|co)\b/gi, "").trim();

      const normalizedClient = normalize(clientName);

      const partial = sites.find((s) => {
        const normalizedSite = normalize(s.name);
        return (
          normalizedSite.includes(normalizedClient) ||
          normalizedClient.includes(normalizedSite)
        );
      });

      if (partial) {
        console.log(
          `[ANDY] Matched Datto site by name: "${partial.name}" (ID: ${partial.id}) for "${clientName}"`,
        );
      }

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
