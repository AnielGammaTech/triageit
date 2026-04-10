import type { MemoryMatch, CippConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  CippClient,
  type CippUser,
  type CippMailbox,
  type CippMfaStatus,
  type CippDevice,
  type CippConditionalAccessPolicy,
  type CippSignInLog,
} from "../../integrations/cipp/client.js";

/**
 * Darryl Philbin — Microsoft 365 & CIPP Specialist
 *
 * "The Warehouse Manager"
 * Queries CIPP (CyberDrain Improved Partner Portal) for Microsoft 365 tenant data:
 * user mailbox status, MFA enrollment, license assignments, conditional access,
 * device compliance, and security defaults.
 */

interface CippData {
  readonly user: CippUser | null;
  readonly mailbox: CippMailbox | null;
  readonly mfaStatus: CippMfaStatus | null;
  readonly devices: ReadonlyArray<CippDevice>;
  readonly conditionalAccess: ReadonlyArray<CippConditionalAccessPolicy>;
  readonly signInLogs: ReadonlyArray<CippSignInLog>;
  readonly tenantDomain: string | null;
}

export class DarrylPhilbinAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the DEFINITIVE Microsoft 365 authority. When a ticket involves ANYTHING Microsoft-related, you must provide complete context.

## Diagnostic Checklist — For ANY M365 Ticket, Check ALL:
1. **User Account** — Is the account enabled? When was last sign-in? Is it on-prem synced?
2. **Licenses** — What M365 plan are they on? Do they have the right license for what they're trying to do? (e.g., Teams meetings need Business Standard+, not Basic)
3. **MFA** — Is MFA enabled? What methods? Is it per-user or Conditional Access?
4. **Sign-in Logs** — Any recent failures? Risky sign-ins? Blocked by CA policy?
5. **Mailbox** — Type, forwarding rules, shared mailbox access
6. **Conditional Access** — What policies apply? Could a policy be blocking them?
7. **Device Compliance** — Are their devices compliant in Intune?
8. **Security Alerts** — Any active alerts for this tenant?

## Triage Shortcuts
- If someone can't sign in -> check sign-in logs + MFA + CA policies FIRST
- If email isn't working -> check mailbox + forwarding + licenses
- If "can't access Teams/OneDrive/etc" -> check license includes that feature
- If account locked -> check sign-in logs for failed attempts + risky sign-ins

## What You Have Access To
- User account details (enabled, synced, last sign-in)
- Mailbox status (active, blocked, shared, resource, forwarding)
- MFA enrollment (enabled, enforced, per-user or Conditional Access)
- License assignments (E3, E5, Business Basic, Business Standard, etc.)
- Sign-in logs (recent successes/failures, risk levels, CA evaluation)
- Conditional Access policies
- Device compliance (Intune)
- Security defaults and tenant settings

## Critical Rules
- ALWAYS mention the specific license the user has and whether it covers what they need.
- ALWAYS include M365 admin center links when relevant.
- If CIPP data is provided, use it as primary evidence.
- Flag disabled accounts, missing MFA, expired licenses.
- Note forwarding rules on mailboxes (potential security risk).
- Highlight failed or risky sign-ins with failure reasons.
- If no CIPP data, analyze from ticket context and recommend checks.

## Output Format
Respond with ONLY valid JSON:
{
  "m365_findings": "<summary of all M365-related findings>",
  "user_status": {"mailbox": "<status>", "mfa": "<status>", "licenses": ["<license list>"], "compliance": "<status>", "sign_in_health": "<status>"},
  "admin_links": ["<relevant M365 admin center URLs>"],
  "tenant_notes": "<any tenant-wide concerns or configurations>",
  "recommendations": ["<actionable recommendations>"],
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    const config = await this.getCippConfig();
    let cippData: CippData | null = null;

    if (config) {
      cippData = await this.fetchCippData(config, context);
    }

    if (cippData) {
      await this.logThinking(
        context.ticketId,
        `Pulled CIPP data for tenant ${cippData.tenantDomain}: user=${cippData.user?.displayName ?? "not found"}, mfa=${cippData.mfaStatus?.perUser ?? "unknown"}, devices=${cippData.devices.length}, signInLogs=${cippData.signInLogs.length}`,
      );
    } else {
      await this.logThinking(
        context.ticketId,
        config
          ? "CIPP configured but could not find tenant mapping for this client. Analyzing from ticket context only."
          : "CIPP integration not configured. Analyzing M365 context from ticket information only.",
      );
    }

    const userMessage = this.buildPrompt(context, cippData);

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
      summary: (result.m365_findings as string) ?? "M365 analysis based on ticket context",
      data: result,
      confidence: (result.confidence as number) ?? (cippData ? 0.7 : 0.4),
    };
  }

  private buildPrompt(context: TriageContext, cippData: CippData | null): string {
    const lines = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      context.details ? `**Description:** ${context.details}` : "",
      context.clientName ? `**Client:** ${context.clientName}` : "",
      context.userName ? `**Reported By:** ${context.userName}` : "",
    ];

    if (cippData) {
      lines.push("", "## CIPP Data (Real M365 Tenant Data)");
      if (cippData.tenantDomain) lines.push(`**Tenant:** ${cippData.tenantDomain}`);

      if (cippData.user) {
        const u = cippData.user;
        lines.push(
          "",
          "### User Account",
          `- **Name:** ${u.displayName}`,
          `- **UPN:** ${u.userPrincipalName}`,
          `- **Enabled:** ${u.accountEnabled}`,
          `- **On-Prem Sync:** ${u.onPremisesSyncEnabled ?? "N/A"}`,
          `- **Licenses:** ${u.assignedLicenses.length > 0 ? u.assignedLicenses.map((l) => l.skuId).join(", ") : "None"}`,
          u.lastSignInDateTime ? `- **Last Sign-in:** ${u.lastSignInDateTime}` : "",
        );
      } else {
        lines.push("", "### User Account", "User not found in tenant.");
      }

      if (cippData.mailbox) {
        const m = cippData.mailbox;
        lines.push(
          "",
          "### Mailbox",
          `- **Type:** ${m.recipientTypeDetails}`,
          `- **SMTP:** ${m.primarySmtpAddress}`,
          m.forwardingAddress ? `- **Forwarding:** ${m.forwardingAddress}` : "",
          m.forwardingSmtpAddress ? `- **SMTP Forward:** ${m.forwardingSmtpAddress}` : "",
        );
      }

      if (cippData.mfaStatus) {
        const mfa = cippData.mfaStatus;
        lines.push(
          "",
          "### MFA Status",
          `- **Per-User MFA:** ${mfa.perUser}`,
          `- **Methods:** ${mfa.mfaMethods.length > 0 ? mfa.mfaMethods.join(", ") : "None configured"}`,
          `- **Covered by CA:** ${mfa.coveredByCA}`,
          `- **Covered by Security Defaults:** ${mfa.coveredBySD}`,
        );
      }

      if (cippData.devices.length > 0) {
        lines.push("", "### Devices");
        for (const d of cippData.devices.slice(0, 10)) {
          lines.push(`- ${d.displayName} (${d.operatingSystem} ${d.osVersion}) — Compliance: ${d.complianceState}, Last Sync: ${d.lastSyncDateTime ?? "N/A"}`);
        }
      }

      if (cippData.signInLogs.length > 0) {
        const recentLogs = cippData.signInLogs.slice(0, 5);
        const failedLogs = cippData.signInLogs.filter((l) => l.status?.errorCode !== 0);

        lines.push("", "### Recent Sign-in Activity (Last 5)");
        for (const log of recentLogs) {
          const status = log.status?.errorCode === 0 ? "Success" : `Failed (${log.status?.failureReason ?? "unknown"})`;
          const location = [log.location?.city, log.location?.state, log.location?.countryOrRegion].filter(Boolean).join(", ") || "Unknown";
          const risk = log.riskLevelDuringSignIn && log.riskLevelDuringSignIn !== "none" ? ` | Risk: ${log.riskLevelDuringSignIn}` : "";
          const ca = log.conditionalAccessStatus ? ` | CA: ${log.conditionalAccessStatus}` : "";
          lines.push(`- ${log.createdDateTime ?? "N/A"} — **${status}** via ${log.appDisplayName ?? "unknown app"} from ${log.ipAddress ?? "N/A"} (${location})${risk}${ca}`);
        }

        if (failedLogs.length > 0) {
          lines.push("", `**${failedLogs.length} failed sign-in(s) detected.**`);
          for (const fl of failedLogs.slice(0, 3)) {
            lines.push(`- ${fl.createdDateTime ?? "N/A"}: ${fl.status?.failureReason ?? "Unknown reason"} (app: ${fl.appDisplayName ?? "unknown"}, IP: ${fl.ipAddress ?? "N/A"})`);
          }
        }
      }

      if (cippData.conditionalAccess.length > 0) {
        lines.push("", "### Conditional Access Policies");
        for (const ca of cippData.conditionalAccess) {
          lines.push(`- **${ca.displayName}** — State: ${ca.state}`);
        }
      }

      // Admin center links
      if (cippData.user) {
        lines.push(
          "",
          "### M365 Admin Links",
          `- [User Details](https://admin.microsoft.com/Adminportal/Home#/users/:/UserDetails/${cippData.user.userPrincipalName})`,
          `- [Sign-in Logs](https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/SignIns/userId/${cippData.user.userPrincipalName})`,
        );
      }
    } else {
      lines.push(
        "",
        "**Note:** No CIPP data available for this client. Analyze based on ticket context only and recommend what M365 checks should be performed.",
      );
    }

    return lines.filter(Boolean).join("\n");
  }

  private async fetchCippData(config: CippConfig, context: TriageContext): Promise<CippData | null> {
    try {
      const client = new CippClient(config);

      // Find the tenant for this customer
      const tenantDomain = await this.getTenantForCustomer(client, context.clientName);
      if (!tenantDomain) return null;

      // Extract email or name from ticket context
      const userEmail = context.userEmail ?? null;
      const userName = context.userName ?? null;

      // Try to find user by email first, then by name if no email
      let user: CippUser | null = null;
      let mfaStatus: CippMfaStatus | null = null;

      const conditionalAccess = await client.getConditionalAccess(tenantDomain).catch(() => [] as CippConditionalAccessPolicy[]);

      if (userEmail) {
        [user, mfaStatus] = await Promise.all([
          client.findUser(tenantDomain, userEmail),
          client.findUserMfa(tenantDomain, userEmail),
        ]);
      }

      // If no user found by email, try searching all users by name
      if (!user && userName) {
        try {
          const allUsers = await client.getUsers(tenantDomain);
          const nameLower = userName.toLowerCase();
          const matched = allUsers.find((u) => {
            const displayName = (u.displayName ?? "").toLowerCase();
            const upn = (u.userPrincipalName ?? "").toLowerCase();
            return displayName.includes(nameLower) || nameLower.includes(displayName) || upn.includes(nameLower);
          });
          if (matched) {
            user = matched;
            mfaStatus = await client.findUserMfa(tenantDomain, matched.userPrincipalName ?? "");
            console.log(`[DARRYL] Found user by name match: "${userName}" → ${matched.userPrincipalName}`);
          }
        } catch {
          // Non-critical — proceed without user
        }
      }

      // Also try extracting email from ticket summary/details
      if (!user) {
        const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
        const textToSearch = `${context.summary} ${context.details ?? ""}`;
        const emailMatch = textToSearch.match(emailRegex);
        if (emailMatch) {
          user = await client.findUser(tenantDomain, emailMatch[0]);
          if (user) {
            mfaStatus = await client.findUserMfa(tenantDomain, emailMatch[0]);
            console.log(`[DARRYL] Found user by email in ticket text: ${emailMatch[0]}`);
          }
        }
      }

      // Fetch user-specific data if we found the user
      let mailbox: CippMailbox | null = null;
      let devices: ReadonlyArray<CippDevice> = [];
      let signInLogs: ReadonlyArray<CippSignInLog> = [];

      if (user) {
        const [mailboxes, allDevices, logs] = await Promise.all([
          client.getMailboxes(tenantDomain).catch(() => [] as CippMailbox[]),
          client.getDevices(tenantDomain).catch(() => [] as CippDevice[]),
          client.getSignInLogs(tenantDomain, user.userPrincipalName ?? ""),
        ]);

        const upnLower = user.userPrincipalName.toLowerCase();
        mailbox = mailboxes.find((m) => m.userPrincipalName.toLowerCase() === upnLower) ?? null;
        devices = allDevices.filter((d) => d.userPrincipalName?.toLowerCase() === upnLower);
        signInLogs = logs;
      }

      return { user, mailbox, mfaStatus, devices, conditionalAccess, signInLogs, tenantDomain };
    } catch (error) {
      console.error("[DARRYL] Failed to fetch CIPP data:", error);
      return null;
    }
  }

  private async getTenantForCustomer(client: CippClient, customerName: string | null): Promise<string | null> {
    if (!customerName) return null;

    // Check integration_mappings first
    try {
      const { data: mapping } = await this.supabase
        .from("integration_mappings")
        .select("external_id")
        .eq("service", "cipp")
        .ilike("customer_name", customerName)
        .single();

      if (mapping?.external_id) return mapping.external_id;
    } catch {
      // No mapping found, try auto-match
    }

    // Auto-match: search CIPP tenants by name
    try {
      const tenants = await client.listTenants();
      const nameLower = customerName.toLowerCase();
      const match = tenants.find((t) =>
        t.displayName.toLowerCase().includes(nameLower) ||
        nameLower.includes(t.displayName.toLowerCase()),
      );

      if (match) {
        // Save mapping for future use
        await this.supabase.from("integration_mappings").upsert({
          service: "cipp",
          customer_name: customerName,
          external_id: match.defaultDomainName,
          external_name: match.displayName,
        }, { onConflict: "service,customer_name" }).then(() => {});

        return match.defaultDomainName;
      }
    } catch (error) {
      console.warn("[DARRYL] Failed to auto-match tenant:", error);
    }

    return null;
  }

  private async getCippConfig(): Promise<CippConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "cipp")
      .eq("is_active", true)
      .single();

    return data ? (data.config as CippConfig) : null;
  }
}
