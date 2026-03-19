import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../memory/embeddings.js";

/**
 * A potential duplicate ticket.
 */
export interface DuplicateCandidate {
  readonly ticketId: string;
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly similarity: number;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * Check if there are any open tickets that look like duplicates of this one.
 * Runs BEFORE full triage to flag potential duplicates early.
 *
 * Only checks tickets that are still open (pending, triaging, triaged).
 * Requires high similarity (>0.85) to flag as potential duplicate.
 */
export async function detectDuplicates(
  supabase: SupabaseClient,
  params: {
    readonly currentTicketId: string;
    readonly summary: string;
    readonly details: string | null;
    readonly clientName: string | null;
  },
): Promise<ReadonlyArray<DuplicateCandidate>> {
  const queryText = `${params.summary} ${params.details ?? ""}`.trim();
  const embedding = await generateEmbedding(queryText);

  if (!embedding) {
    // Fallback: exact summary match within same client
    return detectDuplicatesByText(supabase, params);
  }

  const { data, error } = await supabase.rpc("match_duplicate_tickets", {
    query_embedding: JSON.stringify(embedding),
    exclude_ticket_id: params.currentTicketId,
    match_threshold: 0.82,
    match_count: 5,
    filter_client: params.clientName,
  });

  if (error || !data) {
    console.warn("[DUPLICATE] Vector search failed:", error?.message);
    return detectDuplicatesByText(supabase, params);
  }

  return data as ReadonlyArray<DuplicateCandidate>;
}

/**
 * Text-based duplicate detection fallback.
 * Checks for very similar summaries in open tickets for the same client.
 */
async function detectDuplicatesByText(
  supabase: SupabaseClient,
  params: {
    readonly currentTicketId: string;
    readonly summary: string;
    readonly clientName: string | null;
  },
): Promise<ReadonlyArray<DuplicateCandidate>> {
  // Only check same-client tickets
  if (!params.clientName) return [];

  const { data, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, status, created_at")
    .neq("id", params.currentTicketId)
    .eq("client_name", params.clientName)
    .in("status", ["pending", "triaging", "triaged"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];

  // Simple Jaccard similarity on words
  const queryWords = new Set(
    params.summary.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2),
  );

  return data
    .map((t) => {
      const tWords = new Set(
        (t.summary as string).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2),
      );
      const intersection = [...queryWords].filter((w) => tWords.has(w)).length;
      const union = new Set([...queryWords, ...tWords]).size;
      const similarity = union > 0 ? intersection / union : 0;

      return {
        ticketId: t.id as string,
        haloId: t.halo_id as number,
        summary: t.summary as string,
        clientName: t.client_name as string | null,
        similarity,
        status: t.status as string,
        createdAt: t.created_at as string,
      };
    })
    .filter((t) => t.similarity > 0.6)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}
