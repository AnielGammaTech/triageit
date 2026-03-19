import type { MemoryMatch, CoveConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";

/**
 * Oscar Martinez — Backup & Recovery Specialist (Cove Data Protection)
 *
 * Queries Cove Data Protection (N-able) via JSON-RPC API for device backup
 * status, last backup times, errors, and protection coverage. Also provides
 * deep expertise on Unitrends and general backup/recovery procedures.
 * Enhances Meredith Palmer's Spanning work with broader backup knowledge.
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

const EMPTY_COVE_DATA: CoveData = {
  devices: [],
  matchedDevice: null,
  healthySummary: {
    totalDevices: 0,
    healthyDevices: 0,
    errorDevices: 0,
    unprotectedDevices: 0,
  },
};

// ── Cove KB Reference URLs ──────────────────────────────────────────

const COVE_KB_REFERENCES: ReadonlyArray<{
  readonly topic: string;
  readonly url: string;
}> = [
  {
    topic: "Cove Data Protection Overview",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/cove-data-protection.htm",
  },
  {
    topic: "Backup Manager Error Codes",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/json-api/error-codes.htm",
  },
  {
    topic: "Recovery Console Guide",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/recovery-console.htm",
  },
  {
    topic: "Backup Schedule Configuration",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/backup-schedule.htm",
  },
  {
    topic: "System State Backup/Restore",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/system-state.htm",
  },
  {
    topic: "VMware Virtual Machine Backup",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/vmware.htm",
  },
  {
    topic: "Hyper-V Backup",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/hyper-v.htm",
  },
  {
    topic: "MS SQL Backup",
    url: "https://documentation.n-able.com/covedataprotection/USERGUIDE/documentation/Content/service-management/mssql.htm",
  },
];

// ── Agent Class ─────────────────────────────────────────────────────

export class OscarMartinezAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the Backup & Recovery Specialist. You have REAL data from Cove Data Protection (N-able).
Analyze backup data to assess reported issues, identify affected devices, and provide recovery guidance.
You also have deep knowledge of Unitrends and general backup/recovery best practices.

## What You Have Access To
- Device backup statistics (status, last backup time, errors, protected vs unprotected data)
- Backup data sources per device (Files & Folders, System State, MS SQL, VMware, Hyper-V, Exchange, SharePoint)
- Storage usage and selected sizes
- Customer-level device overview

## Cove Backup Types
- **Files & Folders**: File-level backup with include/exclude filters
- **System State**: Windows system state including registry, boot files, COM+ DB
- **MS SQL**: Database-level backup with transaction log support
- **VMware**: Agentless VM-level backup via vSphere API
- **Hyper-V**: VM-level backup via Hyper-V VSS writer
- **Exchange**: Mailbox-level backup (on-prem Exchange)
- **SharePoint**: SharePoint farm or content database backup

## Common Cove Errors and Fixes
- **"Backup overdue"**: Device hasn't run backup within schedule — check if device is powered on, agent is running
- **"VSS error"**: Volume Shadow Copy failed — check disk space, restart VSS writers, verify no conflicting backup software
- **"Connection failed"**: Device cannot reach Cove cloud — check firewall rules for ports 443/TCP, DNS resolution
- **"Insufficient disk space"**: Local temp space too low — free space on the backup drive or adjust LocalSpeedVaultPath
- **"Authentication error"**: Device credentials invalid — re-register device or update passphrase
- **"Integrity check failed"**: Backup data corruption detected — run deep verification, may need re-seed
- **"SQL backup failed"**: Check SQL Server agent running, database not in Simple recovery model for log backups
- **"VMware snapshot failed"**: Check datastore space, remove orphaned snapshots, verify CBT is enabled

## Recovery Procedures
- **File/Folder Restore**: Use Recovery Console or Backup Manager restore tab, select point-in-time, choose files
- **Bare Metal Recovery**: Boot from Cove recovery ISO, connect to cloud, select recovery point, restore to disk
- **SQL Restore**: Use Recovery Console, mount backup, restore .bak via SSMS or script
- **VM Recovery**: Use Recovery Console, export VM to local storage, import into hypervisor
- **Virtual Disaster Recovery**: Spin up standby VM in Cove cloud for immediate failover

## Unitrends Knowledge
- Unitrends appliance-based backup (physical or virtual)
- Supports VMware, Hyper-V, Windows, Linux, NAS, SAN
- Common issues: appliance disk full, replication lag, SLA policy violations
- Recovery: instant recovery (spin up VM from backup), file-level restore, bare metal

## Output Format
Respond with ONLY valid JSON:
{
  "backup_status": "<HEALTHY/DEGRADED/FAILING/UNKNOWN>",
  "devices_summary": "<X protected, Y with errors, Z unprotected>",
  "affected_device": "<device name or null if none identified>",
  "error_analysis": "<detailed analysis of the backup error and its meaning>",
  "recommended_actions": ["<specific action items for the tech>"],
  "recovery_guidance": "<step-by-step recovery instructions if applicable>",
  "kb_references": ["<links to relevant N-able Cove documentation>"],
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
      `Analyzing backup issue for ticket #${context.haloId}. ${deviceName ? `Device: ${deviceName}.` : ""} ${errorKeyword ? `Error keyword: ${errorKeyword}.` : ""} Querying Cove API...`,
    );

    const coveData = await this.fetchCoveData(context, deviceName);

    const userMessage = this.buildUserMessage(
      context,
      coveData,
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

    await this.logThinking(
      context.ticketId,
      `Cove analysis complete. Backup status: ${backupStatus}. ${coveData.healthySummary.totalDevices} total devices, ${coveData.healthySummary.errorDevices} with errors. ${coveData.matchedDevice ? `Matched device: ${coveData.matchedDevice.DeviceName}.` : "No specific device matched."}`,
    );

    return {
      summary: (result.backup_notes as string) ?? "No backup data available",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Cove Data Fetching ──────────────────────────────────────────────

  private async fetchCoveData(
    context: TriageContext,
    deviceName: string | null,
  ): Promise<CoveData> {
    const config = await this.getCoveConfig();

    if (!config) {
      await this.logThinking(
        context.ticketId,
        "Cove integration not configured — analyzing ticket with AI knowledge only.",
      );
      return EMPTY_COVE_DATA;
    }

    try {
      // Step 1: Login to get session visa
      const visa = await this.coveLogin(config);
      if (!visa) {
        await this.logThinking(
          context.ticketId,
          "Cove API login failed — analyzing ticket with AI knowledge only.",
        );
        return EMPTY_COVE_DATA;
      }

      // Step 2: Find customer mapping
      const customerExternalId = await this.findCustomerMapping(
        context.clientName,
      );

      // Step 3: Enumerate device statistics
      const devices = await this.enumerateDeviceStatistics(
        visa,
        customerExternalId,
      );

      // Step 4: Match specific device from ticket
      const matchedDevice = deviceName
        ? findMatchingDevice(devices, deviceName)
        : null;

      // Step 5: Compute health summary
      const healthySummary = computeHealthSummary(devices);

      await this.logThinking(
        context.ticketId,
        `Cove data fetched: ${devices.length} devices found. ${healthySummary.healthyDevices} healthy, ${healthySummary.errorDevices} with errors, ${healthySummary.unprotectedDevices} unprotected.`,
      );

      return { devices, matchedDevice, healthySummary };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await this.logThinking(
        context.ticketId,
        `Cove API error: ${message}. Falling back to AI analysis.`,
      );
      return EMPTY_COVE_DATA;
    }
  }

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
        params.query = {
          PartnerId: Number(customerExternalId),
        };
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
        readonly result?: {
          readonly result?: ReadonlyArray<CoveDeviceStatistic>;
        };
        readonly error?: { readonly message?: string };
      };

      if (data.error) {
        console.error(
          "[OSCAR] Cove EnumerateAccountStatistics error:",
          data.error.message,
        );
        return [];
      }

      return data.result?.result ?? [];
    } catch (error) {
      console.error("[OSCAR] Failed to enumerate device statistics:", error);
      return [];
    }
  }

  private async findCustomerMapping(
    clientName: string | null,
  ): Promise<string | null> {
    if (!clientName) return null;

    const { data: mapping } = await this.supabase
      .from("integration_mappings")
      .select("external_id")
      .eq("service", "cove")
      .eq("customer_name", clientName)
      .single();

    return mapping?.external_id ?? null;
  }

  // ── Config ──────────────────────────────────────────────────────────

  private async getCoveConfig(): Promise<CoveConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "cove")
      .eq("is_active", true)
      .single();

    return data ? (data.config as CoveConfig) : null;
  }

  // ── Message Builder ────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    data: CoveData,
    deviceName: string | null,
    errorKeyword: string | null,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId} — Backup & Recovery Assessment (Cove)`,
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
    sections.push("## Extracted Ticket Signals");
    if (deviceName) sections.push(`**Device Name:** ${deviceName}`);
    if (errorKeyword) sections.push(`**Error Keyword:** ${errorKeyword}`);
    if (!deviceName && !errorKeyword) {
      sections.push(
        "_No specific device name or error keyword found in ticket text._",
      );
    }

    // Health summary
    if (data.healthySummary.totalDevices > 0) {
      sections.push("");
      sections.push("## Cove Device Overview");
      sections.push(
        `**Total Devices:** ${data.healthySummary.totalDevices}`,
      );
      sections.push(
        `**Healthy:** ${data.healthySummary.healthyDevices} | **With Errors:** ${data.healthySummary.errorDevices} | **Unprotected:** ${data.healthySummary.unprotectedDevices}`,
      );
    }

    // Matched device detail
    if (data.matchedDevice) {
      sections.push("");
      sections.push("## Matched Device");
      sections.push(
        `**Device:** ${data.matchedDevice.DeviceName} (${data.matchedDevice.ComputerName})`,
      );
      sections.push(`**OS:** ${data.matchedDevice.OsType}`);
      sections.push(`**Status:** ${data.matchedDevice.Status}`);
      sections.push(
        `**Last Backup:** ${formatTimestamp(data.matchedDevice.LastSuccessfulSessionTimestamp)}`,
      );
      sections.push(
        `**Last Session:** ${formatTimestamp(data.matchedDevice.LastSessionTimestamp)}`,
      );
      sections.push(`**Errors:** ${data.matchedDevice.Errors}`);
      sections.push(
        `**Data Sources:** ${data.matchedDevice.DataSources || "None"}`,
      );
      sections.push(
        `**Protected Data:** ${data.matchedDevice.ProtectedData || "None"}`,
      );
      sections.push(
        `**Unprotected Data:** ${data.matchedDevice.UnprotectedData || "None"}`,
      );
      sections.push(
        `**Storage Used:** ${formatBytes(data.matchedDevice.UsedStorage)}`,
      );
    }

    // Devices with errors
    const errorDevices = data.devices.filter((d) => d.Errors > 0);
    if (errorDevices.length > 0) {
      sections.push("");
      sections.push(
        `## Devices With Errors (${errorDevices.length} found)`,
      );
      for (const device of errorDevices.slice(0, 15)) {
        sections.push(
          `- **${device.DeviceName}** | Status: ${device.Status} | Errors: ${device.Errors} | Last Backup: ${formatTimestamp(device.LastSuccessfulSessionTimestamp)} | Data Sources: ${device.DataSources || "None"}`,
        );
      }
    }

    // All devices summary (capped for prompt size)
    if (data.devices.length > 0 && data.devices.length <= 30) {
      sections.push("");
      sections.push(`## All Devices (${data.devices.length})`);
      for (const device of data.devices) {
        sections.push(
          `- **${device.DeviceName}** | ${device.Status} | Last: ${formatTimestamp(device.LastSuccessfulSessionTimestamp)} | Errors: ${device.Errors}`,
        );
      }
    } else if (data.devices.length > 30) {
      sections.push("");
      sections.push(
        `## All Devices (${data.devices.length} — showing first 30)`,
      );
      for (const device of data.devices.slice(0, 30)) {
        sections.push(
          `- **${device.DeviceName}** | ${device.Status} | Last: ${formatTimestamp(device.LastSuccessfulSessionTimestamp)} | Errors: ${device.Errors}`,
        );
      }
    }

    // KB references
    sections.push("");
    sections.push("## N-able Cove KB References");
    for (const ref of COVE_KB_REFERENCES) {
      sections.push(`- [${ref.topic}](${ref.url})`);
    }

    // No data fallback
    if (data.healthySummary.totalDevices === 0) {
      sections.push("");
      sections.push("## No Cove Data Available");
      sections.push(
        "Cove integration is not configured, API returned no data, or no customer mapping exists. " +
          "Analyze the ticket using your backup/recovery expertise and knowledge of Cove, Unitrends, and general backup best practices.",
      );
    }

    return sections.join("\n");
  }
}

// ── Constants ─────────────────────────────────────────────────────────

const COVE_API_URL = "https://api.backup.management/jsonapi";

// ── Helper Functions ──────────────────────────────────────────────────

function extractDeviceName(text: string): string | null {
  // Match common device name patterns: SERVER01, WS-ACME-01, DC01, etc.
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
    "VSS",
    "overdue",
    "connection failed",
    "insufficient disk",
    "authentication error",
    "integrity check",
    "snapshot failed",
    "backup failed",
    "restore failed",
    "replication",
    "seed",
    "recovery point",
    "retention",
    "schedule",
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

  // Exact match first
  const exact = devices.find(
    (d) =>
      d.DeviceName.toLowerCase() === lower ||
      d.ComputerName.toLowerCase() === lower,
  );
  if (exact) return exact;

  // Partial match
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
