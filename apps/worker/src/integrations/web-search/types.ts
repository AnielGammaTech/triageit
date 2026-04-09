// apps/worker/src/integrations/web-search/types.ts

export interface SearchResult {
  readonly title: string;
  readonly link: string;
  readonly snippet: string;
  readonly displayLink: string;
}

export interface SearchResponse {
  readonly results: ReadonlyArray<SearchResult>;
  readonly totalResults: number;
  readonly query: string;
}
