// apps/worker/src/integrations/web-search/client.ts

import type { SearchResult, SearchResponse } from "./types.js";

/**
 * WebSearchClient — Google Custom Search API wrapper.
 * Falls back gracefully if API key is not configured.
 *
 * Usage: Agents call this when memory + skills don't cover the ticket.
 * Keeps results concise (top 5) to avoid prompt bloat.
 */
export class WebSearchClient {
  private static readonly BASE_URL =
    "https://www.googleapis.com/customsearch/v1";
  private readonly apiKey: string;
  private readonly cx: string;

  constructor(apiKey: string, cx: string) {
    this.apiKey = apiKey;
    this.cx = cx;
  }

  /**
   * Create a client from env vars. Returns null if not configured.
   */
  static fromEnv(): WebSearchClient | null {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    if (!apiKey || !cx) return null;
    return new WebSearchClient(apiKey, cx);
  }

  /**
   * Search Google and return top results.
   */
  async search(
    query: string,
    maxResults: number = 5,
  ): Promise<SearchResponse> {
    const url = new URL(WebSearchClient.BASE_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.cx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(maxResults, 10)));

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[WEB-SEARCH] Google API failed (${response.status}): ${text}`,
      );
      return { results: [], totalResults: 0, query };
    }

    const data = (await response.json()) as {
      readonly items?: ReadonlyArray<{
        readonly title: string;
        readonly link: string;
        readonly snippet: string;
        readonly displayLink: string;
      }>;
      readonly searchInformation?: {
        readonly totalResults: string;
      };
    };

    const results: ReadonlyArray<SearchResult> = (data.items ?? []).map(
      (item) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink,
      }),
    );

    return {
      results,
      totalResults: parseInt(
        data.searchInformation?.totalResults ?? "0",
        10,
      ),
      query,
    };
  }

  /**
   * Search for a specific vendor/product support page.
   * Useful for finding driver downloads, firmware updates, KB articles.
   */
  async searchVendorSupport(
    vendor: string,
    product: string,
    issue: string,
  ): Promise<SearchResponse> {
    const query = `${vendor} ${product} ${issue} site:support.* OR site:*.com/support OR site:download.*`;
    return this.search(query);
  }

  /**
   * Format search results for injection into an agent prompt.
   */
  static formatForPrompt(response: SearchResponse): string {
    if (response.results.length === 0) return "";

    const items = response.results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.link}\n   ${r.snippet}`,
      )
      .join("\n\n");

    return `\n---\n# Web Search Results (query: "${response.query}")\n\n${items}\n---\n`;
  }
}
