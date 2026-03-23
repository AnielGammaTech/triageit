import type { MemoryMatch, CoveConfig, UnitrendsConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  UnitrendsClient,
  type UnitrendsDevice,
  type UnitrendsBackupJob,
} from "../../integrations/unitrends/client.js";

/**
 * Oscar Martinez — Backup & Recovery Specialist (Cove + Unitrends)
 *
 * Queries Cove Data Protection (N-able) via JSON-RPC API and Unitrends
 * (Kaseya) via REST API for backup device status, job history, errors,
 * and protection coverage. Provides quicklinks for techs.
 */

// ── Cove API Types ──────────────────────────────────────────────────

interface CoveSession {
  readonly visa: string;
}

interface CoveDeviceStatistic {
  readonly AccountId: number;
  readonly AccountName: string;
  readonly DeviceName: string;
  readonly ComputerName: string;
  readonly OsType: string;
  readonly CustomerName: string;
  readonly Status: string;
  readonly LastSessionTimestamp: number;
  readonly LastSuccessfulSessionTimestamp: number;
  readonly Errors: number;
  readonly SelectedSize: number;
  readonly UsedStorage: number;
  readonly DataSources: string;
  readonly ProtectedData: string;
  readonly UnprotectedData: string;
}

interface CoveData {
  readonly devices: ReadonlyArray<CoveDeviceStatistic>;
  readonly matchedDevice: CoveDeviceStatistic | null;
  readonly healthySummary: {
    readonly totalDevices: number;
    readonly healthyDevices: number;
    readonly errorDevices: number;
    readonly unprotectedDevices: number;
  };
}

interface UnitrendsData {
  readonly devices: ReadonlyArray<UnitrendsDevice>;
  readonly recentJobs: ReadonlyArray<UnitrendsBackupJob>;
  readonly customerName: string | null;
  readonly healthySummary: {
    readonly totalDevices: number;
    readonly healthyDevices: number;
    readonly failingDevices: number;
    readonly alertDevices: number;
  };
}

const EMPTY_COVE_DATA: CoveData = {
  devices: [],
  matchedDevice: null,
  healthySummary: { totalDevices: 0, healthyDevices: 0, errorDevices: 0, unprotectedDevices: 0 },
};

const EMPTY_UNITRENDS_DATA: UnitrendsData = {
  devices: [],
  recentJobs: [],
  customerName: null,
  healthySummary: { totalDevices: 0, healthyDevices: 0, failingDevices: 0, alertDevices: 0 },
};

// ── Quicklink Types ────────────────────────────────────────────────

export interface BackupQuicklink {
  readonly label: string;
  readonly url: string;
}

// ── KB Reference URLs ──────────────────────────────────────────────

const COVE_KB_REFERENCES: ReadonlyArray<{ readonly topic: string; readonly url: string }> = [
  { topic: "Cove Data Protection Overview", url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/cove-data-protection.htm" },
  { topic: "Backup Manager Error Codes", url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/json-api/error-codes.htm" },
  { topic: "Recovery Console Guide", url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/recovery-console.htm" },
  { topic: "Backup Schedule Configuration", url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/backup-schedule.htm" },
];

const UNITRENDS_KB_REFERENCES: ReadonlyArray<{ readonly topic: string; readonly url: string }> = [
  { topic: "Unitrends Recovery Series", url: "https://www.unitrends.com/products/enterprise-backup-software" },
  { topic: "Unitrends KB & Support", url: "https://helpdesk.kaseya.com/hc/en-gb/categories/360002175178-Unitrends" },
];

// ── Agent Class ─────────────────────────────────────────────────────

export class OscarMartinezAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the Backup & Recovery Specialist. You have REAL data from Cove Data Protection (N-able) and/or Unitrends (Kaseya).
Analyze backup data to assess reported issues, identify affected devices, and provide recovery guidance.

## What You Have Access To
- Cove: Device backup statistics, data sources, storage, errors
- Unitrends: Device status, backup jobs, alerts, recovery points
- Both: Customer-level device overview and health summaries

## Cove Backup Types
- Files & Folders, System State, MS SQL, VMware, Hyper-V, Exchange, SharePoint

## Common Errors and Fixes
- **"Backup overdue"**: Device not backing up on schedule — check power, agent status
- **"VSS error"**: Volume Shadow Copy failed — check disk space, restart VSS writers
- **"Connection failed"**: Can't reach cloud — check firewall 443/TCP, DNS
- **"Insufficient disk space"**: Free space on backup drive or adjust LocalSpeedVaultPath
- **"Authentication error"**: Re-register device or update passphrase
- **"Integrity check failed"**: Run deep verification, may need re-seed
- **"SLA violation"** (Unitrends): Backup didn't complete within SLA window
- **"Replication lag"** (Unitrends): Off-site replication behind — check bandwidth

## Recovery Procedures
- **Cove File Restore**: Recovery Console > select point-in-time > choose files
- **Cove Bare Metal**: Boot recovery ISO > connect to cloud > restore to disk
- **Unitrends Instant Recovery**: Spin up VM directly from backup image
- **Unitrends File-Level**: Browse backup > select files > restore to original or alternate location

## Output Format
Respond with ONLY valid JSON:
{
  "backup_status": "<HEALTHY/DEGRADED/FAILING/UNKNOWN>",
  "devices_summary": "<X protected, Y with errors, Z unprotected>",
  "affected_device": "<device name or null if none identified>",
  "error_analysis": "<detailed analysis of the backup error and its meaning>",
  "recommended_actions": ["<specific action items for the tech>"],
  "recovery_guidance": "<step-by-step recovery instructions if applicable>",
  "kb_references": ["<links to relevant documentation>"],
  "quicklinks": [{"label": "<display text>", "url": "<link>"}],
  "backup_notes": "<comprehensive backup assessment with all findings>",
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    const ticketText = `${context.summary} ${context.details ?? ""}`;
    const deviceName = extractDeviceName(ticketText);
    const errorKeyword = extractBackupErrorKeyword(ticketText);

    await this.logThinking(
      context.ticketId,
      `Analyzing backup issue for ticket #${context.haloId}. ${deviceName ? `Device: ${deviceName}.` : ""} ${errorKeyword ? `Error keyword: ${errorKeyword}.` : ""} Querying backup APIs...`,
    );

    // Fetch from both Cove and Unitrends in parallel
    const [coveData, unitrendsData] = await Promise.all([
      this.fetchCoveData(context, deviceName),
      this.fetchUnitrendsData(context),
    ]);

    const userMessage = this.buildUserMessage(
      context,
      coveData,
      unitrendsData,
      deviceName,
      errorKeyword,
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

    const backupStatus = (result.backup_status as string) ?? "UNKNOWN";
    const totalDevices =
      coveData.healthySummary.totalDevices +
      unitrendsData.healthySummary.totalDevices;

    await this.logThinking(
      context.ticketId,
      `Backup analysis complete. Status: ${backupStatus}. Cove: ${coveData.healthySummary.totalDevices} devices. Unitrends: ${unitrendsData.healthySummary.totalDevices} devices. Total: ${totalDevices}.`,
    );

    // Build quicklinks from both sources
    const quicklinks = this.buildQuicklinks(coveData, unitrendsData, result);

    return {
      summary: (result.backup_notes as string) ?? "No backup data available",
      data: { ...result, quicklinks },
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Quicklinks Builder ──────────────────────────────────────────────

  private buildQuicklinks(
    coveData: CoveData,
    unitrendsData: UnitrendsData,
    _llmResult: Record<string, unknown>,
  ): ReadonlyArray<BackupQuicklink> {
    const links: BackupQuicklink[] = [];

    // Cove quicklinks
    if (coveData.healthySummary.totalDevices > 0) {
      links.push({
        label: "Cove Backup Dashboard",
        url: "https://backup.management",
      });
      if (coveData.healthySummary.errorDevices > 0) {
        links.push({
          label: "Cove Error Codes Reference",
          url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/json-api/error-codes.htm",
        });
      }
    }

    // Unitrends quicklinks
    if (unitrendsData.healthySummary.totalDevices > 0) {
      links.push({
        label: "Unitrends Backup Portal",
        url: "https://backup.net",
      });
      if (unitrendsData.healthySummary.failingDevices > 0) {
        links.push({
          label: "Unitrends KB & Support",
          url: "https://helpdesk.kaseya.com/hc/en-gb/categories/360002175178-Unitrends",
        });
      }
    }

    // LLM-generated quicklinks
    const llmLinks = _llmResult.quicklinks as ReadonlyArray<BackupQuicklink> | undefined;
    if (llmLinks && Array.isArray(llmLinks)) {
      const existingUrls = new Set(links.map((l) => l.url));
      for (const link of llmLinks) {
        if (link.url && link.label && !existingUrls.has(link.url)) {
          links.push(link);
        }
      }
    }

    return links.slice(0, 6);
  }

  // ── Cove Data Fetching ──────────────────────────────────────────────

  private async fetchCoveData(
    context: TriageContext,
    deviceName: string | null,
  ): Promise<CoveData> {
    const config = await this.getCoveConfig();
    if (!config) return EMPTY_COVE_DATA;

    try {
      const visa = await this.coveLogin(config);
      if (!visa) return EMPTY_COVE_DATA;

      const customerExternalId = await this.findCustomerMapping(
        "cove",
        context.clientName,
      );

      const devices = await this.enumerateDeviceStatistics(visa, customerExternalId);
      const matchedDevice = deviceName ? findMatchingDevice(devices, deviceName) : null;
      const healthySummary = computeHealthSummary(devices);

      await this.logThinking(
        context.ticketId,
        `Cove: ${devices.length} devices. ${healthySummary.healthyDevices} healthy, ${healthySummary.errorDevices} with errors.`,
      );

      return { devices, matchedDevice, healthySummary };
    } catch (error) {
      console.error("[OSCAR] Cove fetch failed:", error);
      return EMPTY_COVE_DATA;
    }
  }

  // ── Unitrends Data Fetching ─────────────────────────────────────────

  private async fetchUnitrendsData(
    context: TriageContext,
  ): Promise<UnitrendsData> {
    const config = await this.getUnitrendsConfig();
    if (!config) return EMPTY_UNITRENDS_DATA;

    try {
      const client = new UnitrendsClient(config);

      // Find customer — try mapping first, then fuzzy match
      let customerId: number | null = null;
      let customerName: string | null = null;

      const mappingId = await this.findCustomerMapping("unitrends", context.clientName);
      if (mappingId) {
        customerId = Number(mappingId);
      }

      if (!customerId && context.clientName) {
        const matched = await client.findCustomerByName(context.clientName);
        if (matched) {
          customerId = matched.id;
          customerName = matched.name;

          // Save mapping for future use
          await this.saveCustomerMapping(
            "unitrends",
            context.clientName,
            String(matched.id),
            matched.name,
          );
        }
      }

      if (!customerId) {
        await this.logThinking(
          context.ticketId,
          "Unitrends configured but no customer mapping found for this client.",
        );
        return EMPTY_UNITRENDS_DATA;
      }

      // Fetch devices and recent jobs in parallel
      const [devices, recentJobs] = await Promise.all([
        client.getDevices(customerId).catch(() => [] as UnitrendsDevice[]),
        client.getBackupJobs(customerId).catch(() => [] as UnitrendsBackupJob[]),
      ]);

      const healthySummary = computeUnitrendsHealth(devices);

      await this.logThinking(
        context.ticketId,
        `Unitrends: ${devices.length} devices for ${customerName ?? `customer #${customerId}`}. ${healthySummary.healthyDevices} healthy, ${healthySummary.failingDevices} failing, ${healthySummary.alertDevices} with alerts.`,
      );

      return { devices, recentJobs, customerName, healthySummary };
    } catch (error) {
      console.error("[OSCAR] Unitrends fetch failed:", error);
      return EMPTY_UNITRENDS_DATA;
    }
  }

  // ── Cove Internal Methods ───────────────────────────────────────────

  private async coveLogin(config: CoveConfig): Promise<string | null> {
    try {
      const response = await fetch(COVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "Login",
          params: {
            partner: config.partner_name,
            username: config.api_username,
            password: config.api_token,
          },
          id: 1,
        }),
      });

      const data = (await response.json()) as {
        readonly result?: { readonly result?: CoveSession };
        readonly error?: { readonly message?: string };
      };

      if (data.error) {
        console.error("[OSCAR] Cove login error:", data.error.message);
        return null;
      }

      return data.result?.result?.visa ?? null;
    } catch (error) {
      console.error("[OSCAR] Cove login failed:", error);
      return null;
    }
  }

  private async enumerateDeviceStatistics(
    visa: string,
    customerExternalId: string | null,
  ): Promise<ReadonlyArray<CoveDeviceStatistic>> {
    try {
      const params: Record<string, unknown> = { visa };
      if (customerExternalId) {
        params.query = { PartnerId: Number(customerExternalId) };
      }

      const response = await fetch(COVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "EnumerateAccountStatistics",
          params,
          id: 2,
        }),
      });

      const data = (await response.json()) as {
        readonly result?: { readonly result?: ReadonlyArray<CoveDeviceStatistic> };
        readonly error?: { readonly message?: string };
      };

      if (data.error) {
        console.error("[OSCAR] Cove EnumerateAccountStatistics error:", data.error.message);
        return [];
      }

      return data.result?.result ?? [];
    } catch (error) {
      console.error("[OSCAR] Failed to enumerate device statistics:", error);
      return [];
    }
  }

  // ── Customer Mapping (shared across Cove + Unitrends) ───────────────

  private async findCustomerMapping(
    service: string,
    clientName: string | null,
  ): Promise<string | null> {
    if (!clientName) return null;

    // Try exact case-insensitive match
    const { data: exactMapping } = await this.supabase
      .from("integration_mappings")
      .select("external_id")
      .eq("service", service)
      .ilike("customer_name", clientName)
      .maybeSingle();

    if (exactMapping?.external_id) return exactMapping.external_id;

    // Fuzzy fallback — fetch all mappings for this service and normalize
    const { data: allMappings } = await this.supabase
      .from("integration_mappings")
      .select("external_id, customer_name")
      .eq("service", service);

    if (!allMappings || allMappings.length === 0) return null;

    const ticketNorm = normalizeName(clientName);
    const match = allMappings.find((m) => {
      const mappedNorm = normalizeName(m.customer_name);
      if (!mappedNorm || !ticketNorm) return false;
      if (mappedNorm === ticketNorm) return true;
      if (mappedNorm.includes(ticketNorm) || ticketNorm.includes(mappedNorm)) {
        const ratio = Math.min(mappedNorm.length, ticketNorm.length) / Math.max(mappedNorm.length, ticketNorm.length);
        return ratio >= 0.5;
      }
      return false;
    });

    return match?.external_id ?? null;
  }

  private async saveCustomerMapping(
    service: string,
    customerName: string,
    externalId: string,
    externalName: string,
  ): Promise<void> {
    await this.supabase
      .from("integration_mappings")
      .upsert(
        { service, customer_name: customerName, external_id: externalId, external_name: externalName },
        { onConflict: "service,customer_name" },
      )
      .then(() => {});
  }

  // ── Config ──────────────────────────────────────────────────────────

  private async getCoveConfig(): Promise<CoveConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "cove")
      .eq("is_active", true)
      .maybeSingle();

    return data ? (data.config as CoveConfig) : null;
  }

  private async getUnitrendsConfig(): Promise<UnitrendsConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "unitrends")
      .eq("is_active", true)
      .maybeSingle();

    return data ? (data.config as UnitrendsConfig) : null;
  }

  // ── Message Builder ────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    coveData: CoveData,
    unitrendsData: UnitrendsData,
    deviceName: string | null,
    errorKeyword: string | null,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId} — Backup & Recovery Assessment`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Full Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    // Extracted signals
    sections.push("", "## Extracted Ticket Signals");
    if (deviceName) sections.push(`**Device Name:** ${deviceName}`);
    if (errorKeyword) sections.push(`**Error Keyword:** ${errorKeyword}`);
    if (!deviceName && !errorKeyword) {
      sections.push("_No specific device name or error keyword found in ticket text._");
    }

    // ── Cove section ──────────────────────────────────────────────────
    if (coveData.healthySummary.totalDevices > 0) {
      sections.push("", "## Cove Data Protection (N-able)");
      sections.push(`**Total Devices:** ${coveData.healthySummary.totalDevices}`);
      sections.push(`**Healthy:** ${coveData.healthySummary.healthyDevices} | **With Errors:** ${coveData.healthySummary.errorDevices} | **Unprotected:** ${coveData.healthySummary.unprotectedDevices}`);

      if (coveData.matchedDevice) {
        const d = coveData.matchedDevice;
        sections.push("", "### Matched Cove Device");
        sections.push(`**Device:** ${d.DeviceName} (${d.ComputerName})`);
        sections.push(`**OS:** ${d.OsType} | **Status:** ${d.Status} | **Errors:** ${d.Errors}`);
        sections.push(`**Last Backup:** ${formatTimestamp(d.LastSuccessfulSessionTimestamp)} | **Last Session:** ${formatTimestamp(d.LastSessionTimestamp)}`);
        sections.push(`**Data Sources:** ${d.DataSources || "None"}`);
        sections.push(`**Storage Used:** ${formatBytes(d.UsedStorage)}`);
      }

      const errorDevices = coveData.devices.filter((d) => d.Errors > 0);
      if (errorDevices.length > 0) {
        sections.push("", `### Cove Devices With Errors (${errorDevices.length})`);
        for (const d of errorDevices.slice(0, 10)) {
          sections.push(`- **${d.DeviceName}** | ${d.Status} | Errors: ${d.Errors} | Last: ${formatTimestamp(d.LastSuccessfulSessionTimestamp)}`);
        }
      }
    }

    // ── Unitrends section ─────────────────────────────────────────────
    if (unitrendsData.healthySummary.totalDevices > 0) {
      sections.push("", "## Unitrends (Kaseya Unified Backup)");
      if (unitrendsData.customerName) sections.push(`**Customer:** ${unitrendsData.customerName}`);
      sections.push(`**Total Devices:** ${unitrendsData.healthySummary.totalDevices}`);
      sections.push(`**Healthy:** ${unitrendsData.healthySummary.healthyDevices} | **Failing:** ${unitrendsData.healthySummary.failingDevices} | **With Alerts:** ${unitrendsData.healthySummary.alertDevices}`);

      if (unitrendsData.devices.length > 0) {
        sections.push("", "### Unitrends Devices");
        for (const d of unitrendsData.devices.slice(0, 15)) {
          sections.push(`- **${d.name}** | ${d.os} | Status: ${d.status} | Last Backup: ${d.lastBackupStatus} (${d.lastBackupTime ?? "Never"}) | Alerts: ${d.alertCount}`);
        }
      }

      if (unitrendsData.recentJobs.length > 0) {
        const failedJobs = unitrendsData.recentJobs.filter((j) =>
          j.status.toLowerCase().includes("fail") || j.status.toLowerCase().includes("error"),
        );
        if (failedJobs.length > 0) {
          sections.push("", `### Recent Failed Jobs (${failedJobs.length})`);
          for (const j of failedJobs.slice(0, 10)) {
            sections.push(`- **${j.deviceName}** | ${j.status} | ${j.dataType ?? "N/A"} | ${j.errorMessage ?? "No error message"} | ${j.endTime ?? "In progress"}`);
          }
        }
      }
    }

    // KB references
    const hasCove = coveData.healthySummary.totalDevices > 0;
    const hasUnitrends = unitrendsData.healthySummary.totalDevices > 0;

    sections.push("", "## KB References");
    if (hasCove) {
      for (const ref of COVE_KB_REFERENCES) sections.push(`- [${ref.topic}](${ref.url})`);
    }
    if (hasUnitrends) {
      for (const ref of UNITRENDS_KB_REFERENCES) sections.push(`- [${ref.topic}](${ref.url})`);
    }

    // No data fallback
    if (!hasCove && !hasUnitrends) {
      sections.push("", "## No Backup Integration Data Available");
      sections.push(
        "Neither Cove nor Unitrends returned data for this client. " +
        "Analyze the ticket using backup/recovery expertise and recommend what checks should be performed.",
      );
    }

    return sections.join("\n");
  }
}

// ── Constants ─────────────────────────────────────────────────────────

const COVE_API_URL = "https://api.backup.management/jsonapi";

// ── Helper Functions ──────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDeviceName(text: string): string | null {
  const patterns = [
    /\b((?:SRV|SVR|DC|FS|SQL|APP|WEB|EXCH|HV|VM|WS|PC|LT|NB)[-_]?\w{2,}[-_]?\w*)\b/i,
    /\bserver[:\s]+["']?(\S+?)["']?\b/i,
    /\bdevice[:\s]+["']?(\S+?)["']?\b/i,
    /\bhost(?:name)?[:\s]+["']?(\S+?)["']?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractBackupErrorKeyword(text: string): string | null {
  const keywords = [
    "VSS", "overdue", "connection failed", "insufficient disk",
    "authentication error", "integrity check", "snapshot failed",
    "backup failed", "restore failed", "replication", "seed",
    "recovery point", "retention", "schedule", "SLA violation",
  ];

  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) return keyword;
  }
  return null;
}

function findMatchingDevice(
  devices: ReadonlyArray<CoveDeviceStatistic>,
  name: string,
): CoveDeviceStatistic | null {
  const lower = name.toLowerCase();

  const exact = devices.find(
    (d) => d.DeviceName.toLowerCase() === lower || d.ComputerName.toLowerCase() === lower,
  );
  if (exact) return exact;

  const partial = devices.find(
    (d) =>
      d.DeviceName.toLowerCase().includes(lower) ||
      d.ComputerName.toLowerCase().includes(lower) ||
      lower.includes(d.DeviceName.toLowerCase()) ||
      lower.includes(d.ComputerName.toLowerCase()),
  );
  return partial ?? null;
}

function computeHealthSummary(
  devices: ReadonlyArray<CoveDeviceStatistic>,
): CoveData["healthySummary"] {
  const totalDevices = devices.length;
  const errorDevices = devices.filter((d) => d.Errors > 0).length;
  const unprotectedDevices = devices.filter(
    (d) => d.UnprotectedData && d.UnprotectedData.length > 0,
  ).length;
  const healthyDevices = totalDevices - errorDevices;
  return { totalDevices, healthyDevices, errorDevices, unprotectedDevices };
}

function computeUnitrendsHealth(
  devices: ReadonlyArray<UnitrendsDevice>,
): UnitrendsData["healthySummary"] {
  const totalDevices = devices.length;
  const failingDevices = devices.filter((d) =>
    d.lastBackupStatus.toLowerCase().includes("fail") ||
    d.lastBackupStatus.toLowerCase().includes("error"),
  ).length;
  const alertDevices = devices.filter((d) => d.alertCount > 0).length;
  const healthyDevices = totalDevices - failingDevices;
  return { totalDevices, healthyDevices, failingDevices, alertDevices };
}

function formatTimestamp(epoch: number): string {
  if (!epoch || epoch === 0) return "Never";
  try {
    return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return "Unknown";
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}
