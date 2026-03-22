import type { MemoryMatch, UnifiConfig, HuduConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  UnifiClient,
  type UnifiSite,
  type UnifiDevice,
} from "../../integrations/unifi/client.js";
import { HuduClient } from "../../integrations/hudu/client.js";

/**
 * Creed Bratton — UniFi Network Specialist
 *
 * "Quality Assurance"
 * Queries UniFi Site Manager API for site health, device status,
 * AP connectivity, and switch details. Cross-references with Hudu
 * documentation for network diagrams, passwords, and known issues.
 */

interface UnifiData {
  readonly site: UnifiSite | null;
  readonly devices: ReadonlyArray<UnifiDevice>;
}

interface HuduNetworkData {
  readonly networkAssets: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly fields: Record<string, unknown>;
  }>;
  readonly networkArticles: ReadonlyArray<{
    readonly name: string;
    readonly content: string;
  }>;
}

export class CreedBrattonAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the network infrastructure specialist. You have REAL data from UniFi Site Manager
and cross-referenced documentation from Hudu. Analyze network health, device status, and
connectivity to help troubleshoot network-related issues.

## What You Have Access To
- UniFi site health (WAN status, ISP info, latency, WiFi score)
- Device inventory (APs, switches, gateways — with status, model, firmware, uptime)
- Client counts and connectivity metrics
- Hudu network documentation (network diagrams, VLAN configs, WiFi passwords, known issues)

## Vendor Resources
- UniFi Network App: https://unifi.ui.com
- UniFi Help Center: https://help.ui.com
- UniFi Community: https://community.ui.com

## Common Network Fixes
### AP Issues (Disconnected / Poor Signal)
1. Check AP status in UniFi — is it showing offline? What was the last uptime?
2. Verify PoE is being delivered by the switch port (check switch port status)
3. Power cycle the AP via PoE toggle in UniFi or physical unplug
4. Check firmware version — recommend upgrade if outdated
5. If AP keeps disconnecting, check ethernet cable and switch port errors

### Slow WiFi / Connectivity Issues
1. Check WiFi score in UniFi — anything below 80% needs attention
2. Look at TX retry rate — high retries indicate interference or poor signal
3. Check client count per AP — overloaded APs need load balancing
4. Review channel utilization and consider changing channels
5. Check if DFS channels are causing issues (radar events)

### Switch Issues
1. Check port status — link speed, PoE output, errors
2. Look for CRC errors or packet drops on specific ports
3. Verify VLAN configuration matches expected setup
4. Check STP topology for loops

### Gateway / WAN Issues
1. Check WAN uptime and ISP status
2. Review latency metrics — anything over 50ms is concerning
3. Check ISP speed test results vs expected bandwidth
4. Look for failover events if dual-WAN is configured

## Your Job
1. Review ALL provided UniFi data carefully
2. Cross-reference with Hudu network documentation for this client
3. Identify devices relevant to the reported issue
4. Flag any offline devices, poor WiFi scores, or high latency
5. Suggest specific actions the tech should take in UniFi
6. Reference Hudu docs if relevant (network diagrams, VLAN configs, etc.)

## Output Format
Respond with ONLY valid JSON:
{
  "network_findings": "<comprehensive summary of ALL network findings>",
  "site_health": {"wan_status": "<status>", "latency_ms": <number|null>, "wifi_score": <number|null>, "isp": "<name|null>", "device_count": <number>, "offline_count": <number>, "client_count": <number>},
  "affected_devices": [{"name": "<device>", "type": "<AP/switch/gateway>", "model": "<model>", "status": "<online/offline>", "ip": "<ip>", "issue": "<description or null>"}],
  "hudu_context": "<relevant documentation found in Hudu, or null>",
  "recommendations": ["<actionable network recommendations with specific steps>"],
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real UniFi data + Hudu network docs in parallel
    const [unifiData, huduData] = await Promise.all([
      this.fetchUnifiData(context),
      this.fetchHuduNetworkData(context),
    ]);

    // 2. Build user message with real data
    const userMessage = this.buildUserMessage(context, unifiData, huduData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      unifiData.site
        ? `Found UniFi site "${unifiData.site.siteName}" (${unifiData.devices.length} devices). ${huduData.networkAssets.length > 0 ? `Cross-referenced with ${huduData.networkAssets.length} Hudu network assets.` : "No Hudu network assets found."}`
        : `Could not find client "${context.clientName}" in UniFi. ${huduData.networkAssets.length > 0 ? `Found ${huduData.networkAssets.length} network assets in Hudu.` : "Analyzing from ticket context only."}`,
    );

    // 4. Send to AI
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
      summary: (result.network_findings as string) ?? "Network analysis complete",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── UniFi Data Fetching ──────────────────────────────────────────────

  private async fetchUnifiData(context: TriageContext): Promise<UnifiData> {
    const empty: UnifiData = { site: null, devices: [] };

    const config = await this.getUnifiConfig();
    if (!config) return empty;

    const unifi = new UnifiClient(config);

    try {
      const site = await this.findSite(unifi, context.clientName, context.clientId);
      if (!site) return empty;

      const devices = await unifi.getDevicesByHost(site.hostId);

      return { site, devices };
    } catch (err) {
      console.error("[CREED] Failed to fetch UniFi data:", err);
      return empty;
    }
  }

  private async findSite(
    unifi: UnifiClient,
    clientName: string | null,
    clientId?: number | null,
  ): Promise<UnifiSite | null> {
    if (!clientName) return null;

    try {
      // 1. Check integration_mappings first
      let mapping: { external_id: string; external_name: string } | null = null;

      if (clientId) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "unifi")
          .eq("customer_id", String(clientId))
          .single();
        mapping = data;
      }

      if (!mapping) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "unifi")
          .ilike("customer_name", clientName)
          .single();
        mapping = data;
      }

      if (mapping) {
        const site = await unifi.getSiteByHostId(mapping.external_id);
        if (site) {
          console.log(
            `[CREED] Found UniFi site via mapping: "${mapping.external_name}" (hostId: ${mapping.external_id})`,
          );
          return site;
        }
      }

      // 2. Fallback: name matching across all sites
      const sites = await unifi.getSites();
      const normalize = (name: string) =>
        name
          .toLowerCase()
          .replace(/[,.\-_'"()]/g, " ")
          .replace(/\b(llc|inc|incorporated|corp|corporation|ltd|limited|co|company|the|group|services|solutions|enterprises|lp|pllc|pc|pa)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim();

      const normalizedClient = normalize(clientName);

      // Exact match
      const exact = sites.find((s) => normalize(s.siteName) === normalizedClient);
      if (exact) return exact;

      // Try host name match
      const hostMatch = sites.find((s) => normalize(s.hostName) === normalizedClient);
      if (hostMatch) return hostMatch;

      // Substring match
      const partial = sites.find((s) => {
        const n = normalize(s.siteName);
        const h = normalize(s.hostName);
        return n.includes(normalizedClient) || normalizedClient.includes(n) ||
               h.includes(normalizedClient) || normalizedClient.includes(h);
      });

      if (partial) {
        console.log(`[CREED] Matched UniFi site (partial): "${partial.siteName}" for "${clientName}"`);
        return partial;
      }

      // Word overlap
      const clientWords = normalizedClient.split(" ").filter((w) => w.length > 2);
      if (clientWords.length > 0) {
        let bestMatch: UnifiSite | null = null;
        let bestScore = 0;
        for (const site of sites) {
          const siteWords = normalize(site.siteName).split(" ").filter((w) => w.length > 2);
          const overlap = clientWords.filter((w) => siteWords.includes(w)).length;
          const score = overlap / Math.max(clientWords.length, siteWords.length);
          if (overlap >= 2 && score > bestScore) {
            bestScore = score;
            bestMatch = site;
          }
        }
        if (bestMatch && bestScore >= 0.5) {
          console.log(`[CREED] Matched UniFi site (word overlap ${Math.round(bestScore * 100)}%): "${bestMatch.siteName}"`);
          return bestMatch;
        }
      }

      console.log(`[CREED] No UniFi site match for "${clientName}" across ${sites.length} sites`);
      return null;
    } catch (err) {
      console.error("[CREED] Site search failed:", err);
      return null;
    }
  }

  // ── Hudu Cross-Reference ────────────────────────────────────────────

  private async fetchHuduNetworkData(context: TriageContext): Promise<HuduNetworkData> {
    const empty: HuduNetworkData = { networkAssets: [], networkArticles: [] };
    if (!context.clientName) return empty;

    const config = await this.getHuduConfig();
    if (!config) return empty;

    const hudu = new HuduClient(config);

    try {
      const companies = await hudu.searchCompanies(context.clientName);
      if (companies.length === 0) return empty;

      const companyId = companies[0].id;

      // Fetch network-related assets and articles in parallel
      const [assets, articles] = await Promise.all([
        hudu.getAssets({ company_id: companyId, page_size: 100 }),
        hudu.getArticles({ company_id: companyId }),
      ]);

      // Filter for network-related assets
      const networkKeywords = [
        "network", "switch", "router", "gateway", "firewall", "ap",
        "access point", "unifi", "ubiquiti", "vlan", "wifi", "wireless",
        "ethernet", "poe", "uplink", "wan", "lan", "dhcp", "dns",
      ];

      const networkAssets = assets
        .filter((a) => {
          const text = `${a.name} ${a.asset_type ?? ""}`.toLowerCase();
          return networkKeywords.some((kw) => text.includes(kw));
        })
        .slice(0, 20)
        .map((a) => ({
          name: a.name,
          type: a.asset_type ?? "Unknown",
          fields: a.fields ?? {},
        }));

      // Filter for network-related articles
      const networkArticles = articles
        .filter((a) => {
          const text = `${a.name} ${a.content ?? ""}`.toLowerCase();
          return networkKeywords.some((kw) => text.includes(kw));
        })
        .slice(0, 5)
        .map((a) => ({
          name: a.name,
          content: (a.content ?? "").substring(0, 500), // Truncate for token efficiency
        }));

      return { networkAssets, networkArticles };
    } catch (err) {
      console.error("[CREED] Hudu cross-reference failed:", err);
      return empty;
    }
  }

  // ── Config Helpers ──────────────────────────────────────────────────

  private async getUnifiConfig(): Promise<UnifiConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "unifi")
      .eq("is_active", true)
      .single();
    return data ? (data.config as UnifiConfig) : null;
  }

  private async getHuduConfig(): Promise<HuduConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "hudu")
      .eq("is_active", true)
      .single();
    return data ? (data.config as HuduConfig) : null;
  }

  // ── User Message Builder ────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    unifiData: UnifiData,
    huduData: HuduNetworkData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      context.details ? `**Description:** ${context.details}` : "",
      context.clientName ? `**Client:** ${context.clientName}` : "",
      context.userName ? `**Reported By:** ${context.userName}` : "",
    ];

    // UniFi site data
    if (unifiData.site) {
      const s = unifiData.site;
      const stats = s.statistics;
      sections.push(
        "",
        "## UniFi Site Data (REAL)",
        `**Site:** ${s.siteName}`,
        `**Host:** ${s.hostName}`,
        `**Online:** ${s.isOnline ? "Yes" : "NO — OFFLINE"}`,
      );

      if (stats?.counts) {
        sections.push(
          `**Devices:** ${stats.counts.totalDevice ?? "?"} total, ${stats.counts.offlineDevice ?? 0} offline`,
          `**Active Clients:** ${stats.counts.activeClient ?? "?"}`,
        );
      }
      if (stats?.percentages) {
        if (stats.percentages.wifiScore != null) {
          sections.push(`**WiFi Score:** ${stats.percentages.wifiScore}%`);
        }
        if (stats.percentages.txRetry != null) {
          sections.push(`**TX Retry Rate:** ${stats.percentages.txRetry}%`);
        }
      }
      if (stats?.averages?.latency != null) {
        sections.push(`**Latency:** ${stats.averages.latency}ms`);
      }
      if (stats?.isp) {
        sections.push(
          `**ISP:** ${stats.isp.name ?? "Unknown"} (↓${stats.isp.download ?? "?"}Mbps / ↑${stats.isp.upload ?? "?"}Mbps)`,
        );
      }

      // Device inventory
      if (unifiData.devices.length > 0) {
        sections.push("", "### Device Inventory");

        const deviceTypes: Record<string, string> = {
          uap: "Access Point",
          usw: "Switch",
          ugw: "Gateway",
          uxg: "Gateway",
          udm: "Dream Machine",
          ulte: "LTE Backup",
        };

        for (const d of unifiData.devices) {
          const typeName = deviceTypes[d.type] ?? d.type;
          const uptimeStr = d.uptimeSeconds
            ? `${Math.floor(d.uptimeSeconds / 86400)}d ${Math.floor((d.uptimeSeconds % 86400) / 3600)}h`
            : "unknown";
          const statusIcon = d.status === "online" ? "✅" : "❌";
          sections.push(
            `- ${statusIcon} **${d.name}** (${typeName}, ${d.model}) — ${d.status} | IP: ${d.ip || "N/A"} | FW: ${d.firmwareVersion ?? "?"} | Uptime: ${uptimeStr}`,
          );
        }
      }
    } else {
      sections.push(
        "",
        `**Note:** UniFi site not found for client "${context.clientName}". Analyze based on ticket context and Hudu documentation.`,
      );
    }

    // Hudu cross-reference data
    if (huduData.networkAssets.length > 0 || huduData.networkArticles.length > 0) {
      sections.push("", "## Hudu Network Documentation (Cross-Reference)");

      if (huduData.networkAssets.length > 0) {
        sections.push("### Network Assets");
        for (const asset of huduData.networkAssets) {
          const fieldStr = Object.entries(asset.fields)
            .filter(([, v]) => v != null && v !== "")
            .slice(0, 5)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | ");
          sections.push(`- **${asset.name}** (${asset.type})${fieldStr ? ` — ${fieldStr}` : ""}`);
        }
      }

      if (huduData.networkArticles.length > 0) {
        sections.push("### Relevant Documentation");
        for (const article of huduData.networkArticles) {
          sections.push(`- **${article.name}:** ${article.content}`);
        }
      }
    }

    return sections.filter(Boolean).join("\n");
  }
}
