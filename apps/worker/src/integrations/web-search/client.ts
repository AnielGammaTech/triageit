// apps/worker/src/integrations/web-search/client.ts

import type { SearchResult, SearchResponse } from "./types.js";

/**
 * WebSearchClient — Brave Search API wrapper (Google Custom Search fallback).
 *
 * Usage: Agents call this when memory + skills don't cover the ticket.
 * Keeps results concise (top 5) to avoid prompt bloat.
 */
export class WebSearchClient {
  private static readonly BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
  private static readonly GOOGLE_URL = "https://www.googleapis.com/customsearch/v1";
  private readonly provider: "brave" | "google";
  private readonly apiKey: string;
  private readonly cx: string | null;

  constructor(provider: "brave" | "google", apiKey: string, cx: string | null = null) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.cx = cx;
  }

  /**
   * Create a client from env vars. Prefers Brave; falls back to Google
   * Custom Search when only that is configured. Null if neither.
   */
  static fromEnv(): WebSearchClient | null {
    const brave = process.env.BRAVE_SEARCH_API_KEY;
    if (brave) return new WebSearchClient("brave", brave);
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    if (apiKey && cx) return new WebSearchClient("google", apiKey, cx);
    return null;
  }

  async search(
    query: string,
    maxResults: number = 5,
  ): Promise<SearchResponse> {
    try {
      return this.provider === "brave"
        ? await this.searchBrave(query, maxResults)
        : await this.searchGoogle(query, maxResults);
    } catch (error) {
      console.error(`[WEB-SEARCH] Search failed for "${query}":`, error);
      return { results: [], totalResults: 0, query };
    }
  }

  private async searchBrave(query: string, maxResults: number): Promise<SearchResponse> {
    const url = new URL(WebSearchClient.BRAVE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(maxResults, 20)));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error(`[WEB-SEARCH] Brave API failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
      return { results: [], totalResults: 0, query };
    }

    const data = (await response.json()) as {
      readonly web?: {
        readonly results?: ReadonlyArray<{
          readonly title: string;
          readonly url: string;
          readonly description?: string;
        }>;
      };
    };

    const results: ReadonlyArray<SearchResult> = (data.web?.results ?? [])
      .slice(0, maxResults)
      .map((item) => ({
        title: item.title,
        link: item.url,
        snippet: (item.description ?? "").replace(/<[^>]*>/g, ""),
        displayLink: safeHostname(item.url),
      }));

    return { results, totalResults: results.length, query };
  }

  private async searchGoogle(query: string, maxResults: number): Promise<SearchResponse> {
    const url = new URL(WebSearchClient.GOOGLE_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.cx ?? "");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(maxResults, 10)));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.error(`[WEB-SEARCH] Google API failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
      return { results: [], totalResults: 0, query };
    }

    const data = (await response.json()) as {
      readonly items?: ReadonlyArray<{
        readonly title: string;
        readonly link: string;
        readonly snippet: string;
        readonly displayLink: string;
      }>;
      readonly searchInformation?: { readonly totalResults: string };
    };

    const results: ReadonlyArray<SearchResult> = (data.items ?? []).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      displayLink: item.displayLink,
    }));

    return { results, totalResults: parseInt(data.searchInformation?.totalResults ?? "0", 10), query };
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

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
