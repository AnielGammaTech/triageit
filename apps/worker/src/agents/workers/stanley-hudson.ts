import type { MemoryMatch, VultrConfig } from "@triageit/shared";
import { extractResponseText } from "../llm-text.js";
import { BaseAgent, type AgentResult, type SystemBlocks } from "../base-agent.js";
import { logCacheUsage } from "../cache-metrics.js";
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
  // true = no Vultr integration_mapping exists for this client, so the shared
  // Vultr account was NOT queried — empty arrays here mean "unknown", not
  // "this client has no cloud infrastructure". Dumping the whole account
  // instead would leak another client's servers/DNS/firewall rules.
  readonly unmapped?: boolean;
  // true = the Vultr API (or the mapping lookup) errored — empty arrays do NOT
  // mean the client has no infrastructure or that everything is healthy.
  readonly lookupFailed?: boolean;
}

/** Resolved scope for a single client's Vultr resources. */
interface VultrScope {
  readonly externalId: string;
  readonly externalName: string;
  // Lowercased match tokens (external id + name) used to filter account-wide
  // Vultr resources down to this client's instances/domains/firewalls.
  readonly tokens: ReadonlyArray<string>;
}

export class StanleyHudsonAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the cloud infrastructure expert. You have REAL data from Vultr (the cloud platform).
Analyze the provided Vultr data to find anything relevant to the reported issue.
Your audience is IT technicians — be specific, technical, and actionable.

## What You Have Access To
- Cloud Instances (servers — status, IP, region, OS, resources)
- DNS Domains and Records (A, MX, CNAME, TXT records)
- Firewall Groups and Rules
- Backup Status

## Vendor Resources
- Vultr Documentation: https://docs.vultr.com/
- Vultr Instance Management: https://docs.vultr.com/vultr-cloud-compute
- Vultr Firewall Guide: https://docs.vultr.com/vultr-firewall
- Vultr DNS Guide: https://docs.vultr.com/introduction-to-vultr-dns
- Vultr Backup & Snapshots: https://docs.vultr.com/vultr-backups
- Vultr Status Page: https://status.vultr.com/
- Vultr API Reference: https://www.vultr.com/api/

## Common Fixes
### Server Unreachable / SSH Connection Refused
1. Check instance power status in Vultr Console — restart if stopped
2. Use Vultr Web Console (VNC) to access the server if SSH is down: Vultr Dashboard > Instance > View Console
3. Check if SSH service is running: \`systemctl status sshd\` via web console
4. Verify SSH port (default 22) is open in Vultr Firewall and OS-level firewall (\`iptables -L\` or \`ufw status\`)
5. Check \`/var/log/auth.log\` for SSH authentication failures or brute-force lockouts
6. If fail2ban is installed, check banned IPs: \`fail2ban-client status sshd\` — unban with \`fail2ban-client set sshd unbanip <IP>\`
7. Verify security group / Vultr Firewall rules allow inbound TCP 22 from the tech's IP
8. Ref: https://docs.vultr.com/how-to-troubleshoot-ssh-connectivity-issues

### Firewall / Port Blocking Issues
1. Review Vultr Firewall rules: Vultr Dashboard > Products > Firewall > select group
2. Ensure required ports are open: 22 (SSH), 80/443 (HTTP/S), 3306 (MySQL), 5432 (PostgreSQL)
3. Check OS-level firewall: \`ufw status verbose\` (Ubuntu) or \`firewall-cmd --list-all\` (CentOS/RHEL)
4. For web traffic issues: \`curl -I http://server-ip\` to test HTTP response
5. Test specific port connectivity: \`nc -zv <ip> <port>\` or \`telnet <ip> <port>\`
6. Ref: https://docs.vultr.com/vultr-firewall

### DNS Resolution Problems
1. Verify DNS records in Vultr DNS: Vultr Dashboard > Products > DNS > select domain
2. Check A record points to the correct instance IP
3. Verify DNS propagation: \`dig @8.8.8.8 domain.com A\` or use https://dnschecker.org/
4. Check TTL values — high TTLs (86400s) slow down propagation after changes
5. For email issues, verify MX records point to mail provider (not the Vultr instance unless self-hosted)
6. Ensure NS records at the registrar delegate to Vultr nameservers (ns1.vultr.com, ns2.vultr.com) if using Vultr DNS

### High Resource Usage / Performance Issues
1. Check server resources via SSH: \`top\` or \`htop\` for CPU/memory, \`df -h\` for disk
2. Check bandwidth usage in Vultr Dashboard > Instance > Bandwidth tab
3. If disk is full: find large files with \`du -sh /* | sort -rh | head -20\`
4. Review running processes: \`ps aux --sort=-%mem | head -20\`
5. Check for runaway processes or cron jobs: \`crontab -l\` and \`systemctl list-timers\`
6. Consider upgrading instance plan if resource limits are hit consistently
7. Ref: https://docs.vultr.com/how-to-monitor-server-resources

### Backup & Recovery
1. Check backup schedule in Vultr Dashboard > Instance > Backups tab
2. Enable automatic backups if not configured (small additional cost)
3. Take manual snapshot before major changes: Vultr Dashboard > Instance > Snapshots
4. To restore from backup: Create new instance from backup or snapshot
5. Ref: https://docs.vultr.com/vultr-backups

## Your Job
1. Review ALL provided Vultr data carefully
2. Check if any instances are down or degraded
3. Verify DNS records are correctly configured
4. Review firewall rules for potential blocking issues
5. Check backup status and recency
6. Look for resource constraints (bandwidth, CPU, disk)
7. Suggest specific troubleshooting commands the tech should run on the server
8. Include relevant documentation links from https://docs.vultr.com/ in your cloud_notes

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
    systemBlocks: SystemBlocks,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real Vultr data
    const vultrData = await this.fetchVultrData(context);

    // 2. Build rich user message
    const userMessage = this.buildUserMessage(context, vultrData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      vultrData.lookupFailed
        ? `⚠ Vultr lookup FAILED — cloud data unavailable for "${context.clientName}". Analyzing from ticket context only.`
        : vultrData.unmapped
          ? `No Vultr mapping for "${context.clientName}" — shared account not queried (avoids cross-client leak). Analyzing from ticket context only.`
          : `Vultr data (scoped to "${context.clientName}"): ${vultrData.instances.length} instances, ${vultrData.domains.length} domains, ${vultrData.firewallGroups.length} firewall groups, ${vultrData.backups.length} backups. Analyzing cloud infrastructure now.`,
    );

    // 4. Send everything to the AI
    const response = await this.anthropic.messages.create({
      model: this.getModel(),
      max_tokens: 3072,
      system: systemBlocks,
      messages: [{ role: "user", content: userMessage }],
    });
    logCacheUsage(`stanley:${this.getModel()}`, response.usage);

    const text =
      extractResponseText(response, "{}");
    const result = parseLlmJson<Record<string, unknown>>(text);

    return {
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
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

    // Vultr is a single shared account holding EVERY client's cloud infra.
    // We must scope to THIS client via integration_mappings before any data
    // reaches the prompt — otherwise client A's ticket gets client B's server
    // IPs, DNS zones, and firewall rules (cross-client data leak).
    let scope: VultrScope | null;
    try {
      scope = await this.resolveVultrScope(context);
    } catch (error) {
      console.error("[STANLEY] Vultr mapping lookup failed:", error);
      return { ...emptyResult, lookupFailed: true };
    }

    // No mapping → do NOT query the shared account. Return empty+unmapped so
    // buildUserMessage states Vultr is not mapped rather than listing another
    // client's infrastructure.
    if (!scope) {
      console.log(
        `[STANLEY] No Vultr mapping for "${context.clientName}" — skipping shared account to avoid cross-client leak`,
      );
      return { ...emptyResult, unmapped: true };
    }

    const vultr = new VultrClient(config);

    try {
      // getInstances() is the canonical failure signal: an expired/invalid key
      // rejects here → caught below → lookupFailed. Domains/firewalls stay
      // tolerant so a partial outage still yields scoped instance data.
      const [instances, domains, firewallGroups] = await Promise.all([
        vultr.getInstances(),
        this.fetchDomains(vultr),
        this.fetchFirewalls(vultr),
      ]);

      // Filter account-wide resources down to THIS client's scope.
      const scoped = this.scopeToClient(scope, instances, domains, firewallGroups);

      // Fetch dependent data only for the already-scoped resources.
      const [dnsRecords, firewallRules, backups] = await Promise.all([
        this.fetchDnsRecords(vultr, scoped.domains),
        this.fetchFirewallRules(vultr, scoped.firewallGroups),
        this.fetchBackupsForInstances(vultr, scoped.instances),
      ]);

      return {
        instances: scoped.instances,
        domains: scoped.domains,
        dnsRecords,
        firewallGroups: scoped.firewallGroups,
        firewallRules,
        backups,
      };
    } catch (error) {
      // API failure ≠ "no infrastructure" — flag it so Stanley does not
      // conclude the cloud is healthy.
      console.error("[STANLEY] Vultr data fetch failed:", error);
      return { ...emptyResult, lookupFailed: true };
    }
  }

  /**
   * Resolve this client's Vultr scope from integration_mappings
   * (service='vultr'), mirroring how other specialists resolve a customer
   * mapping — customer_id first, then case-insensitive customer_name.
   * Returns null when the client has no Vultr mapping.
   */
  private async resolveVultrScope(
    context: TriageContext,
  ): Promise<VultrScope | null> {
    if (!context.clientName && !context.clientId) return null;

    let mapping: { external_id: string; external_name: string } | null = null;

    if (context.clientId) {
      const { data } = await this.supabase
        .from("integration_mappings")
        .select("external_id, external_name")
        .eq("service", "vultr")
        .eq("customer_id", String(context.clientId))
        .limit(1)
        .maybeSingle();
      mapping = data;
    }

    if (!mapping && context.clientName) {
      const { data } = await this.supabase
        .from("integration_mappings")
        .select("external_id, external_name")
        .eq("service", "vultr")
        .ilike("customer_name", context.clientName)
        .limit(1)
        .maybeSingle();
      mapping = data;
    }

    if (!mapping) return null;

    const tokens = [mapping.external_id, mapping.external_name]
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0);

    if (tokens.length === 0) return null;

    console.log(
      `[STANLEY] Scoping Vultr to mapping "${mapping.external_name}" (external_id: ${mapping.external_id})`,
    );

    return {
      externalId: mapping.external_id,
      externalName: mapping.external_name,
      tokens,
    };
  }

  /**
   * Filter account-wide Vultr resources down to a single client's scope.
   * Vultr has no strict per-customer field, so we match on the mapping's
   * external id/name against instance id/label/hostname/tag(s), firewall
   * group attachment or description, and domain name. Backups are fetched
   * per scoped instance separately.
   */
  private scopeToClient(
    scope: VultrScope,
    instances: ReadonlyArray<VultrInstance>,
    domains: ReadonlyArray<VultrDomain>,
    firewallGroups: ReadonlyArray<VultrFirewallGroup>,
  ): {
    instances: ReadonlyArray<VultrInstance>;
    domains: ReadonlyArray<VultrDomain>;
    firewallGroups: ReadonlyArray<VultrFirewallGroup>;
  } {
    const matchesToken = (value: unknown): boolean => {
      if (typeof value !== "string" || value.length === 0) return false;
      const v = value.toLowerCase();
      return scope.tokens.some((t) => v === t || v.includes(t) || t.includes(v));
    };

    const scopedInstances = instances.filter((inst) => {
      const tagValues: string[] = [];
      if (typeof inst.tag === "string") tagValues.push(inst.tag);
      if (Array.isArray(inst.tags)) {
        for (const t of inst.tags) {
          if (typeof t === "string") tagValues.push(t);
        }
      }
      return (
        matchesToken(inst.id) ||
        matchesToken(inst.label) ||
        matchesToken(inst.hostname) ||
        tagValues.some(matchesToken)
      );
    });

    // Firewall groups attached to a scoped instance (or matching by description)
    const scopedGroupIds = new Set(
      scopedInstances
        .map((i) => i.firewall_group_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const scopedFirewallGroups = firewallGroups.filter(
      (g) => (g.id != null && scopedGroupIds.has(g.id)) || matchesToken(g.description),
    );

    // Domains the client owns — matched by zone name against the scope tokens.
    const scopedDomains = domains.filter((d) => matchesToken(d.domain));

    return {
      instances: scopedInstances,
      domains: scopedDomains,
      firewallGroups: scopedFirewallGroups,
    };
  }

  private async fetchDomains(
    vultr: VultrClient,
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

  private async fetchBackupsForInstances(
    vultr: VultrClient,
    instances: ReadonlyArray<VultrInstance>,
  ): Promise<ReadonlyArray<VultrBackup>> {
    // Scope backups to the client's instances — the account-wide backup list
    // would surface other clients' backup metadata.
    const withId = instances.filter(
      (i) => typeof i.id === "string" && i.id.length > 0,
    );
    if (withId.length === 0) return [];

    try {
      const results = await Promise.allSettled(
        withId.slice(0, 20).map((i) => vultr.getBackups(i.id as string)),
      );

      return results
        .filter(
          (r): r is PromiseFulfilledResult<ReadonlyArray<VultrBackup>> =>
            r.status === "fulfilled",
        )
        .flatMap((r) => r.value);
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
    } else if (vultrData.lookupFailed) {
      sections.push("");
      sections.push(
        "**⚠ Vultr lookup FAILED** — live cloud data unavailable (API error or expired key). State this in your findings; do NOT conclude the client has no cloud infrastructure or that everything is healthy. Analyze from ticket context only.",
      );
    } else if (vultrData.unmapped) {
      sections.push("");
      sections.push(
        `**Note:** Vultr is not mapped for client "${context.clientName ?? "this client"}" — cloud infrastructure data is unavailable for this client. Do NOT assume they have no Vultr infrastructure; there is simply no mapping to scope their resources. Analyze from ticket context only.`,
      );
    } else {
      sections.push("");
      sections.push(
        "**Note:** No matching Vultr resources found for this client. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}
