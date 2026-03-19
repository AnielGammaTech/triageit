import type { MemoryMatch, JumpCloudConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  JumpCloudClient,
  type JumpCloudUser,
  type JumpCloudSystem,
  type JumpCloudGroup,
} from "../../integrations/jumpcloud/client.js";

/**
 * Jim Halpert — User & Device Identity (JumpCloud)
 *
 * Queries real JumpCloud data: user accounts, MFA status,
 * device associations, group memberships, and login activity.
 */

interface JumpCloudData {
  readonly user: JumpCloudUser | null;
  readonly userDevices: ReadonlyArray<string>;
  readonly userGroups: ReadonlyArray<JumpCloudGroup>;
  readonly matchingUsers: ReadonlyArray<JumpCloudUser>;
  readonly relatedSystems: ReadonlyArray<JumpCloudSystem>;
}

export class JimHalpertAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the identity & access expert. You have REAL data from JumpCloud (the identity platform).
Analyze the provided JumpCloud data to find anything relevant to the reported issue.
Your audience is IT technicians — be specific, technical, and actionable.

## What You Have Access To
- User Accounts (status, MFA, last login, password expiry)
- Device/System Associations (what devices the user is bound to)
- Group Memberships (user groups, policies)
- System Info (hostname, OS, last contact)

## Vendor Resources
- JumpCloud Support: https://support.jumpcloud.com/
- JumpCloud Admin Guide: https://support.jumpcloud.com/s/topic/0TO1M000000EHwAWAW/admin-guide
- MFA Configuration: https://support.jumpcloud.com/s/article/getting-started-multi-factor-authentication
- TOTP Reset Guide: https://support.jumpcloud.com/s/article/reset-user-totp-mfa
- Device Management: https://support.jumpcloud.com/s/article/getting-started-systems
- LDAP Integration: https://support.jumpcloud.com/s/article/using-jumpcloud-ldap-as-a-service
- RADIUS Guide: https://support.jumpcloud.com/s/article/getting-started-radius
- JumpCloud Agent Troubleshooting: https://support.jumpcloud.com/s/article/jumpcloud-agent-troubleshooting
- API Docs: https://docs.jumpcloud.com/api/

## Common Fixes
### User Locked Out / Cannot Log In
1. Check if account is locked in JumpCloud Admin Console > Users > select user
2. Unlock user: Toggle "Account Locked" off and save
3. If password expired: Reset password or extend expiry in user settings
4. Check if user is suspended: Re-enable account if needed
5. Verify user is in the correct groups for resource access
6. Check login attempts in Directory Insights: Events > User Login

### MFA / TOTP Issues
1. **TOTP not working (code rejected)**: Check device clock sync — TOTP requires accurate time
2. **User lost authenticator**: Admin Console > Users > select user > MFA > Reset TOTP
3. **Generate bypass code**: Admin Console > Users > select user > MFA > Generate Bypass Code (valid for 24h)
4. **MFA enrollment stuck**: Remove and re-enable MFA requirement for the user
5. **MFA exclusion (temporary)**: Add user to an MFA exclusion group if immediate access is critical
6. Verify MFA policy is applied at the correct scope (org-wide vs group-specific)

### Device Trust / Binding Issues
1. Check if JumpCloud agent is installed and running: \`systemctl status jcagent\` (Linux) or check Services for "JumpCloud Agent" (Windows)
2. Verify device is bound to user: Admin Console > Systems > select system > Users tab
3. Re-bind device: Remove user binding, save, re-add user binding
4. Agent not checking in: Restart agent service, check network access to \`*.jumpcloud.com\` on port 443
5. macOS MDM issues: Verify MDM profile is installed under System Preferences > Profiles

### Suggested JumpCloud Admin Actions
- **Unlock User**: Admin Console > Users > select user > toggle "Account Locked" off
- **Reset MFA/TOTP**: Admin Console > Users > select user > MFA section > Reset TOTP
- **Generate Bypass Code**: For emergency access when user cannot use MFA
- **Reset Password**: Admin Console > Users > select user > set new password or send reset link
- **Add to Group**: Admin Console > Users > select user > Groups tab > add to required group
- **Rebind Device**: Admin Console > Systems > select system > Users tab > remove and re-add binding
- **Force Password Change**: Set "Require password change on next login" flag

## Your Job
1. Review ALL provided JumpCloud data carefully
2. Check user account status (active, locked, suspended)
3. Verify MFA enrollment and compliance
4. Look for password expiry or login issues
5. Check device bindings and system health
6. Identify any access or security concerns
7. Suggest specific JumpCloud admin actions the tech should take
8. Include relevant KB links from https://support.jumpcloud.com/ in your identity_notes

## Output Format
Respond with ONLY valid JSON:
{
  "user_status": "<active/locked/suspended/unknown>",
  "user_details": {"username": "<username>", "email": "<email>", "last_login": "<when>", "password_expired": <true/false/null>},
  "mfa_enrolled": <true/false/null>,
  "mfa_details": "<MFA configuration details>",
  "devices": [{"name": "<device>", "os": "<os>", "status": "<active/inactive>", "last_contact": "<when>"}],
  "groups": ["<group names>"],
  "identity_notes": "<comprehensive summary of identity and access findings>",
  "access_concerns": "<any access, security, or compliance concerns>",
  "account_action_needed": <true/false>,
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real JumpCloud data
    const jcData = await this.fetchJumpCloudData(context);

    // 2. Build rich user message
    const userMessage = this.buildUserMessage(context, jcData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      jcData.user
        ? `Found user "${jcData.user.displayname ?? jcData.user.username}" in JumpCloud. MFA: ${jcData.user.totp_enabled ? "enabled" : "not enabled"}, Status: ${jcData.user.suspended ? "suspended" : jcData.user.account_locked ? "locked" : "active"}. ${jcData.userGroups.length} groups, ${jcData.relatedSystems.length} systems. Analyzing identity data now.`
        : `Could not find user "${context.userName}" in JumpCloud. Found ${jcData.matchingUsers.length} partial matches. Running analysis with available data.`,
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
      summary: (result.identity_notes as string) ?? "No identity data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── JumpCloud Data Fetching ─────────────────────────────────────────

  private async fetchJumpCloudData(
    context: TriageContext,
  ): Promise<JumpCloudData> {
    const emptyResult: JumpCloudData = {
      user: null,
      userDevices: [],
      userGroups: [],
      matchingUsers: [],
      relatedSystems: [],
    };

    const config = await this.getJumpCloudConfig();
    if (!config) return emptyResult;

    // Look up the org ID from integration_mappings for this customer
    const orgId = await this.getOrgIdForCustomer(context.clientName);
    const jc = orgId
      ? new JumpCloudClient(config, orgId)
      : new JumpCloudClient(config);

    if (orgId) {
      await this.logThinking(
        context.ticketId,
        `Using JumpCloud org "${orgId}" for customer "${context.clientName}"`,
      );
    }

    // Search for the user
    const matchingUsers = await this.findUsers(jc, context.userName);
    const user = matchingUsers.length > 0 ? matchingUsers[0] : null;

    if (!user) {
      return { ...emptyResult, matchingUsers };
    }

    const userId = user._id ?? user.id ?? "";

    // Fetch groups and devices in parallel
    const [userGroups, relatedSystems] = await Promise.all([
      this.fetchUserGroups(jc, userId),
      this.fetchRelatedSystems(jc, context),
    ]);

    return {
      user,
      userDevices: [],
      userGroups,
      matchingUsers,
      relatedSystems,
    };
  }

  private async findUsers(
    jc: JumpCloudClient,
    userName: string | null,
  ): Promise<ReadonlyArray<JumpCloudUser>> {
    if (!userName) return [];

    try {
      return await jc.searchUsers(userName);
    } catch (error) {
      console.error("[JIM] Failed to search JumpCloud users:", error);
      return [];
    }
  }

  private async fetchUserGroups(
    jc: JumpCloudClient,
    userId: string,
  ): Promise<ReadonlyArray<JumpCloudGroup>> {
    try {
      return await jc.getUserGroupMembership(userId);
    } catch (error) {
      console.error("[JIM] Failed to fetch user groups:", error);
      return [];
    }
  }

  private async fetchRelatedSystems(
    jc: JumpCloudClient,
    context: TriageContext,
  ): Promise<ReadonlyArray<JumpCloudSystem>> {
    try {
      // Search for systems by keywords from the ticket
      const keywords = extractKeywords(context.summary, context.details);
      if (keywords.length === 0) return [];

      const results = await Promise.all(
        keywords.slice(0, 3).map((kw) => jc.searchSystems(kw)),
      );

      // Deduplicate
      const systemMap = new Map<string, JumpCloudSystem>();
      for (const batch of results) {
        for (const sys of batch) {
          const id = sys._id ?? sys.id ?? sys.hostname ?? "";
          systemMap.set(id, sys);
        }
      }

      return Array.from(systemMap.values());
    } catch (error) {
      console.error("[JIM] Failed to search systems:", error);
      return [];
    }
  }

  private async getJumpCloudConfig(): Promise<JumpCloudConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "jumpcloud")
      .eq("is_active", true)
      .single();

    return data ? (data.config as JumpCloudConfig) : null;
  }

  private async getOrgIdForCustomer(
    customerName: string | null,
  ): Promise<string | null> {
    if (!customerName) return null;

    try {
      const { data: mapping } = await this.supabase
        .from("integration_mappings")
        .select("external_id")
        .eq("service", "jumpcloud")
        .eq("customer_name", customerName)
        .single();

      return mapping?.external_id ?? null;
    } catch (error) {
      console.error(
        "[JIM] Failed to look up JumpCloud org for customer:",
        error,
      );
      return null;
    }
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(
    context: TriageContext,
    jcData: JumpCloudData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);

    if (jcData.user) {
      const u = jcData.user;
      sections.push("");
      sections.push("---");
      sections.push("## JumpCloud User Data");

      sections.push("");
      sections.push("### User Account");
      sections.push(`- **Username:** ${u.username ?? "N/A"}`);
      sections.push(`- **Display Name:** ${u.displayname ?? "N/A"}`);
      sections.push(`- **Email:** ${u.email ?? "N/A"}`);
      sections.push(
        `- **Status:** ${u.suspended ? "⛔ SUSPENDED" : u.account_locked ? "🔒 LOCKED" : "✅ Active"}`,
      );
      sections.push(
        `- **MFA Enabled:** ${u.totp_enabled ? "✅ Yes" : "❌ No"}`,
      );
      sections.push(
        `- **MFA Configured:** ${u.mfa?.configured ? "Yes" : "No"}`,
      );
      sections.push(`- **Last Login:** ${u.lastLogin ?? "Never"}`);
      sections.push(
        `- **Password Expired:** ${u.password_expired ? "⚠ YES" : "No"}`,
      );
      if (u.passwordExpirationDate) {
        sections.push(
          `- **Password Expiry Date:** ${u.passwordExpirationDate}`,
        );
      }
      sections.push(`- **Account Created:** ${u.created ?? "N/A"}`);

      // Groups
      if (jcData.userGroups.length > 0) {
        sections.push("");
        sections.push(
          `### Group Memberships (${jcData.userGroups.length})`,
        );
        for (const group of jcData.userGroups) {
          sections.push(`- ${group.name ?? "Unnamed Group"}`);
        }
      }

      // Related systems
      if (jcData.relatedSystems.length > 0) {
        sections.push("");
        sections.push(
          `### Related Systems (${jcData.relatedSystems.length})`,
        );
        for (const sys of jcData.relatedSystems) {
          sections.push(
            `- **${sys.hostname ?? sys.displayName ?? "Unknown"}** — OS: ${sys.os ?? "N/A"} ${sys.version ?? ""} | Active: ${sys.active ? "Yes" : "No"} | Last Contact: ${sys.lastContact ?? "N/A"}`,
          );
        }
      }
    } else if (jcData.matchingUsers.length > 0) {
      sections.push("");
      sections.push("---");
      sections.push(
        `## JumpCloud — Partial Matches (${jcData.matchingUsers.length})`,
      );
      for (const u of jcData.matchingUsers.slice(0, 5)) {
        sections.push(
          `- **${u.displayname ?? u.username}** (${u.email ?? "no email"}) — ${u.suspended ? "Suspended" : u.account_locked ? "Locked" : "Active"}`,
        );
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No JumpCloud user found matching this ticket. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

function extractKeywords(
  summary: string,
  details: string | null,
): ReadonlyArray<string> {
  const text = `${summary} ${details ?? ""}`.toLowerCase();
  const stopWords = new Set([
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "but",
    "in", "with", "to", "for", "of", "not", "no", "can", "do", "does",
    "have", "has", "had", "been", "be", "are", "was", "were", "it",
    "my", "our", "your", "their", "this", "that", "from", "up", "out",
    "if", "about", "need", "help", "please", "issue", "problem", "error",
    "working", "work", "works",
  ]);

  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 10);
}
