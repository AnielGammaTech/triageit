import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryType, MemoryMatch, MemoryConfig } from "@triageit/shared";
import { DEFAULT_MEMORY_CONFIG } from "@triageit/shared";
import { generateEmbedding, extractConcepts } from "./embeddings.js";

/**
 * MemoryManager — Memoripy-inspired memory system for triage agents.
 *
 * Architecture (adapted from memoripy):
 * 1. Concept Extraction — extract key technical concepts from ticket content
 * 2. Embedding Generation — vector representation for semantic similarity
 * 3. Memory Storage — persist to Supabase pgvector with metadata
 * 4. Memory Recall — composite scoring: similarity × recency × frequency
 * 5. Memory Decay — older, unused memories score lower naturally
 * 6. Reinforcement — recalled memories get boosted (times_recalled++)
 */
export class MemoryManager {
  private readonly supabase: SupabaseClient;
  private readonly config: MemoryConfig;

  constructor(supabase: SupabaseClient, config?: Partial<MemoryConfig>) {
    this.supabase = supabase;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /**
   * Store a new memory from a ticket resolution.
   * Extracts concepts, generates embedding, and persists to DB.
   */
  async createMemory(params: {
    readonly agent_name: string;
    readonly ticket_id: string | null;
    readonly content: string;
    readonly summary: string;
    readonly memory_type: MemoryType;
    readonly confidence?: number;
    readonly metadata?: Record<string, unknown>;
  }): Promise<string> {
    // Extract concepts for tagging
    const tags = await extractConcepts(params.content);

    // Generate embedding for similarity search
    const embedding = await generateEmbedding(params.content);

    const { data, error } = await this.supabase
      .from("agent_memories")
      .insert({
        agent_name: params.agent_name,
        ticket_id: params.ticket_id,
        content: params.content,
        summary: params.summary,
        embedding: embedding ? JSON.stringify(embedding) : null,
        memory_type: params.memory_type,
        tags,
        confidence: params.confidence ?? 0.8,
        metadata: params.metadata ?? {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("[MEMORY] Failed to create memory:", error.message);
      throw new Error(`Memory creation failed: ${error.message}`);
    }

    console.log(
      `[MEMORY] Created ${params.memory_type} memory for ${params.agent_name}: ${params.summary}`,
    );
    return data.id;
  }

  /**
   * Recall relevant memories for an agent based on query text.
   * Uses composite scoring: embedding similarity × recency decay × usage frequency.
   *
   * Inspired by memoripy's spreading activation — concept overlap boosts results.
   */
  async recall(
    agentName: string,
    queryText: string,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    const embedding = await generateEmbedding(queryText);

    if (embedding) {
      // Vector similarity search via pgvector
      return this.recallByEmbedding(agentName, embedding);
    }

    // Fallback: concept-based recall (when embeddings unavailable)
    return this.recallByConcepts(agentName, queryText);
  }

  /**
   * Embedding-based recall using pgvector cosine similarity.
   * After retrieval, applies recency decay and frequency weighting.
   */
  private async recallByEmbedding(
    agentName: string,
    embedding: ReadonlyArray<number>,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    const { data, error } = await this.supabase.rpc("match_agent_memories", {
      query_embedding: JSON.stringify(embedding),
      match_agent: agentName,
      match_threshold: this.config.match_threshold,
      match_count: this.config.max_recall * 2, // Fetch extra for re-ranking
    });

    if (error || !data) {
      console.warn("[MEMORY] Embedding recall failed:", error?.message);
      return [];
    }

    // Re-rank with composite scoring
    const ranked = this.applyCompositeScoring(
      data as ReadonlyArray<MemoryMatch & { readonly created_at?: string }>,
    );

    // Reinforce recalled memories
    await this.reinforceMemories(ranked.map((m) => m.id));

    return ranked.slice(0, this.config.max_recall);
  }

  /**
   * Concept-based recall fallback — extract concepts from query,
   * match against memory tags using array overlap.
   */
  private async recallByConcepts(
    agentName: string,
    queryText: string,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    const concepts = await extractConcepts(queryText);

    if (concepts.length === 0) return [];

    // Use Supabase to find memories with overlapping tags
    const { data, error } = await this.supabase
      .from("agent_memories")
      .select(
        "id, agent_name, content, summary, memory_type, tags, confidence",
      )
      .eq("agent_name", agentName)
      .overlaps("tags", concepts as string[])
      .order("created_at", { ascending: false })
      .limit(this.config.max_recall);

    if (error || !data) {
      console.warn("[MEMORY] Concept recall failed:", error?.message);
      return [];
    }

    // Calculate tag overlap as similarity proxy
    const results: ReadonlyArray<MemoryMatch> = data.map((row) => {
      const memTags = (row.tags as string[]) ?? [];
      const overlap = memTags.filter((t) =>
        concepts.some((c) => t.includes(c as string) || (c as string).includes(t)),
      ).length;
      const similarity = overlap / Math.max(concepts.length, 1);

      return {
        id: row.id as string,
        agent_name: row.agent_name as string,
        content: row.content as string,
        summary: row.summary as string,
        memory_type: row.memory_type as MemoryType,
        tags: row.tags as ReadonlyArray<string>,
        confidence: row.confidence as number,
        similarity,
      };
    });

    // Reinforce recalled memories
    await this.reinforceMemories(results.map((m) => m.id));

    return results;
  }

  /**
   * Composite scoring inspired by memoripy:
   * final_score = (similarity × similarity_weight) +
   *               (recency × recency_weight) +
   *               (frequency × frequency_weight)
   *
   * Recency uses exponential decay: e^(-decay_rate × hours_ago)
   */
  private applyCompositeScoring(
    memories: ReadonlyArray<
      MemoryMatch & { readonly created_at?: string }
    >,
  ): ReadonlyArray<MemoryMatch> {
    const now = Date.now();

    const scored = memories.map((m) => {
      const ageHours = m.created_at
        ? (now - new Date(m.created_at).getTime()) / (1000 * 60 * 60)
        : 0;

      // Exponential recency decay
      const recencyScore = Math.exp(-this.config.decay_rate * ageHours);

      // Frequency score (normalized, capped at 20 recalls)
      const freqScore = Math.min(
        ((m as unknown as { times_recalled?: number }).times_recalled ?? 0) /
          20,
        1,
      );

      const finalScore =
        m.similarity * this.config.similarity_weight +
        recencyScore * this.config.recency_weight +
        freqScore * this.config.frequency_weight;

      return { ...m, similarity: finalScore };
    });

    // Sort by composite score descending
    return [...scored].sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Reinforce recalled memories by incrementing times_recalled.
   * This implements the memoripy "strengthening" concept —
   * frequently useful memories resist decay.
   */
  private async reinforceMemories(
    memoryIds: ReadonlyArray<string>,
  ): Promise<void> {
    if (memoryIds.length === 0) return;

    for (const id of memoryIds) {
      // Read current count, then increment
      const { data } = await this.supabase
        .from("agent_memories")
        .select("times_recalled")
        .eq("id", id)
        .single();

      const currentCount = (data?.times_recalled as number) ?? 0;

      await this.supabase
        .from("agent_memories")
        .update({
          times_recalled: currentCount + 1,
          last_recalled_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
  }

  /**
   * Get all memories for an agent, optionally filtered by type.
   */
  async getMemories(
    agentName: string,
    memoryType?: MemoryType,
  ): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly summary: string;
      readonly memory_type: MemoryType;
      readonly tags: ReadonlyArray<string>;
      readonly confidence: number;
      readonly times_recalled: number;
      readonly created_at: string;
    }>
  > {
    let query = this.supabase
      .from("agent_memories")
      .select(
        "id, summary, memory_type, tags, confidence, times_recalled, created_at",
      )
      .eq("agent_name", agentName)
      .order("created_at", { ascending: false });

    if (memoryType) {
      query = query.eq("memory_type", memoryType);
    }

    const { data } = await query.limit(100);
    return (data ?? []) as ReadonlyArray<{
      readonly id: string;
      readonly summary: string;
      readonly memory_type: MemoryType;
      readonly tags: ReadonlyArray<string>;
      readonly confidence: number;
      readonly times_recalled: number;
      readonly created_at: string;
    }>;
  }
}
