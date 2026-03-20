import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../memory/embeddings.js";

/**
 * A similar ticket match — used to show "This ticket is similar to..." in Halo notes.
 */
export interface SimilarTicket {
  readonly ticketId: string;
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly classification: string | null;
  readonly similarity: number;
  readonly resolvedAt: string | null;
  readonly status: string;
}

/**
 * Find tickets similar to the current one using:
 * 1. Vector similarity (pgvector) on ticket summary embeddings
 * 2. Same client prioritized
 * 3. Only returns tickets that are triaged/resolved (not pending)
 *
 * Returns up to `maxResults` similar tickets, sorted by similarity descending.
 */
export async function findSimilarTickets(
  supabase: SupabaseClient,
  params: {
    readonly currentTicketId: string;
    readonly summary: string;
    readonly details: string | null;
    readonly clientName: string | null;
    readonly maxResults?: number;
    readonly minSimilarity?: number;
  },
): Promise<ReadonlyArray<SimilarTicket>> {
  const maxResults = params.maxResults ?? 5;
  const minSimilarity = params.minSimilarity ?? 0.78;

  // Generate embedding for the current ticket's content
  const queryText = `${params.summary} ${params.details ?? ""}`.trim();
  const embedding = await generateEmbedding(queryText);

  if (!embedding) {
    // Fallback: text-based search using Supabase full-text
    return findSimilarByText(supabase, params.currentTicketId, params.summary, params.clientName, maxResults);
  }

  // Use pgvector similarity search via RPC
  const { data, error } = await supabase.rpc("match_similar_tickets", {
    query_embedding: JSON.stringify(embedding),
    exclude_ticket_id: params.currentTicketId,
    match_threshold: minSimilarity,
    match_count: maxResults * 2, // Fetch extra for re-ranking
  });

  if (error || !data) {
    console.warn("[SIMILAR] Vector search failed, falling back to text:", error?.message);
    return findSimilarByText(supabase, params.currentTicketId, params.summary, params.clientName, maxResults);
  }

  // Re-rank: boost same-client matches
  const ranked = (data as ReadonlyArray<SimilarTicket & { readonly similarity: number }>)
    .map((t) => ({
      ...t,
      similarity: t.clientName === params.clientName
        ? Math.min(t.similarity * 1.15, 1.0) // 15% boost for same client
        : t.similarity,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);

  return ranked;
}

/**
 * Text-based fallback when embeddings are unavailable.
 * Uses Supabase ilike for basic keyword matching.
 */
async function findSimilarByText(
  supabase: SupabaseClient,
  excludeTicketId: string,
  summary: string,
  clientName: string | null,
  maxResults: number,
): Promise<ReadonlyArray<SimilarTicket>> {
  // Extract meaningful words (>3 chars, skip common IT noise words)
  const stopWords = new Set([
    "that", "this", "with", "from", "have", "been", "will", "would",
    "could", "should", "about", "their", "there", "when", "what",
    "need", "help", "please", "issue", "problem", "ticket", "request",
    "user", "unable", "working", "work", "does", "doesn",
  ]);

  const keywords = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);

  if (keywords.length === 0) return [];

  // Search using the most specific keyword (longest word)
  const bestKeyword = [...keywords].sort((a, b) => b.length - a.length)[0];
  const searchPattern = `%${bestKeyword}%`;

  const { data, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, status, created_at")
    .neq("id", excludeTicketId)
    .in("status", ["triaged", "resolved", "closed"])
    .ilike("summary", searchPattern)
    .order("created_at", { ascending: false })
    .limit(maxResults * 3); // Fetch extra to filter down

  if (error || !data) return [];

  // Score by keyword overlap — require at least 2 keyword matches
  return data.map((t) => {
    const tWords = (t.summary as string).toLowerCase().split(/\s+/);
    const overlap = keywords.filter((k) =>
      tWords.some((w) => w === k || (w.length > 4 && k.length > 4 && w.includes(k))),
    ).length;
    const baseSimilarity = overlap / Math.max(keywords.length, 1);
    const similarity = (t.client_name as string | null) === clientName
      ? Math.min(baseSimilarity * 1.1, 1.0) // 10% boost (reduced from 15%)
      : baseSimilarity;

    return {
      ticketId: t.id as string,
      haloId: t.halo_id as number,
      summary: t.summary as string,
      clientName: t.client_name as string | null,
      classification: null,
      similarity,
      resolvedAt: null,
      status: t.status as string,
    };
  })
  .filter((t) => t.similarity >= 0.5 && keywords.length >= 2 ? true : t.similarity >= 0.7)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, maxResults);
}

/**
 * Store a ticket embedding for future similarity searches.
 * Called after triage completes to index the ticket.
 */
export async function storeTicketEmbedding(
  supabase: SupabaseClient,
  params: {
    readonly ticketId: string;
    readonly haloId: number;
    readonly summary: string;
    readonly details: string | null;
    readonly classification: string | null;
    readonly clientName: string | null;
  },
): Promise<void> {
  const queryText = `${params.summary} ${params.details ?? ""}`.trim();
  const embedding = await generateEmbedding(queryText);

  if (!embedding) return;

  // Upsert to ticket_embeddings table
  const { error } = await supabase
    .from("ticket_embeddings")
    .upsert(
      {
        ticket_id: params.ticketId,
        halo_id: params.haloId,
        summary: params.summary,
        classification: params.classification,
        client_name: params.clientName,
        embedding: JSON.stringify(embedding),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticket_id" },
    );

  if (error) {
    console.warn("[SIMILAR] Failed to store ticket embedding:", error.message);
  }
}
