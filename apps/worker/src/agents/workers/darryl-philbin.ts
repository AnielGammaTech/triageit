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
  readonly tenantDomain: string | null;
}

export class DarrylPhilbinAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the Microsoft 365 specialist. You have access to CIPP (CyberDrain Improved Partner Portal) data for the client's M365 tenant.

## What You Have Access To
- User mailbox status (active, blocked, shared, resource)
- MFA enrollment status (enabled, enforced, per-user or Conditional Access)
- License assignments (E3, E5, Business Basic, etc.)
- Conditional Access policies
- Device compliance (Intune)
- Security defaults and tenant settings
- Sign-in logs and risky user flags

## Analysis Guidelines
- If CIPP data is provided, use it as primary evidence
- Flag disabled accounts, missing MFA, expired licenses
- Note forwarding rules on mailboxes (potential security risk)
- Check device compliance status for the affected user
- Identify relevant Conditional Access policies
- If no CIPP data, analyze from ticket context and recommend checks

## Output Format
Respond with ONLY valid JSON:
{
  "m365_findings": "<summary of all M365-related findings>",
  "user_status": {"mailbox": "<status>", "mfa": "<status>", "licenses": ["<license list>"], "compliance": "<status>"},
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
        `Pulled CIPP data for tenant ${cippData.tenantDomain}: user=${cippData.user?.displayName ?? "not found"}, mfa=${cippData.mfaStatus?.perUser ?? "unknown"}, devices=${cippData.devices.length}`,
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

      if (cippData.conditionalAccess.length > 0) {
        lines.push("", "### Conditional Access Policies");
        for (const ca of cippData.conditionalAccess) {
          lines.push(`- **${ca.displayName}** — State: ${ca.state}`);
        }
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

      // Extract email from ticket context
      const userEmail = context.userEmail ?? null;

      // Fetch data in parallel
      const [user, mfaStatus, conditionalAccess] = await Promise.all([
        userEmail ? client.findUser(tenantDomain, userEmail) : Promise.resolve(null),
        userEmail ? client.findUserMfa(tenantDomain, userEmail) : Promise.resolve(null),
        client.getConditionalAccess(tenantDomain).catch(() => [] as CippConditionalAccessPolicy[]),
      ]);

      // Fetch user-specific data if we found the user
      let mailbox: CippMailbox | null = null;
      let devices: ReadonlyArray<CippDevice> = [];

      if (user) {
        const [mailboxes, allDevices] = await Promise.all([
          client.getMailboxes(tenantDomain).catch(() => [] as CippMailbox[]),
          client.getDevices(tenantDomain).catch(() => [] as CippDevice[]),
        ]);

        const upnLower = user.userPrincipalName.toLowerCase();
        mailbox = mailboxes.find((m) => m.userPrincipalName.toLowerCase() === upnLower) ?? null;
        devices = allDevices.filter((d) => d.userPrincipalName?.toLowerCase() === upnLower);
      }

      return { user, mailbox, mfaStatus, devices, conditionalAccess, tenantDomain };
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
