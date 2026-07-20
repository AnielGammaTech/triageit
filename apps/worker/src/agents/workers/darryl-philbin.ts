import type { MemoryMatch, CippConfig } from "@triageit/shared";
import { extractResponseText } from "../llm-text.js";
import { BaseAgent, type AgentResult, type SystemBlocks } from "../base-agent.js";
import { logCacheUsage } from "../cache-metrics.js";
import { extractEmailDomain } from "../customer-match.js";
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
  type CippServiceHealthIssue,
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
  // true = the user lookup THREW (say "lookup failed"), so user: null does
  // NOT mean the user is missing from the tenant
  readonly userLookupFailed: boolean;
  readonly mailbox: CippMailbox | null;
  readonly mfaStatus: CippMfaStatus | null;
  readonly devices: ReadonlyArray<CippDevice>;
  readonly conditionalAccess: ReadonlyArray<CippConditionalAccessPolicy>;
  // null = lookup failed (say "could not check"), [] = no recent sign-ins
  readonly signInLogs: ReadonlyArray<CippSignInLog> | null;
  readonly tenantDomain: string | null;
  // null = lookup failed (say "could not check"), [] = no active incidents
  readonly serviceHealth: ReadonlyArray<CippServiceHealthIssue> | null;
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
    systemBlocks: SystemBlocks,
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
        `Pulled CIPP data for tenant ${cippData.tenantDomain}: user=${cippData.user?.displayName ?? (cippData.userLookupFailed ? "lookup FAILED" : "not found")}, mfa=${cippData.mfaStatus?.perUser ?? "unknown"}, devices=${cippData.devices.length}, signInLogs=${cippData.signInLogs?.length ?? "lookup FAILED"}`,
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
      system: systemBlocks,
      messages: [{ role: "user", content: userMessage }],
    });
    logCacheUsage(`darryl:${this.getModel()}`, response.usage);

    const text =
      extractResponseText(response, "{}");
    const result = parseLlmJson<Record<string, unknown>>(text);

    return {
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
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

      // Microsoft-side incidents FIRST — if the platform is degraded, that
      // reframes the entire ticket before any user-level diagnosis
      if (cippData.serviceHealth === null) {
        lines.push("", "### Microsoft 365 Service Health", "Lookup failed — could NOT check for active Microsoft incidents. Do not assume the platform is healthy.");
      } else if (cippData.serviceHealth.length > 0) {
        lines.push("", "### ⚠ ACTIVE Microsoft 365 Service Issues for this tenant (REAL — from Microsoft)");
        for (const issue of cippData.serviceHealth.slice(0, 8)) {
          lines.push(`- [${issue.issueId ?? "?"}] **${issue.service ?? "Unknown service"}**${issue.type ? ` (${issue.type})` : ""}: ${issue.desc ?? "no description"}`);
        }
        lines.push("If the reported problem matches one of these services, say so explicitly in m365_findings — the tech should reference the Microsoft incident instead of debugging the user's setup.");
      } else {
        lines.push("", "### Microsoft 365 Service Health", "No active Microsoft incidents for this tenant (verified via CIPP).");
      }

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
      } else if (cippData.userLookupFailed) {
        lines.push(
          "",
          "### User Account",
          "⚠ CIPP user lookup FAILED — live data unavailable. State this in your findings; do NOT report the user as missing or disabled.",
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

      if (cippData.signInLogs === null) {
        lines.push(
          "",
          "### Recent Sign-in Activity",
          "⚠ CIPP sign-in log lookup FAILED — live data unavailable. State this in your findings; do NOT conclude there are no failed or risky sign-ins.",
        );
      } else if (cippData.signInLogs.length > 0) {
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

      // Find the tenant for this customer (name match + email-domain match)
      const tenantDomain = await this.getTenantForCustomer(client, context);
      if (!tenantDomain) return null;

      // Extract email or name from ticket context
      const userEmail = context.userEmail ?? null;
      const userName = context.userName ?? null;

      // Try to find user by email first, then by name if no email
      let user: CippUser | null = null;
      let mfaStatus: CippMfaStatus | null = null;
      let userLookupFailed = false;

      const [conditionalAccess, serviceHealth] = await Promise.all([
        client.getConditionalAccess(tenantDomain).catch(() => [] as CippConditionalAccessPolicy[]),
        // Active Microsoft incidents for THIS tenant — "is it Microsoft or is
        // it the user?" is the #1 misdiagnosis risk on M365 tickets
        client.getServiceHealth(tenantDomain),
      ]);

      if (userEmail) {
        try {
          [user, mfaStatus] = await Promise.all([
            client.findUser(tenantDomain, userEmail),
            client.findUserMfa(tenantDomain, userEmail),
          ]);
        } catch (error) {
          // Lookup failed ≠ user missing — Darryl must say "lookup FAILED"
          userLookupFailed = true;
          console.warn("[DARRYL] CIPP user lookup failed:", error instanceof Error ? error.message : error);
        }
      }

      // If no user found by email, try searching all users by name
      if (!user && userName) {
        try {
          const allUsers = await client.getUsers(tenantDomain);
          const nameLower = userName.toLowerCase();
          const matched = allUsers.find((u) => {
            const displayName = (u.displayName ?? "").toLowerCase();
            const upn = (u.userPrincipalName ?? "").toLowerCase();
            // Empty displayName made nameLower.includes("") ALWAYS true —
            // the first no-name service account matched every reporter and
            // its licenses/MFA/sign-ins were presented as the reporter's
            if (displayName.length >= 3 && (displayName.includes(nameLower) || nameLower.includes(displayName))) return true;
            return upn.length >= 3 && upn.includes(nameLower);
          });
          if (matched) {
            user = matched;
            mfaStatus = await client.findUserMfa(tenantDomain, matched.userPrincipalName ?? "").catch(() => null);
            console.log(`[DARRYL] Found user by name match: "${userName}" → ${matched.userPrincipalName}`);
          }
        } catch {
          // Lookup failed ≠ user missing — proceed, but flag it
          userLookupFailed = true;
        }
      }

      // Also try extracting email from ticket summary/details
      if (!user) {
        const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
        const textToSearch = `${context.summary} ${context.details ?? ""}`;
        const emailMatch = textToSearch.match(emailRegex);
        if (emailMatch) {
          try {
            user = await client.findUser(tenantDomain, emailMatch[0]);
            if (user) {
              mfaStatus = await client.findUserMfa(tenantDomain, emailMatch[0]).catch(() => null);
              console.log(`[DARRYL] Found user by email in ticket text: ${emailMatch[0]}`);
            }
          } catch {
            userLookupFailed = true;
          }
        }
      }

      // Fetch user-specific data if we found the user
      let mailbox: CippMailbox | null = null;
      let devices: ReadonlyArray<CippDevice> = [];
      let signInLogs: ReadonlyArray<CippSignInLog> | null = [];

      if (user) {
        const [mailboxes, allDevices, logs] = await Promise.all([
          client.getMailboxes(tenantDomain).catch(() => [] as CippMailbox[]),
          client.getDevices(tenantDomain).catch(() => [] as CippDevice[]),
          // null (not []) signals lookup FAILURE — buildUserMessage renders the
          // "sign-in log lookup FAILED" notice instead of "no risky sign-ins".
          // An un-caught throw here would reject the whole Promise.all and nuke
          // ALL already-fetched CIPP data (user, MFA, CA, service health).
          client.getSignInLogs(tenantDomain, user.userPrincipalName ?? "").catch(() => {
            console.warn("[DARRYL] CIPP sign-in log lookup failed for", user?.userPrincipalName);
            return null as ReadonlyArray<CippSignInLog> | null;
          }),
        ]);

        const upnLower = (user.userPrincipalName ?? "").trim().toLowerCase();
        if (upnLower) {
          mailbox = mailboxes.find((m) => (m.userPrincipalName ?? "").toLowerCase() === upnLower) ?? null;
          devices = allDevices.filter((d) => d.userPrincipalName?.toLowerCase() === upnLower);
        } else {
          userLookupFailed = true;
          console.warn("[DARRYL] CIPP returned a user without a userPrincipalName; skipping mailbox/device correlation");
        }
        signInLogs = logs;
      }

      return { user, userLookupFailed, mailbox, mfaStatus, devices, conditionalAccess, signInLogs, tenantDomain, serviceHealth };
    } catch (error) {
      console.error("[DARRYL] Failed to fetch CIPP data:", error);
      return null;
    }
  }

  private async getTenantForCustomer(client: CippClient, context: TriageContext): Promise<string | null> {
    const customerName = context.clientName;
    const emailDomain = extractEmailDomain(context);

    // 1. Saved mapping by customer name
    if (customerName) {
      const mapped = await this.lookupMapping(customerName);
      if (mapped) return mapped;
    }

    // 2. Saved mapping by email domain (handles multi-domain tenants —
    //    e.g. evllc.com lives under the Quality Enterprise tenant)
    if (emailDomain) {
      const mapped = await this.lookupMapping(`domain:${emailDomain}`);
      if (mapped) return mapped;
    }

    try {
      const tenants = await client.listTenants();

      // 3. Exact match on a tenant's default domain
      if (emailDomain) {
        const byDefault = tenants.find(
          (t) => (t.defaultDomainName ?? "").toLowerCase() === emailDomain,
        );
        if (byDefault) {
          await this.saveMapping(customerName, `domain:${emailDomain}`, byDefault);
          return byDefault.defaultDomainName;
        }
      }

      // 4. Auto-match by normalized name — Halo says "ALLEN CONCRETE &
      //    MASONRY, INC" while CIPP says "Allen Concrete"
      if (customerName) {
        const normalize = (name: string) =>
          name.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions)\b/g, "").replace(/[^a-z0-9]/g, "");
        const target = normalize(customerName);
        const match = tenants.find((t) => {
          const tenant = normalize(t.displayName ?? "");
          return tenant.length >= 4 && target.length >= 4 && (tenant.includes(target) || target.includes(tenant));
        });

        if (match) {
          await this.saveMapping(customerName, emailDomain ? `domain:${emailDomain}` : null, match);
          return match.defaultDomainName;
        }
      }

      // 5. Last resort for multi-domain tenants: scan each tenant's full
      //    domain list for the email domain. One-time cost — the result is
      //    persisted, so future tickets resolve via the mapping in step 2.
      if (emailDomain) {
        for (const tenant of tenants.slice(0, 60)) {
          try {
            const domains = await client.listDomains(tenant.defaultDomainName);
            if (domains.some((d) => (d.id ?? "").toLowerCase() === emailDomain)) {
              console.log(`[DARRYL] Domain scan matched ${emailDomain} → tenant ${tenant.displayName}`);
              await this.saveMapping(customerName, `domain:${emailDomain}`, tenant);
              return tenant.defaultDomainName;
            }
          } catch {
            // Skip tenants that error — non-critical
          }
        }
      }
    } catch (error) {
      console.warn("[DARRYL] Failed to auto-match tenant:", error);
    }

    return null;
  }

  private async lookupMapping(key: string): Promise<string | null> {
    try {
      const { data: mapping } = await this.supabase
        .from("integration_mappings")
        .select("external_id")
        .eq("service", "cipp")
        .ilike("customer_name", key)
        .single();
      return mapping?.external_id ?? null;
    } catch {
      return null;
    }
  }

  private async saveMapping(
    customerName: string | null,
    domainKey: string | null,
    tenant: { defaultDomainName: string; displayName: string },
  ): Promise<void> {
    const rows = [customerName, domainKey]
      .filter((k): k is string => Boolean(k))
      .map((key) => ({
        service: "cipp",
        customer_name: key,
        external_id: tenant.defaultDomainName,
        external_name: tenant.displayName,
      }));
    if (rows.length === 0) return;
    try {
      await this.supabase
        .from("integration_mappings")
        .upsert(rows, { onConflict: "service,customer_name" });
    } catch {
      // Mapping cache is best-effort
    }
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
