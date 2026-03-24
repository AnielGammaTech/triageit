import type { MemoryMatch, Pax8Config } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  Pax8Client,
  type Pax8Subscription,
  type Pax8Company,
} from "../../integrations/pax8/client.js";

/**
 * Holly Flax — Cloud Licensing & Subscriptions (Pax8)
 *
 * Queries Pax8 for the client's Microsoft 365 (and other cloud)
 * subscription data: seat counts, available licenses, billing status,
 * and subscription health. Gives techs immediate visibility into
 * licensing issues without leaving the triage note.
 */

interface Pax8Data {
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly subscriptions: ReadonlyArray<Pax8Subscription>;
}

const EMPTY_PAX8: Pax8Data = {
  companyId: null,
  companyName: null,
  subscriptions: [],
};

export class HollyFlaxAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the licensing and cloud subscription expert. You have REAL data from Pax8 (the cloud marketplace).
Analyze the provided subscription data to find anything relevant to the reported issue.
Your audience is IT technicians — be specific about seat counts, billing status, and license availability.

## What You Have Access To
- Active subscriptions (M365 Business Basic/Standard/Premium, Exchange Online, Defender, etc.)
- Seat counts (quantity purchased per subscription)
- Subscription status (Active, Cancelled, PendingManual, Suspended, etc.)
- Billing terms (Monthly, Annual) and renewal dates
- Product names and vendors

## Key Licensing Concepts
### Microsoft 365 License Hierarchy
- **M365 Business Basic**: Web-only Office apps + Exchange + Teams + SharePoint + OneDrive (50GB mailbox)
- **M365 Business Standard**: Desktop Office apps + everything in Basic
- **M365 Business Premium**: Standard + Intune + Defender for Business + Azure AD P1 + Conditional Access
- **Exchange Online Plan 1**: Email only (50GB), no Office apps
- **Exchange Online Plan 2**: Email (100GB) + archiving + DLP, no Office apps
- **Microsoft Defender for Office 365**: Anti-phishing, Safe Links, Safe Attachments
- **Azure AD P1/P2**: Conditional Access, MFA, Identity Protection
- **Microsoft Teams Phone**: PSTN calling capability

### Common Licensing Issues
- User can't access an app → check if their license includes it (e.g., Desktop Office requires Standard+)
- Mailbox full → Exchange Online P1 = 50GB, P2 = 100GB, check which plan they have
- MFA not available → needs Azure AD P1 or M365 Business Premium
- Can't use Conditional Access → needs Azure AD P1/P2
- Teams calling issues → check if Teams Phone Standard license is assigned
- New user needs setup → check available seats across subscriptions
- Shared mailbox limits → Exchange shared mailboxes are free up to 50GB without a license

### Seat Math
- **Purchased seats**: The "quantity" field in each subscription
- **Available seats**: Must be checked in M365 Admin Center (Pax8 shows purchased only)
- If a customer needs more seats, the tech needs to increase quantity in Pax8 portal
- Annual commitments: can increase seats anytime, but decreasing may only happen at renewal
- Monthly subscriptions: flexible seat changes at any time

## Your Job
1. Review ALL provided subscription data
2. Identify which subscriptions are relevant to the ticket
3. Report exact seat counts — how many licenses are purchased per product
4. Flag any subscriptions with concerning status (Suspended, PendingManual, Cancelled)
5. Note billing terms and upcoming renewals that may be relevant
6. Identify if the issue could be a missing or insufficient license
7. Suggest specific licensing actions if applicable (add seats, upgrade plan, etc.)

## Output Format
Respond with ONLY valid JSON:
{
  "subscriptions_summary": [
    {"product": "<name>", "seats": <quantity>, "status": "<status>", "billing": "<term>", "relevance": "<why this matters for the ticket>"}
  ],
  "total_m365_seats": <number of M365 seats across all M365 subscriptions>,
  "licensing_issues": ["<any subscription problems found>"],
  "seat_availability": "<summary of purchased seats and any concerns>",
  "relevant_products": ["<products relevant to the ticket issue>"],
  "licensing_notes": "<comprehensive summary of licensing findings and recommendations>",
  "recommended_actions": ["<specific licensing actions the tech should take>"],
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    // 1. Fetch real Pax8 data
    const pax8Data = await this.fetchPax8Data(context);

    // 2. Build rich user message with real data
    const userMessage = this.buildUserMessage(context, pax8Data);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      pax8Data.companyId
        ? `Found "${pax8Data.companyName}" in Pax8 (ID: ${pax8Data.companyId}). ${pax8Data.subscriptions.length} subscriptions. Analyzing licensing data now.`
        : `Could not find client "${context.clientName}" in Pax8. Running analysis with ticket info only.`,
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
      summary: (result.licensing_notes as string) ?? "No licensing data found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Pax8 Data Fetching ──────────────────────────────────────────────

  private async fetchPax8Data(context: TriageContext): Promise<Pax8Data> {
    const config = await this.getPax8Config();
    if (!config) return EMPTY_PAX8;

    const pax8 = new Pax8Client(config);

    // Find the company by client name/ID
    const company = await this.findCompany(pax8, context.clientName, context.clientId);
    if (!company) return EMPTY_PAX8;

    // Fetch subscriptions — client auto-resolves product names via /products/:id
    const subscriptions = await this.fetchSubscriptions(pax8, company.id);

    return {
      companyId: company.id,
      companyName: company.name,
      subscriptions,
    };
  }

  private async findCompany(
    pax8: Pax8Client,
    clientName: string | null,
    clientId?: number | null,
  ): Promise<Pax8Company | null> {
    if (!clientName) return null;

    try {
      // 1. Check integration_mappings first
      let mapping: { external_id: string; external_name: string } | null = null;

      if (clientId) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "pax8")
          .eq("customer_id", String(clientId))
          .single();
        mapping = data;
      }

      if (!mapping) {
        const { data } = await this.supabase
          .from("integration_mappings")
          .select("external_id, external_name")
          .eq("service", "pax8")
          .ilike("customer_name", clientName)
          .single();
        mapping = data;
      }

      if (mapping?.external_id) {
        try {
          const company = await pax8.getCompany(mapping.external_id);
          console.log(
            `[HOLLY] Found Pax8 company via mapping: "${mapping.external_name}" (ID: ${mapping.external_id}) for "${clientName}"`,
          );
          return company;
        } catch (err) {
          console.error(
            `[HOLLY] Mapping found for "${clientName}" → ${mapping.external_id}, but fetch failed:`,
            err,
          );
        }
      }

      // 2. Fallback: search by company name
      const matches = await pax8.searchCompanies(clientName);
      if (matches.length > 0) {
        console.log(
          `[HOLLY] Found Pax8 company via name search: "${matches[0].name}" (ID: ${matches[0].id}) for "${clientName}"`,
        );
        return matches[0];
      }

      // 3. Try normalized matching
      const companies = await pax8.getCompanies();
      const normalized = this.normalizeName(clientName);

      for (const company of companies) {
        const compNorm = this.normalizeName(company.name);
        if (compNorm === normalized) return company;
        if (compNorm.includes(normalized) || normalized.includes(compNorm)) {
          const ratio = Math.min(compNorm.length, normalized.length) /
            Math.max(compNorm.length, normalized.length);
          if (ratio >= 0.5) return company;
        }
      }

      console.log(`[HOLLY] No Pax8 company found for "${clientName}"`);
      return null;
    } catch (error) {
      console.error(`[HOLLY] Error finding Pax8 company for "${clientName}":`, error);
      return null;
    }
  }

  private async fetchSubscriptions(
    pax8: Pax8Client,
    companyId: string,
  ): Promise<ReadonlyArray<Pax8Subscription>> {
    try {
      return await pax8.getSubscriptions(companyId);
    } catch (error) {
      console.error(`[HOLLY] Failed to fetch subscriptions for company ${companyId}:`, error);
      return [];
    }
  }

  private async getPax8Config(): Promise<Pax8Config | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "pax8")
      .eq("is_active", true)
      .single();

    return data ? (data.config as Pax8Config) : null;
  }

  // ── Message Building ────────────────────────────────────────────────

  private buildUserMessage(context: TriageContext, pax8Data: Pax8Data): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
      `**Client:** ${context.clientName ?? "Unknown"}`,
      `**Reported By:** ${context.userName ?? "Unknown"}`,
    ];

    if (context.details) {
      sections.push("", "**Details:**", context.details.substring(0, 3000));
    }

    if (context.actions && context.actions.length > 0) {
      sections.push("", "**Recent Activity:**");
      for (const action of context.actions.slice(0, 10)) {
        const who = action.who ?? "Unknown";
        const when = action.date
          ? new Date(action.date).toLocaleString()
          : "?";
        sections.push(`- ${who} (${when}): ${action.note?.substring(0, 300) ?? ""}`);
      }
    }

    if (pax8Data.companyId) {
      sections.push(
        "",
        "---",
        "## Pax8 Licensing Data",
        `**Company:** ${pax8Data.companyName} (ID: ${pax8Data.companyId})`,
      );

      if (pax8Data.subscriptions.length > 0) {
        // Group by status
        const active = pax8Data.subscriptions.filter((s) => s.status === "Active");
        const other = pax8Data.subscriptions.filter((s) => s.status !== "Active");

        sections.push(
          "",
          `### Active Subscriptions (${active.length})`,
        );

        for (const sub of active) {
          const productName = sub.product?.name ??
            sub.productId;
          const vendor = sub.product?.vendorName ?? "";
          const billing = sub.billingTerm ?? "Unknown";
          const endDate = sub.endDate
            ? ` | Ends: ${new Date(sub.endDate).toLocaleDateString()}`
            : "";
          const commitEnd = sub.commitment?.endDate
            ? ` | Commitment ends: ${new Date(sub.commitment.endDate).toLocaleDateString()}`
            : "";
          const price = sub.price != null ? ` | $${sub.price}/seat` : "";

          sections.push(
            `- **${productName}**${vendor ? ` (${vendor})` : ""}: **${sub.quantity} seats** | ${billing}${price}${endDate}${commitEnd}`,
          );
        }

        if (other.length > 0) {
          sections.push(
            "",
            `### Other Subscriptions (${other.length})`,
          );
          for (const sub of other) {
            const productName = sub.product?.name ??
                sub.productId;
            sections.push(
              `- **${productName}**: ${sub.quantity} seats | Status: **${sub.status}** | ${sub.billingTerm ?? "?"}`,
            );
          }
        }

        // Summary stats
        const m365Subs = active.filter((s) => {
          const name = (s.product?.name ?? "").toLowerCase();
          return (
            name.includes("microsoft 365") ||
            name.includes("office 365") ||
            name.includes("m365")
          );
        });

        if (m365Subs.length > 0) {
          const totalM365Seats = m365Subs.reduce((sum, s) => sum + s.quantity, 0);
          sections.push(
            "",
            `### M365 Summary`,
            `- Total M365 license seats purchased: **${totalM365Seats}**`,
            `- Across ${m365Subs.length} subscription(s)`,
          );
        }
      } else {
        sections.push("", "*No subscriptions found for this company in Pax8.*");
      }
    } else {
      sections.push(
        "",
        "---",
        "## Pax8 Data",
        `*Could not find "${context.clientName}" in Pax8. Analyze based on ticket context only.*`,
      );
    }

    return sections.join("\n");
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(
        /\b(inc|llc|ltd|corp|co|the|company|group|services|solutions|llp|pllc)\b/g,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
  }
}
