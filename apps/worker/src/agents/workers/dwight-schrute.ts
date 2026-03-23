import type { MemoryMatch, HuduConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  HuduClient,
  type HuduArticle,
  type HuduAsset,
  type HuduAssetLayout,
  type HuduPassword,
  type HuduProcedure,
} from "../../integrations/hudu/client.js";

/**
 * Dwight Schrute — IT Documentation & Assets (Hudu)
 *
 * "Assistant to the Regional Manager"
 * Layout-aware: fetches the RIGHT asset types based on ticket classification.
 * Queries Hudu KB articles, assets by layout, passwords, procedures, and vendors.
 */

interface HuduData {
  readonly companyId: number | null;
  readonly companyName: string | null;
  readonly huduBaseUrl: string | null;
  readonly articles: ReadonlyArray<HuduArticle>;
  readonly priorityAssets: ReadonlyArray<CategorizedAsset>;
  readonly otherAssets: ReadonlyArray<CategorizedAsset>;
  readonly vendors: ReadonlyArray<CategorizedAsset>;
  readonly passwords: ReadonlyArray<HuduPassword>;
  readonly procedures: ReadonlyArray<HuduProcedure>;
}

interface CategorizedAsset extends HuduAsset {
  readonly layoutName: string;
}

// ── Layout-to-Classification Mapping ──────────────────────────────────

/**
 * Maps ticket classification types to the Hudu asset layout names that
 * should be PRIORITIZED for that issue type. Dwight always fetches these
 * first, then includes other assets as secondary context.
 *
 * Layout names are matched case-insensitively and with partial matching,
 * so "Internet/WAN" matches a layout called "Internet/WAN" or "internet wan".
 */
const CLASSIFICATION_LAYOUT_MAP: Record<string, ReadonlyArray<string>> = {
  network: ["Internet/WAN", "Site to Site VPN", "Wireless", "Config Files", "Network Overview"],
  voip: ["VOIP", "Config Files"],
  telephony: ["VOIP", "Config Files"],
  phone: ["VOIP", "Config Files"],
  email: ["Email", "Computer Assets"],
  endpoint: ["Computer Assets", "Applications", "Printing"],
  security: ["Computer Assets", "People", "Internet/WAN", "Email"],
  identity: ["People", "Applications", "Email"],
  backup: ["Computer Assets"],
  cloud: ["Computer Assets", "Applications"],
  infrastructure: ["Network Overview", "Internet/WAN", "Site to Site VPN", "Locations", "Computer Assets"],
  application: ["Applications", "Computer Assets"],
  onboarding: ["People", "Applications", "Email", "Computer Assets"],
  billing: ["Vendors"],
  other: ["Computer Assets", "Locations"],
};

/** Layouts that should ALWAYS be fetched regardless of classification. */
const ALWAYS_FETCH_LAYOUTS = ["Vendors"];

export class DwightSchruteAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the documentation expert. You have REAL data from Hudu (the IT documentation platform).
The assets are organized by type (layout) and prioritized based on the ticket classification.

## About Us
We are **Gamma Tech Services LLC**, an MSP in Naples, FL (domains: gtmail.us, gamma.tech, helpdesk: help@gamma.tech).
We service other companies — when you see Gamma Tech or gtmail.us/gamma.tech, that's us, not a client.

Analyze the provided Hudu data to find anything relevant to the reported issue.
Your audience is IT technicians — be specific, technical, and actionable.

## What You Have Access To
- KB Articles (knowledge base documentation per client)
- **Prioritized Assets** — asset types specifically relevant to this ticket type (network gear for network issues, VOIP for phone issues, etc.)
- **Other Assets** — secondary context from other asset types
- **Vendors** — vendor/supplier info for this client's equipment and services
- Passwords/credentials (names and types only — never expose actual passwords)
- Procedures (step-by-step processes documented for this client)

## Asset Layout Types You May See
- **Computer Assets**: Workstations, servers, laptops
- **Email**: Email configurations, domains, mailboxes
- **Applications**: Software, SaaS apps, licenses
- **Internet/WAN**: ISP connections, circuits, IPs, gateways
- **Site to Site VPN**: VPN tunnels between locations
- **Wireless**: WiFi networks, SSIDs, APs
- **Printing**: Printers, MFPs, print servers
- **VOIP**: Phone systems, extensions, SIP trunks
- **People**: Contacts, key personnel, POCs
- **Vendors**: Equipment/service suppliers, support contacts, contract info
- **Locations**: Physical sites, addresses, rack info
- **Config Files**: Network configs, firewall rules, switch configs
- **Network Overview**: Network diagrams, topology, IP schemes
- **Documents / File Sharing**: Shared drives, file servers

## Vendor Resources
- Hudu Support: https://support.hudu.com/
- Hudu KB Guide: https://support.hudu.com/hc/en-us/categories/360002194573-Knowledge-Base
- Hudu Asset Management: https://support.hudu.com/hc/en-us/articles/360042862374-Asset-Layouts

## Documentation Gap Analysis
When analyzing ticket context against available documentation, identify:
1. **Missing Procedures**: If the issue has no documented resolution procedure, flag this as a documentation gap
2. **Outdated Articles**: If a KB article exists but appears outdated, flag for update
3. **Missing Asset Records**: If the ticket references a device/system not documented in Hudu, flag for asset creation
4. **Incomplete Runbooks**: If a procedure exists but lacks detail for this specific scenario, flag for enhancement

## Post-Resolution Documentation Guidance
After the issue is resolved, recommend the tech document:
1. **Root cause**: What actually caused the issue
2. **Resolution steps**: Exact steps taken to fix it
3. **Prevention**: What can be done to prevent recurrence
4. **Where to document**: Suggest whether to create a new KB article, update an existing one, or add a procedure

## Contact Information Rules
- ONLY include phone numbers that belong to the SPECIFIC end-user who submitted the ticket.
- Do NOT use company/site phone numbers as if they are the end-user's direct number.
- If you're not confident a phone number belongs to the specific end-user, do NOT include it.

## Your Job
1. Review ALL provided Hudu data carefully — especially the PRIORITIZED assets
2. Pay special attention to **Vendors** — techs need to know who supports what equipment
3. Identify which assets, articles, or procedures are relevant to the ticket
4. Highlight any documented solutions or troubleshooting steps
5. Note if the client has specific configurations that affect this issue
6. If relevant passwords exist, note them (by name only) so the tech knows where to look
7. Identify documentation gaps and recommend what should be created/updated
8. Include Hudu article/asset URLs in your response so techs can click through

## Output Format
Respond with ONLY valid JSON:
{
  "relevant_assets": [{"name": "<asset>", "type": "<layout type>", "model": "<model if known>", "relevance": "<why this asset matters>"}],
  "kb_articles": [{"title": "<title>", "summary": "<key information from this article>", "actionable_steps": "<specific steps if applicable>"}],
  "procedures": [{"title": "<title>", "steps_summary": "<key steps relevant to this issue>"}],
  "relevant_passwords": [{"name": "<credential name>", "type": "<type>", "note": "<what this credential is for>"}],
  "vendor_info": [{"name": "<vendor name>", "relevance": "<what they supply/support for this client>", "contact": "<support contact if available>"}],
  "hudu_links": [{"label": "<what this link is for>", "url": "<Hudu URL>"}],
  "client_config_notes": "<any client-specific configurations that affect this issue>",
  "documentation_gaps": [{"type": "<missing_procedure/outdated_article/missing_asset/incomplete_runbook>", "description": "<what is missing or needs updating>", "recommendation": "<what the tech should document after resolution>"}],
  "post_resolution_docs": "<specific guidance on what to document in Hudu after this issue is resolved>",
  "documentation_notes": "<comprehensive summary of ALL relevant documentation found>",
  "has_documented_solution": <true/false>,
  "confidence": <0.0-1.0>
}`;
  }

  protected async process(
    context: TriageContext,
    systemPrompt: string,
    _memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult> {
    const huduData = await this.fetchHuduData(context);
    const userMessage = this.buildUserMessage(context, huduData);

    const totalAssets = huduData.priorityAssets.length + huduData.otherAssets.length;

    await this.logThinking(
      context.ticketId,
      huduData.companyId
        ? `Found "${huduData.companyName}" in Hudu. ${huduData.articles.length} articles, ${totalAssets} assets (${huduData.priorityAssets.length} prioritized for ${context.classificationType ?? "general"}), ${huduData.vendors.length} vendors, ${huduData.passwords.length} credentials, ${huduData.procedures.length} procedures.`
        : `Could not find client "${context.clientName}" in Hudu. Running analysis with ticket info only.`,
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

    // Build programmatic links and merge with LLM output
    const programmaticLinks = buildHuduLinks(huduData);
    const adminLinks = buildAdminPortalLinks(context.summary, context.details);
    const llmLinks = (result.hudu_links as Array<{ label: string; url: string }>) ?? [];

    const existingUrls = new Set(programmaticLinks.map((l) => l.url));
    const mergedLinks = [
      ...programmaticLinks,
      ...adminLinks.filter((l) => !existingUrls.has(l.url)),
      ...llmLinks.filter((l) => l.url && !existingUrls.has(l.url) && !adminLinks.some((al) => al.url === l.url)),
    ].slice(0, 6);

    const programmaticPasswords = buildHuduPasswords(huduData);
    const llmPasswords = (result.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];
    const existingPwNames = new Set(programmaticPasswords.map((p) => p.name));
    const mergedPasswords = [
      ...programmaticPasswords,
      ...llmPasswords.filter((p) => p.name && !existingPwNames.has(p.name)),
    ].slice(0, 3);

    return {
      summary: (result.documentation_notes as string) ?? "No documentation found",
      data: {
        ...result,
        hudu_links: mergedLinks,
        relevant_passwords: mergedPasswords,
      },
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Hudu Data Fetching ──────────────────────────────────────────────

  private async fetchHuduData(context: TriageContext): Promise<HuduData> {
    const emptyResult: HuduData = {
      companyId: null,
      companyName: null,
      huduBaseUrl: null,
      articles: [],
      priorityAssets: [],
      otherAssets: [],
      vendors: [],
      passwords: [],
      procedures: [],
    };

    const huduConfig = await this.getHuduConfig();
    if (!huduConfig) return emptyResult;

    const hudu = new HuduClient(huduConfig);

    const companyId = await this.findCompanyId(hudu, context.clientName);
    if (!companyId) return emptyResult;

    const keywords = extractKeywords(context.summary, context.details);

    // Fetch asset layouts first — we need the ID mapping
    const layouts = await this.fetchAssetLayouts(hudu);

    // Determine which layouts to prioritize
    const classType = (context.classificationType ?? "other").toLowerCase();
    const priorityLayoutNames = CLASSIFICATION_LAYOUT_MAP[classType] ?? CLASSIFICATION_LAYOUT_MAP.other;
    const allRelevantNames = [...new Set([...priorityLayoutNames, ...ALWAYS_FETCH_LAYOUTS])];

    // Map layout names to IDs (fuzzy matching)
    const priorityLayoutIds = resolveLayoutIds(layouts, priorityLayoutNames);
    const vendorLayoutIds = resolveLayoutIds(layouts, ["Vendors"]);
    const allPriorityIds = new Set([...resolveLayoutIds(layouts, allRelevantNames)]);

    // Fetch everything in parallel
    const [articles, priorityAssets, otherAssets, passwords, procedures] = await Promise.all([
      this.searchArticles(hudu, companyId, keywords),
      this.fetchAssetsByLayouts(hudu, companyId, priorityLayoutIds, layouts),
      this.fetchOtherAssets(hudu, companyId, allPriorityIds, keywords, layouts),
      this.fetchPasswords(hudu, companyId),
      this.fetchProcedures(hudu, companyId),
    ]);

    // Separate vendors from priority assets
    const vendorIdSet = new Set(vendorLayoutIds);
    const vendors = priorityAssets.filter((a) => a.asset_layout_id != null && vendorIdSet.has(a.asset_layout_id));
    const nonVendorPriority = priorityAssets.filter((a) => !(a.asset_layout_id != null && vendorIdSet.has(a.asset_layout_id)));

    return {
      companyId,
      companyName: context.clientName,
      huduBaseUrl: huduConfig.base_url,
      articles,
      priorityAssets: nonVendorPriority,
      otherAssets,
      vendors,
      passwords,
      procedures,
    };
  }

  private async findCompanyId(
    hudu: HuduClient,
    clientName: string | null,
  ): Promise<number | null> {
    if (!clientName) return null;

    try {
      const companies = await hudu.searchCompanies(clientName);
      if (companies.length > 0) return companies[0].id;

      const firstWord = clientName.split(/\s+/)[0];
      if (firstWord && firstWord.length > 2) {
        const partialMatch = await hudu.searchCompanies(firstWord);
        if (partialMatch.length > 0) return partialMatch[0].id;
      }

      return null;
    } catch (error) {
      console.error("[DWIGHT] Failed to search Hudu companies:", error);
      return null;
    }
  }

  private async fetchAssetLayouts(hudu: HuduClient): Promise<ReadonlyArray<HuduAssetLayout>> {
    try {
      return await hudu.getAssetLayouts();
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch asset layouts:", error);
      return [];
    }
  }

  /** Fetch assets for specific layout IDs (the priority ones). */
  private async fetchAssetsByLayouts(
    hudu: HuduClient,
    companyId: number,
    layoutIds: ReadonlyArray<number>,
    layouts: ReadonlyArray<HuduAssetLayout>,
  ): Promise<ReadonlyArray<CategorizedAsset>> {
    if (layoutIds.length === 0) return [];

    try {
      const batches = await Promise.all(
        layoutIds.map((layoutId) =>
          hudu.getAssets({ company_id: companyId, asset_layout_id: layoutId, page_size: 50 }),
        ),
      );

      const layoutNameMap = buildLayoutNameMap(layouts);
      return batches.flatMap((batch) =>
        batch.map((asset) => ({
          ...asset,
          layoutName: layoutNameMap.get(asset.asset_layout_id ?? 0) ?? "Unknown",
        })),
      );
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch priority assets:", error);
      return [];
    }
  }

  /** Fetch other assets (not priority layouts) via keyword search for secondary context. */
  private async fetchOtherAssets(
    hudu: HuduClient,
    companyId: number,
    excludeLayoutIds: Set<number>,
    keywords: ReadonlyArray<string>,
    layouts: ReadonlyArray<HuduAssetLayout>,
  ): Promise<ReadonlyArray<CategorizedAsset>> {
    try {
      // Keyword search across all assets
      const keywordBatches = await Promise.all(
        keywords.slice(0, 3).map((kw) => hudu.searchAssets(kw, companyId)),
      );

      const layoutNameMap = buildLayoutNameMap(layouts);
      const assetMap = new Map<number, CategorizedAsset>();

      for (const batch of keywordBatches) {
        for (const asset of batch) {
          // Skip if already in priority layouts
          if (asset.asset_layout_id != null && excludeLayoutIds.has(asset.asset_layout_id)) continue;
          if (!assetMap.has(asset.id)) {
            assetMap.set(asset.id, {
              ...asset,
              layoutName: layoutNameMap.get(asset.asset_layout_id ?? 0) ?? "Unknown",
            });
          }
        }
      }

      return Array.from(assetMap.values()).slice(0, 30);
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch other assets:", error);
      return [];
    }
  }

  private async searchArticles(
    hudu: HuduClient,
    companyId: number,
    keywords: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<HuduArticle>> {
    try {
      const [allArticles, ...keywordBatches] = await Promise.all([
        hudu.getArticles({ company_id: companyId, page_size: 50 }),
        ...keywords.slice(0, 3).map((kw) => hudu.searchArticles(kw, companyId)),
      ]);

      const articleMap = new Map<number, HuduArticle>();
      for (const article of allArticles) articleMap.set(article.id, article);
      for (const batch of keywordBatches) {
        for (const article of batch) articleMap.set(article.id, article);
      }

      return Array.from(articleMap.values());
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch Hudu articles:", error);
      return [];
    }
  }

  private async fetchPasswords(
    hudu: HuduClient,
    companyId: number,
  ): Promise<ReadonlyArray<HuduPassword>> {
    try {
      return await hudu.getPasswords({ company_id: companyId });
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch Hudu passwords:", error);
      return [];
    }
  }

  private async fetchProcedures(
    hudu: HuduClient,
    companyId: number,
  ): Promise<ReadonlyArray<HuduProcedure>> {
    try {
      return await hudu.getProcedures(companyId);
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch Hudu procedures:", error);
      return [];
    }
  }

  private async getHuduConfig(): Promise<HuduConfig | null> {
    const { data } = await this.supabase
      .from("integrations")
      .select("config")
      .eq("service", "hudu")
      .eq("is_active", true)
      .single();

    return data ? (data.config as HuduConfig) : null;
  }

  // ── Message Builder ─────────────────────────────────────────────────

  private buildUserMessage(context: TriageContext, huduData: HuduData): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName) sections.push(`**Client:** ${context.clientName}`);
    if (context.userName) sections.push(`**Reported By:** ${context.userName}`);
    if (context.classificationType) sections.push(`**Classification:** ${context.classificationType}`);

    if (huduData.companyId) {
      sections.push("", "---");
      sections.push(`## Hudu Documentation for ${huduData.companyName} (ID: ${huduData.companyId})`);

      // KB Articles
      if (huduData.articles.length > 0) {
        sections.push("", `### Knowledge Base Articles (${huduData.articles.length})`);
        for (const article of huduData.articles) {
          const preview = stripHtml(article.content ?? "").slice(0, 500);
          sections.push(`- **${article.name}** (Folder: ${article.folder_name ?? "Root"}) (URL: ${article.url ?? "N/A"})`);
          if (preview) sections.push(`  > ${preview}`);
        }
      }

      // Priority Assets — the ones most relevant to this ticket type
      if (huduData.priorityAssets.length > 0) {
        sections.push("", `### Priority Assets for ${context.classificationType ?? "this issue"} (${huduData.priorityAssets.length})`);
        for (const asset of huduData.priorityAssets) {
          const fields = formatAssetFields(asset);
          sections.push(`- **${asset.name}** [${asset.layoutName}] (Model: ${asset.primary_model ?? "N/A"}, Serial: ${asset.primary_serial ?? "N/A"}) (URL: ${asset.url ?? "N/A"})`);
          if (fields) sections.push(`  Fields: ${fields}`);
        }
      }

      // Vendors — always important
      if (huduData.vendors.length > 0) {
        sections.push("", `### Vendors (${huduData.vendors.length})`);
        for (const vendor of huduData.vendors) {
          const fields = formatAssetFields(vendor);
          sections.push(`- **${vendor.name}** (URL: ${vendor.url ?? "N/A"})`);
          if (fields) sections.push(`  Details: ${fields}`);
        }
      }

      // Other Assets — secondary context from keyword search
      if (huduData.otherAssets.length > 0) {
        sections.push("", `### Other Related Assets (${huduData.otherAssets.length})`);
        for (const asset of huduData.otherAssets.slice(0, 15)) {
          const fields = formatAssetFields(asset);
          sections.push(`- **${asset.name}** [${asset.layoutName}] (Model: ${asset.primary_model ?? "N/A"}) (URL: ${asset.url ?? "N/A"})`);
          if (fields) sections.push(`  Fields: ${fields}`);
        }
      }

      // Passwords
      if (huduData.passwords.length > 0) {
        sections.push("", `### Credentials (${huduData.passwords.length} — links only, never expose values)`);
        for (const pw of huduData.passwords) {
          sections.push(`- **${pw.name}** (Type: ${pw.password_type ?? "N/A"}) ${pw.url ? `[View in Hudu](${pw.url})` : ""}`);
          if (pw.description) sections.push(`  Note: ${pw.description}`);
        }
      }

      // Procedures
      if (huduData.procedures.length > 0) {
        sections.push("", `### Procedures (${huduData.procedures.length})`);
        for (const proc of huduData.procedures) {
          const preview = stripHtml(proc.content ?? "").slice(0, 400);
          sections.push(`- **${proc.name}**`);
          if (proc.description) sections.push(`  ${proc.description}`);
          if (preview) sections.push(`  > ${preview}`);
        }
      }
    } else {
      sections.push("", "**Note:** No Hudu documentation found for this client. Analyze based on ticket information only.");
    }

    return sections.join("\n");
  }
}

// ── Layout Resolution ─────────────────────────────────────────────────

/** Resolve layout names to IDs using fuzzy matching. */
function resolveLayoutIds(
  layouts: ReadonlyArray<HuduAssetLayout>,
  targetNames: ReadonlyArray<string>,
): ReadonlyArray<number> {
  const ids: number[] = [];

  for (const target of targetNames) {
    const targetLower = target.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

    const match = layouts.find((layout) => {
      const layoutLower = layout.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      return (
        layoutLower === targetLower ||
        layoutLower.includes(targetLower) ||
        targetLower.includes(layoutLower)
      );
    });

    if (match) ids.push(match.id);
  }

  return ids;
}

function buildLayoutNameMap(layouts: ReadonlyArray<HuduAssetLayout>): Map<number, string> {
  const map = new Map<number, string>();
  for (const layout of layouts) map.set(layout.id, layout.name);
  return map;
}

// ── Hudu Link & Password Builders ───────────────────────────────────────

function buildHuduLinks(huduData: HuduData): ReadonlyArray<{ readonly label: string; readonly url: string }> {
  const links: Array<{ readonly label: string; readonly url: string }> = [];

  if (huduData.huduBaseUrl && huduData.companyId) {
    const baseUrl = huduData.huduBaseUrl.replace(/\/+$/, "");
    links.push({
      label: `${huduData.companyName ?? "Customer"} in Hudu`,
      url: `${baseUrl}/a/${huduData.companyId}`,
    });
  }

  // Priority assets first (max 2)
  for (const asset of huduData.priorityAssets.slice(0, 2)) {
    if (asset.url) links.push({ label: `${asset.layoutName}: ${asset.name}`, url: asset.url });
  }

  // Top KB articles (max 2)
  for (const article of huduData.articles.slice(0, 2)) {
    if (article.url) links.push({ label: `KB: ${article.name}`, url: article.url });
  }

  return links;
}

function buildHuduPasswords(huduData: HuduData): ReadonlyArray<{ readonly name: string; readonly type: string; readonly note: string }> {
  return huduData.passwords.map((pw) => ({
    name: pw.name,
    type: pw.password_type ?? "unknown",
    note: pw.description ?? "",
  }));
}

function buildAdminPortalLinks(
  summary: string,
  details: string | null,
): ReadonlyArray<{ readonly label: string; readonly url: string }> {
  const text = `${summary} ${details ?? ""}`.toLowerCase();

  if (
    text.includes("security") || text.includes("threat") || text.includes("defender") ||
    text.includes("phish") || text.includes("malware") || text.includes("virus") ||
    text.includes("breach") || text.includes("compromise")
  ) {
    return [{ label: "Security Portal", url: "https://security.microsoft.com" }];
  }

  if (text.includes("intune") || text.includes("autopilot") || text.includes("endpoint manager")) {
    return [{ label: "Intune", url: "https://intune.microsoft.com" }];
  }

  if (
    text.includes("email") || text.includes("mail") || text.includes("outlook") ||
    text.includes("exchange") || text.includes("ndr") || text.includes("bounce") ||
    text.includes("spam") || text.includes("delivery")
  ) {
    return [{ label: "Exchange Admin", url: "https://admin.exchange.microsoft.com" }];
  }

  if (
    text.includes("365") || text.includes("office") || text.includes("teams") ||
    text.includes("sharepoint") || text.includes("onedrive") || text.includes("license") ||
    text.includes("mfa") || text.includes("entra") || text.includes("azure ad")
  ) {
    return [{ label: "M365 Admin", url: "https://admin.microsoft.com" }];
  }

  if (text.includes("azure") || text.includes("vm") || text.includes("cloud")) {
    return [{ label: "Azure Portal", url: "https://portal.azure.com" }];
  }

  return [];
}

// ── Utilities ───────────────────────────────────────────────────────────

function formatAssetFields(asset: HuduAsset): string {
  return (asset.fields ?? [])
    .filter((f) => f.value != null && f.value !== "")
    .slice(0, 10)
    .map((f) => `${f.label}: ${f.value}`)
    .join(", ");
}

function extractKeywords(
  summary: string,
  details: string | null,
): ReadonlyArray<string> {
  const text = `${summary} ${details ?? ""}`.toLowerCase();

  const stopWords = new Set([
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "but", "in",
    "with", "to", "for", "of", "not", "no", "can", "cant", "cannot", "could",
    "should", "would", "will", "do", "does", "did", "have", "has", "had",
    "been", "be", "are", "was", "were", "being", "it", "its", "my", "our",
    "your", "their", "this", "that", "these", "from", "up", "out", "if",
    "about", "into", "through", "during", "before", "after", "above", "below",
    "between", "same", "than", "too", "very", "just", "also", "need", "help",
    "please", "hi", "hello", "thanks", "issue", "problem", "error", "working",
    "work", "works",
  ]);

  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 10);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
