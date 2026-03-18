import type { MemoryMatch, SpanningConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  SpanningClient,
  type SpanningTenant,
  type SpanningTenantStatus,
  type SpanningBackupSummary,
  type SpanningError,
  type SpanningUser,
  type SpanningUserBackup,
} from "../../integrations/spanning/client.js";

/**
 * Meredith Palmer — Backup & Recovery (Spanning)
 *
 * Queries Spanning Backup for Office 365 to check tenant backup status,
 * user protection, recent errors, and correlates with ticket details.
 * Extracts tenant IDs, error codes, site URLs from ticket text.
 */

interface SpanningData {
  readonly tenant: SpanningTenant | null;
  readonly tenantStatus: SpanningTenantStatus | null;
  readonly backupSummary: SpanningBackupSummary | null;
  readonly recentErrors: ReadonlyArray<SpanningError>;
  readonly matchedErrors: ReadonlyArray<SpanningError>;
  readonly affectedUser: SpanningUser | null;
  readonly affectedUserBackup: SpanningUserBackup | null;
}

export class MeredithPalmerAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the backup & recovery specialist. You have REAL data from Spanning Backup for Office 365.
Analyze the backup data to assess the reported issue, identify affected users/sites, and provide recovery guidance.

## What You Have Access To
- Tenant backup status (overall health, protected vs unprotected users)
- Backup summary (success/failure counts, last/next run times)
- Recent errors (error codes, affected users/sites, timestamps)
- User-specific backup data (mail, drive, SharePoint, calendar status)

## Common Spanning Error Codes
- 14021: Microsoft throttling — too many API requests, backups may be delayed
- 14001: Authentication failure — re-consent or token refresh needed
- 14010: SharePoint site inaccessible — permissions or site deleted
- 14020: Mailbox not found — user disabled or mailbox removed
- 14030: OneDrive quota exceeded — user's drive is full

## What to Look For
- Is the tenant healthy? Are backups running successfully?
- How many users are protected vs unprotected?
- Are there recent errors matching the ticket's error code?
- Is the specific user/site mentioned in the ticket affected?
- What is the error code meaning and recommended action?
- Is this a transient issue (throttling) or persistent (permissions)?

## Output Format
Respond with ONLY valid JSON:
{
  "backup_status": "<HEALTHY/DEGRADED/FAILING/UNKNOWN>",
  "tenant_health": "<summary of tenant backup state>",
  "affected_entity": "<user email or site URL affected, null if none identified>",
  "error_analysis": "<detailed analysis of the error code and its meaning>",
  "recent_errors_summary": "<summary of recent errors, patterns, frequency>",
  "recommended_actions": ["<specific action items for the tech>"],
  "recovery_steps": ["<step-by-step recovery/resolution instructions>"],
  "is_transient": <true/false>,
  "transient_reason": "<why this is/isn't transient, null if not applicable>",
  "backup_notes": "<comprehensive backup assessment with all findings>",
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // Extract ticket signals
    const ticketText = `${context.summary} ${context.details ?? ""}`;
    const errorCode = extractErrorCode(ticketText);
    const siteUrl = extractSiteUrl(ticketText);
    const userEmail = extractUserEmail(ticketText);

    await this.logThinking(
      context.ticketId,
      `Analyzing backup issue for ticket #${context.haloId}. ${errorCode ? `Error code: ${errorCode}.` : ""} ${siteUrl ? `Site: ${siteUrl}.` : ""} ${userEmail ? `User: ${userEmail}.` : ""} Querying Spanning API...`,
    );

    // Fetch Spanning data
    const spanningData = await this.fetchSpanningData(
      context,
      errorCode,
      siteUrl,
      userEmail,
    );

    const userMessage = this.buildUserMessage(
      context,
      spanningData,
      errorCode,
      siteUrl,
      userEmail,
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
    const matchedErrorCount = spanningData.matchedErrors.length;

    await this.logThinking(
      context.ticketId,
      `Spanning analysis complete. Backup status: ${backupStatus}. ${matchedErrorCount > 0 ? `Found ${matchedErrorCount} matching error(s).` : "No matching errors found."} ${spanningData.affectedUser ? `User ${spanningData.affectedUser.displayName ?? spanningData.affectedUser.userPrincipalName} identified.` : ""}`,
    );

    return {
      summary: (result.backup_notes as string) ?? "No backup data available",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Data Fetcher ───────────────────────────────────────────────────

  private async fetchSpanningData(
    context: TriageContext,
    errorCode: number | null,
    siteUrl: string | null,
    userEmail: string | null,
  ): Promise<SpanningData> {
    const config = await this.getSpanningConfig();

    if (!config) {
      await this.logThinking(
        context.ticketId,
        "⚠ Spanning integration not configured — analyzing ticket with AI knowledge only.",
      );
      return {
        tenant: null,
        tenantStatus: null,
        backupSummary: null,
        recentErrors: [],
        matchedErrors: [],
        affectedUser: null,
        affectedUserBackup: null,
      };
    }

    const client = new SpanningClient(config);

    try {
      // Fetch all data in parallel
      const [tenant, tenantStatus, backupSummary, recentErrors] =
        await Promise.all([
          client.getTenantInfo().catch(() => null),
          client.getTenantStatus().catch(() => null),
          client.getBackupSummary().catch(() => null),
          client.getRecentErrors(50).catch(() => []),
        ]);

      // Match errors by error code or site URL
      const matchedErrors = recentErrors.filter((e) => {
        if (errorCode && e.errorCode === errorCode) return true;
        if (
          siteUrl &&
          e.siteUrl?.toLowerCase().includes(siteUrl.toLowerCase())
        )
          return true;
        return false;
      });

      // Look up affected user if email found in ticket
      let affectedUser: SpanningUser | null = null;
      let affectedUserBackup: SpanningUserBackup | null = null;

      if (userEmail) {
        affectedUser = await client.searchUserByEmail(userEmail).catch(() => null);
        if (affectedUser?.userPrincipalName) {
          affectedUserBackup = await client
            .getUserBackupSummary(affectedUser.userPrincipalName)
            .catch(() => null);
        }
      }

      await this.logThinking(
        context.ticketId,
        `Spanning data fetched: tenant=${tenant?.companyName ?? "unknown"}, ${tenantStatus?.totalProtectedUsers ?? "?"} protected users, ${recentErrors.length} recent errors, ${matchedErrors.length} matching errors.`,
      );

      return {
        tenant,
        tenantStatus,
        backupSummary,
        recentErrors,
        matchedErrors,
        affectedUser,
        affectedUserBackup,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await this.logThinking(
        context.ticketId,
        `⚠ Spanning API error: ${message}. Falling back to AI analysis.`,
      );
      return {
        tenant: null,
        tenantStatus: null,
        backupSummary: null,
        recentErrors: [],
        matchedErrors: [],
        affectedUser: null,
        affectedUserBackup: null,
      };
    }
  }

  // ── Config ──────────────────────────────────────────────────────────

  private async getSpanningConfig(): Promise<SpanningConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "spanning")
      .eq("is_active", true)
      .single();

    return data ? (data.config as SpanningConfig) : null;
  }

  // ── Message Builder ────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    data: SpanningData,
    errorCode: number | null,
    siteUrl: string | null,
    userEmail: string | null,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId} — Backup & Recovery Assessment`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Full Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    // Extracted signals
    sections.push("");
    sections.push("## Extracted Ticket Signals");
    if (errorCode) sections.push(`**Error Code:** ${errorCode}`);
    if (siteUrl) sections.push(`**Affected Site/URL:** ${siteUrl}`);
    if (userEmail) sections.push(`**Affected User:** ${userEmail}`);
    if (!errorCode && !siteUrl && !userEmail) {
      sections.push("_No specific error code, site URL, or user email found in ticket text._");
    }

    // Tenant info
    if (data.tenant) {
      sections.push("");
      sections.push("## Spanning Tenant Info");
      sections.push(`**Company:** ${data.tenant.companyName ?? "Unknown"}`);
      sections.push(`**Tenant ID:** ${data.tenant.tenantId ?? "Unknown"}`);
      sections.push(`**Subscription:** ${data.tenant.subscriptionType ?? "Unknown"}`);
      sections.push(
        `**Licensed Users:** ${data.tenant.licensedUsers ?? "?"} | **Assigned:** ${data.tenant.assignedUsers ?? "?"}`,
      );
    }

    // Tenant status
    if (data.tenantStatus) {
      sections.push("");
      sections.push("## Tenant Backup Status");
      sections.push(`**Backup Enabled:** ${data.tenantStatus.backupEnabled ?? "Unknown"}`);
      sections.push(`**Status:** ${data.tenantStatus.status ?? "Unknown"}`);
      sections.push(
        `**Protected Users:** ${data.tenantStatus.totalProtectedUsers ?? "?"} | **Unprotected:** ${data.tenantStatus.totalUnprotectedUsers ?? "?"}`,
      );
      sections.push(`**Last Backup:** ${data.tenantStatus.lastBackupTime ?? "Unknown"}`);
      sections.push(`**Next Backup:** ${data.tenantStatus.nextBackupTime ?? "Unknown"}`);
      if (data.tenantStatus.errors) {
        sections.push(`**Active Errors:** ${data.tenantStatus.errors}`);
      }
      if (data.tenantStatus.warnings) {
        sections.push(`**Warnings:** ${data.tenantStatus.warnings}`);
      }
    }

    // Backup summary
    if (data.backupSummary) {
      sections.push("");
      sections.push("## Backup Summary");
      sections.push(
        `**Success:** ${data.backupSummary.successCount ?? "?"} | **Failures:** ${data.backupSummary.failureCount ?? "?"} | **Partial:** ${data.backupSummary.partialCount ?? "?"}`,
      );
      sections.push(`**Last Run:** ${data.backupSummary.lastRunTime ?? "Unknown"}`);
      sections.push(`**Next Run:** ${data.backupSummary.nextRunTime ?? "Unknown"}`);
    }

    // Matched errors
    if (data.matchedErrors.length > 0) {
      sections.push("");
      sections.push(`## Matching Errors (${data.matchedErrors.length} found)`);
      for (const err of data.matchedErrors.slice(0, 10)) {
        sections.push(
          `- **Code ${err.errorCode}** | ${err.errorMessage ?? "No message"} | User: ${err.userPrincipalName ?? "N/A"} | Site: ${err.siteUrl ?? "N/A"} | ${err.timestamp ?? ""}`,
        );
      }
    } else if (data.recentErrors.length > 0) {
      // Show recent errors even if none match
      sections.push("");
      sections.push(`## Recent Errors (${data.recentErrors.length} total, no exact match)`);
      for (const err of data.recentErrors.slice(0, 5)) {
        sections.push(
          `- **Code ${err.errorCode}** | ${err.errorMessage ?? "No message"} | ${err.siteUrl ?? err.userPrincipalName ?? "N/A"} | ${err.timestamp ?? ""}`,
        );
      }
    }

    // Affected user info
    if (data.affectedUser) {
      sections.push("");
      sections.push("## Affected User");
      sections.push(`**Name:** ${data.affectedUser.displayName ?? "Unknown"}`);
      sections.push(`**Email:** ${data.affectedUser.userPrincipalName ?? data.affectedUser.email ?? "Unknown"}`);
      sections.push(`**Licensed:** ${data.affectedUser.isLicensed ?? "Unknown"}`);
      sections.push(`**Backup Enabled:** ${data.affectedUser.backupEnabled ?? "Unknown"}`);
      sections.push(`**Last Backup:** ${data.affectedUser.lastBackupStatus ?? "Unknown"} at ${data.affectedUser.lastBackupTime ?? "Unknown"}`);
    }

    if (data.affectedUserBackup) {
      sections.push("");
      sections.push("## Affected User Backup Detail");
      sections.push(`**Mail:** ${data.affectedUserBackup.mailBackupStatus ?? "Unknown"}`);
      sections.push(`**OneDrive:** ${data.affectedUserBackup.driveBackupStatus ?? "Unknown"}`);
      sections.push(`**SharePoint:** ${data.affectedUserBackup.sharePointBackupStatus ?? "Unknown"}`);
      sections.push(`**Calendar:** ${data.affectedUserBackup.calendarBackupStatus ?? "Unknown"}`);
      sections.push(`**Contacts:** ${data.affectedUserBackup.contactsBackupStatus ?? "Unknown"}`);
      if (data.affectedUserBackup.errors?.length) {
        sections.push(`**Errors:** ${data.affectedUserBackup.errors.join(", ")}`);
      }
    }

    // No data fallback
    if (!data.tenant && !data.tenantStatus && !data.backupSummary) {
      sections.push("");
      sections.push("## ⚠ No Spanning Data Available");
      sections.push(
        "Spanning integration is not configured or API returned no data. " +
        "Analyze the ticket using your backup/recovery expertise and common Spanning error knowledge.",
      );
    }

    return sections.join("\n");
  }
}

// ── Extraction Helpers ─────────────────────────────────────────────────

function extractErrorCode(text: string): number | null {
  // Match patterns like "Error Code: 14021" or "error code 14021" or just "#14021"
  const patterns = [
    /error\s*code[:\s]*(\d{4,5})/i,
    /code[:\s]*(\d{4,5})/i,
    /#(\d{4,5})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function extractSiteUrl(text: string): string | null {
  // Match SharePoint/OneDrive URLs
  const match = text.match(
    /https?:\/\/[^\s"'<>]*\.sharepoint\.com[^\s"'<>]*/i,
  );
  return match ? match[0] : null;
}

function extractUserEmail(text: string): string | null {
  // Match email-like patterns, skip common non-user emails
  const match = text.match(
    /[\w.+-]+@[\w.-]+\.\w{2,}/i,
  );
  if (!match) return null;

  const email = match[0].toLowerCase();
  // Skip system/noreply emails
  const skipPatterns = ["noreply", "no-reply", "mailer-daemon", "postmaster"];
  if (skipPatterns.some((p) => email.includes(p))) return null;

  return email;
}
