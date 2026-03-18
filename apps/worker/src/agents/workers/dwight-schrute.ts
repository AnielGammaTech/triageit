import type { MemoryMatch, HuduConfig } from "@triageit/shared";
import { BaseAgent, type AgentResult } from "../base-agent.js";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import {
  HuduClient,
  type HuduArticle,
  type HuduAsset,
  type HuduPassword,
  type HuduProcedure,
} from "../../integrations/hudu/client.js";

/**
 * Dwight Schrute — IT Documentation & Assets (Hudu)
 *
 * "Assistant to the Regional Manager"
 * Queries real Hudu data: KB articles, assets, printers, passwords,
 * procedures — and feeds it all to the AI for comprehensive analysis.
 */

interface HuduData {
  readonly companyId: number | null;
  readonly companyName: string | null;
  readonly articles: ReadonlyArray<HuduArticle>;
  readonly assets: ReadonlyArray<HuduAsset>;
  readonly passwords: ReadonlyArray<HuduPassword>;
  readonly procedures: ReadonlyArray<HuduProcedure>;
}

export class DwightSchruteAgent extends BaseAgent {
  protected getAgentInstructions(): string {
    return `## Your Mission
You are the documentation expert. You have REAL data from Hudu (the IT documentation platform).
Analyze the provided Hudu data to find anything relevant to the reported issue.

## What You Have Access To
- KB Articles (knowledge base documentation per client)
- Assets (servers, workstations, printers, network devices)
- Passwords/credentials (names and types only — never expose actual passwords)
- Procedures (step-by-step processes documented for this client)

## Your Job
1. Review ALL provided Hudu data carefully
2. Identify which assets, articles, or procedures are relevant to the ticket
3. Highlight any documented solutions or troubleshooting steps
4. Note if the client has specific configurations that affect this issue
5. If relevant passwords exist, note them (by name only) so the tech knows where to look

## Output Format
Respond with ONLY valid JSON:
{
  "relevant_assets": [{"name": "<asset>", "type": "<type>", "model": "<model if known>", "relevance": "<why this asset matters>"}],
  "kb_articles": [{"title": "<title>", "summary": "<key information from this article>", "actionable_steps": "<specific steps if applicable>"}],
  "procedures": [{"title": "<title>", "steps_summary": "<key steps relevant to this issue>"}],
  "relevant_passwords": [{"name": "<credential name>", "type": "<type>", "note": "<what this credential is for>"}],
  "client_config_notes": "<any client-specific configurations that affect this issue>",
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
    // 1. Fetch real Hudu data for this client
    const huduData = await this.fetchHuduData(context);

    // 2. Build a rich user message with real data
    const userMessage = this.buildUserMessage(context, huduData);

    // 3. Log what we found
    await this.logThinking(
      context.ticketId,
      huduData.companyId
        ? `Found client "${huduData.companyName}" in Hudu (ID: ${huduData.companyId}). Retrieved ${huduData.articles.length} KB articles, ${huduData.assets.length} assets, ${huduData.passwords.length} credentials, ${huduData.procedures.length} procedures. Analyzing all documentation now.`
        : `Could not find client "${context.clientName}" in Hudu. Running analysis with ticket info only.`,
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
      summary:
        (result.documentation_notes as string) ?? "No documentation found",
      data: result,
      confidence: (result.confidence as number) ?? 0.5,
    };
  }

  // ── Hudu Data Fetching ──────────────────────────────────────────────

  private async fetchHuduData(context: TriageContext): Promise<HuduData> {
    const emptyResult: HuduData = {
      companyId: null,
      companyName: null,
      articles: [],
      assets: [],
      passwords: [],
      procedures: [],
    };

    const huduConfig = await this.getHuduConfig();
    if (!huduConfig) return emptyResult;

    const hudu = new HuduClient(huduConfig);

    // Find the company in Hudu by client name
    const companyId = await this.findCompanyId(hudu, context.clientName);
    if (!companyId) return emptyResult;

    // Extract keywords from ticket for targeted searches
    const keywords = extractKeywords(context.summary, context.details);

    // Fetch all data in parallel
    const [articles, assets, passwords, procedures] = await Promise.all([
      this.searchArticles(hudu, companyId, keywords),
      this.searchAssets(hudu, companyId, keywords),
      this.fetchPasswords(hudu, companyId),
      this.fetchProcedures(hudu, companyId),
    ]);

    return {
      companyId,
      companyName: context.clientName,
      articles,
      assets,
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

      // Try partial match — first word of company name
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

  private async searchArticles(
    hudu: HuduClient,
    companyId: number,
    keywords: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<HuduArticle>> {
    try {
      // Get all articles for this company first
      const allArticles = await hudu.getArticles({
        company_id: companyId,
        page_size: 50,
      });

      // Also search by keywords for more targeted results
      const keywordArticles = await Promise.all(
        keywords.slice(0, 3).map((kw) => hudu.searchArticles(kw, companyId)),
      );

      // Merge and deduplicate
      const articleMap = new Map<number, HuduArticle>();
      for (const article of allArticles) {
        articleMap.set(article.id, article);
      }
      for (const batch of keywordArticles) {
        for (const article of batch) {
          articleMap.set(article.id, article);
        }
      }

      return Array.from(articleMap.values());
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch Hudu articles:", error);
      return [];
    }
  }

  private async searchAssets(
    hudu: HuduClient,
    companyId: number,
    keywords: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<HuduAsset>> {
    try {
      // Get all assets for this company
      const allAssets = await hudu.getAssets({
        company_id: companyId,
        page_size: 100,
      });

      // Also search by keywords
      const keywordAssets = await Promise.all(
        keywords.slice(0, 3).map((kw) => hudu.searchAssets(kw, companyId)),
      );

      // Merge and deduplicate
      const assetMap = new Map<number, HuduAsset>();
      for (const asset of allAssets) {
        assetMap.set(asset.id, asset);
      }
      for (const batch of keywordAssets) {
        for (const asset of batch) {
          assetMap.set(asset.id, asset);
        }
      }

      return Array.from(assetMap.values());
    } catch (error) {
      console.error("[DWIGHT] Failed to fetch Hudu assets:", error);
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

  private buildUserMessage(
    context: TriageContext,
    huduData: HuduData,
  ): string {
    const sections: string[] = [
      `## Ticket #${context.haloId}`,
      `**Subject:** ${context.summary}`,
    ];

    if (context.details) sections.push(`**Description:** ${context.details}`);
    if (context.clientName)
      sections.push(`**Client:** ${context.clientName}`);
    if (context.userName)
      sections.push(`**Reported By:** ${context.userName}`);

    // Add Hudu data sections
    if (huduData.companyId) {
      sections.push("");
      sections.push("---");
      sections.push(
        `## Hudu Documentation for ${huduData.companyName} (Company ID: ${huduData.companyId})`,
      );

      // KB Articles
      if (huduData.articles.length > 0) {
        sections.push("");
        sections.push(
          `### Knowledge Base Articles (${huduData.articles.length} found)`,
        );
        for (const article of huduData.articles) {
          const preview = stripHtml(article.content ?? "").slice(0, 500);
          sections.push(
            `- **${article.name}** (Folder: ${article.folder_name ?? "Root"})`,
          );
          if (preview) sections.push(`  > ${preview}`);
        }
      }

      // Assets
      if (huduData.assets.length > 0) {
        sections.push("");
        sections.push(`### Assets (${huduData.assets.length} found)`);
        for (const asset of huduData.assets) {
          const fields = (asset.fields ?? [])
            .filter((f) => f.value != null && f.value !== "")
            .slice(0, 8)
            .map((f) => `${f.label}: ${f.value}`)
            .join(", ");
          sections.push(
            `- **${asset.name}** (Model: ${asset.primary_model ?? "N/A"}, Manufacturer: ${asset.primary_manufacturer ?? "N/A"}, Serial: ${asset.primary_serial ?? "N/A"})`,
          );
          if (fields) sections.push(`  Fields: ${fields}`);
        }
      }

      // Passwords (names only — NEVER expose actual passwords)
      if (huduData.passwords.length > 0) {
        sections.push("");
        sections.push(
          `### Credentials (${huduData.passwords.length} found — names only)`,
        );
        for (const pw of huduData.passwords) {
          sections.push(
            `- **${pw.name}** (Type: ${pw.password_type ?? "N/A"}, Username: ${pw.username ?? "N/A"})`,
          );
          if (pw.description) sections.push(`  Note: ${pw.description}`);
        }
      }

      // Procedures
      if (huduData.procedures.length > 0) {
        sections.push("");
        sections.push(
          `### Procedures (${huduData.procedures.length} found)`,
        );
        for (const proc of huduData.procedures) {
          const preview = stripHtml(proc.content ?? "").slice(0, 400);
          sections.push(`- **${proc.name}**`);
          if (proc.description) sections.push(`  ${proc.description}`);
          if (preview) sections.push(`  > ${preview}`);
        }
      }
    } else {
      sections.push("");
      sections.push(
        "**Note:** No Hudu documentation found for this client. Analyze based on ticket information only.",
      );
    }

    return sections.join("\n");
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Extract meaningful keywords from ticket subject and details for Hudu search.
 */
function extractKeywords(
  summary: string,
  details: string | null,
): ReadonlyArray<string> {
  const text = `${summary} ${details ?? ""}`.toLowerCase();

  // Remove common noise words
  const stopWords = new Set([
    "the",
    "is",
    "at",
    "which",
    "on",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "with",
    "to",
    "for",
    "of",
    "not",
    "no",
    "can",
    "cant",
    "cannot",
    "could",
    "should",
    "would",
    "will",
    "do",
    "does",
    "did",
    "have",
    "has",
    "had",
    "been",
    "be",
    "are",
    "was",
    "were",
    "being",
    "it",
    "its",
    "my",
    "our",
    "your",
    "their",
    "this",
    "that",
    "these",
    "from",
    "up",
    "out",
    "if",
    "about",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "same",
    "than",
    "too",
    "very",
    "just",
    "also",
    "need",
    "help",
    "please",
    "hi",
    "hello",
    "thanks",
    "issue",
    "problem",
    "error",
    "working",
    "work",
    "works",
  ]);

  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Deduplicate and return top keywords
  return [...new Set(words)].slice(0, 10);
}

/**
 * Strip HTML tags from a string for clean text previews.
 */
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
