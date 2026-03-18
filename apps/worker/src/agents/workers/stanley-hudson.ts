import type { MemoryMatch, VultrConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  VultrClient,
  type VultrInstance,
  type VultrDomain,
  type VultrDnsRecord,
  type VultrFirewallGroup,
  type VultrFirewallRule,
  type VultrBackup,
} from "../../integrations/vultr/client.js";

/**
 * Stanley Hudson — Cloud Infrastructure (Vultr)
 *
 * Queries real Vultr data: instance status, DNS records,
 * firewall rules, bandwidth, and backup status.
 */

interface VultrData {
  readonly instances: ReadonlyArray<VultrInstance>;
  readonly domains: ReadonlyArray<VultrDomain>;
  readonly dnsRecords: ReadonlyArray<{ domain: string; records: ReadonlyArray<VultrDnsRecord> }>;
  readonly firewallGroups: ReadonlyArray<VultrFirewallGroup>;
  readonly firewallRules: ReadonlyArray<{ groupId: string; rules: ReadonlyArray<VultrFirewallRule> }>;
  readonly backups: ReadonlyArray<VultrBackup>;
}

export class StanleyHudsonAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the cloud infrastructure expert. You have REAL data from Vultr (the cloud platform).
Analyze the provided Vultr data to find anything relevant to the reported issue.

## What You Have Access To
- Cloud Instances (servers — status, IP, region, OS, resources)
- DNS Domains and Records (A, MX, CNAME, TXT records)
- Firewall Groups and Rules
- Backup Status

## Your Job
1. Review ALL provided Vultr data carefully
2. Check if any instances are down or degraded
3. Verify DNS records are correctly configured
4. Review firewall rules for potential blocking issues
5. Check backup status and recency
6. Look for resource constraints (bandwidth, CPU, disk)

## Output Format
Respond with ONLY valid JSON:
{
  "instances": [{"label": "<name>", "status": "<running/stopped/pending>", "ip": "<ip>", "region": "<region>", "os": "<os>", "resources": "<vcpu/ram/disk>", "relevance": "<why relevant>"}],
  "dns_records": [{"domain": "<domain>", "type": "<A/MX/CNAME/TXT>", "value": "<value>", "issue": "<any issue found or null>"}],
  "firewall_notes": "<summary of firewall configuration and any concerns>",
  "backup_status": "<backup recency and status>",
  "resource_usage": "<any resource concerns>",
  "cloud_notes": "<comprehensive summary of ALL cloud infrastructure findings>",
  "infrastructure_healthy": <true/false>,
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real Vultr data
    const vultrData = await this.fetchVultrData(context);

    // 2. Build rich user message
    const userMessage = this.buildUserMessage(context, vultrData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      `Vultr data retrieved: ${vultrData.instances.length} instances, ${vultrData.domains.length} domains, ${vultrData.firewallGroups.length} firewall groups, ${vultrData.backups.length} backups. Analyzing cloud infrastructure now.`,
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
      summary: (result.cloud_notes as string) ?? "No cloud data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Vultr Data Fetching ─────────────────────────────────────────────

  private async fetchVultrData(context: TriageContext): Promise<VultrData> {
    const emptyResult: VultrData = {
      instances: [],
      domains: [],
      dnsRecords: [],
      firewallGroups: [],
      firewallRules: [],
      backups: [],
    };

    const config = await this.getVultrConfig();
    if (!config) return emptyResult;

    const vultr = new VultrClient(config);

    // Fetch all data in parallel
    const [instances, domains, firewallGroups, backups] = await Promise.all([
      this.fetchInstances(vultr, context),
      this.fetchDomains(vultr, context),
      this.fetchFirewalls(vultr),
      this.fetchBackups(vultr),
    ]);

    // Fetch DNS records for relevant domains
    const dnsRecords = await this.fetchDnsRecords(vultr, domains);

    // Fetch firewall rules for each group
    const firewallRules = await this.fetchFirewallRules(vultr, firewallGroups);

    return {
      instances,
      domains,
      dnsRecords,
      firewallGroups,
      firewallRules,
      backups,
    };
  }

  private async fetchInstances(
    vultr: VultrClient,
    _context: TriageContext,
  ): Promise<ReadonlyArray<VultrInstance>> {
    try {
      return await vultr.getInstances();
    } catch (error) {
      console.error("[STANLEY] Failed to fetch Vultr instances:", error);
      return [];
    }
  }

  private async fetchDomains(
    vultr: VultrClient,
    _context: TriageContext,
  ): Promise<ReadonlyArray<VultrDomain>> {
    try {
      return await vultr.getDomains();
    } catch (error) {
      console.error("[STANLEY] Failed to fetch Vultr domains:", error);
      return [];
    }
  }

  private async fetchDnsRecords(
    vultr: VultrClient,
    domains: ReadonlyArray<VultrDomain>,
  ): Promise<ReadonlyArray<{ domain: string; records: ReadonlyArray<VultrDnsRecord> }>> {
    try {
      const results = await Promise.allSettled(
        domains.slice(0, 10).map(async (d) => ({
          domain: d.domain ?? "",
          records: await vultr.getDomainRecords(d.domain ?? ""),
        })),
      );

      return results
        .filter((r): r is PromiseFulfilledResult<{ domain: string; records: ReadonlyArray<VultrDnsRecord> }> => r.status === "fulfilled")
        .map((r) => r.value);
    } catch {
      return [];
    }
  }

  private async fetchFirewalls(
    vultr: VultrClient,
  ): Promise<ReadonlyArray<VultrFirewallGroup>> {
    try {
      return await vultr.getFirewallGroups();
    } catch (error) {
      console.error("[STANLEY] Failed to fetch Vultr firewalls:", error);
      return [];
    }
  }

  private async fetchFirewallRules(
    vultr: VultrClient,
    groups: ReadonlyArray<VultrFirewallGroup>,
  ): Promise<ReadonlyArray<{ groupId: string; rules: ReadonlyArray<VultrFirewallRule> }>> {
    try {
      const results = await Promise.allSettled(
        groups.map(async (g) => ({
          groupId: g.id ?? "",
          rules: await vultr.getFirewallRules(g.id ?? ""),
        })),
      );

      return results
        .filter((r): r is PromiseFulfilledResult<{ groupId: string; rules: ReadonlyArray<VultrFirewallRule> }> => r.status === "fulfilled")
        .map((r) => r.value);
    } catch {
      return [];
    }
  }

  private async fetchBackups(
    vultr: VultrClient,
  ): Promise<ReadonlyArray<VultrBackup>> {
    try {
      return await vultr.getBackups();
    } catch (error) {
      console.error("[STANLEY] Failed to fetch Vultr backups:", error);
      return [];
    }
  }

  private async getVultrConfig(): Promise<VultrConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "vultr")
      .eq("is_active", true)
      .single();

    return data ? (data.config as VultrConfig) : null;
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    vultrData: VultrData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    const hasData = vultrData.instances.length > 0 || vultrData.domains.length > 0;

    if (hasData) {
      sections.push("");
      sections.push("---");
      sections.push("## Vultr Cloud Infrastructure Data");

      // Instances
      if (vultrData.instances.length > 0) {
        sections.push("");
        sections.push(`### Instances (${vultrData.instances.length})`);
        for (const inst of vultrData.instances) {
          const status = inst.power_status === "running" ? "🟢 Running" : "🔴 Stopped";
          sections.push(
            `- **${inst.label ?? inst.hostname ?? "Unnamed"}** — ${status} | IP: ${inst.main_ip ?? "N/A"} | Region: ${inst.region ?? "N/A"} | OS: ${inst.os ?? "N/A"} | vCPU: ${inst.vcpu_count ?? "N/A"} | RAM: ${inst.ram ?? "N/A"}MB | Disk: ${inst.disk ?? "N/A"}GB`,
          );
        }
      }

      // DNS Records
      if (vultrData.dnsRecords.length > 0) {
        sections.push("");
        sections.push("### DNS Records");
        for (const { domain, records } of vultrData.dnsRecords) {
          sections.push(`**${domain}** (${records.length} records)`);
          for (const rec of records.slice(0, 20)) {
            sections.push(
              `  - ${rec.type ?? "?"} | ${rec.name ?? "@"} → ${rec.data ?? "N/A"} (TTL: ${rec.ttl ?? "N/A"})`,
            );
          }
        }
      }

      // Firewalls
      if (vultrData.firewallRules.length > 0) {
        sections.push("");
        sections.push("### Firewall Rules");
        for (const { groupId, rules } of vultrData.firewallRules) {
          const group = vultrData.firewallGroups.find((g) => g.id === groupId);
          sections.push(
            `**${group?.description ?? groupId}** (${rules.length} rules)`,
          );
          for (const rule of rules.slice(0, 15)) {
            sections.push(
              `  - ${rule.action ?? "accept"} ${rule.protocol ?? "any"} port ${rule.port ?? "all"} from ${rule.subnet ?? "any"}/${rule.subnet_size ?? 0} ${rule.notes ? `(${rule.notes})` : ""}`,
            );
          }
        }
      }

      // Backups
      if (vultrData.backups.length > 0) {
        sections.push("");
        sections.push(`### Backups (${vultrData.backups.length})`);
        for (const backup of vultrData.backups.slice(0, 10)) {
          sections.push(
            `- ${backup.description ?? "Backup"} — Status: ${backup.status ?? "N/A"} | Created: ${backup.date_created ?? "N/A"} | Size: ${backup.size ?? "N/A"}`,
          );
        }
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No Vultr data available. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}
