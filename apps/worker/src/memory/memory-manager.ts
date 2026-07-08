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
    clientName?: string | null,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    const embedding = await generateEmbedding(queryText);

    if (embedding) {
      // Vector similarity search via pgvector
      return this.recallByEmbedding(agentName, embedding, clientName);
    }

    // Fallback: concept-based recall (when embeddings unavailable)
    return this.recallByConcepts(agentName, queryText, clientName);
  }

  /**
   * Embedding-based recall using pgvector cosine similarity.
   * After retrieval, applies recency decay and frequency weighting.
   */
  private async recallByEmbedding(
    agentName: string,
    embedding: ReadonlyArray<number>,
    clientName?: string | null,
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

    // Surface which client each memory was learned from — recall is
    // cross-client, and the consumer must be able to tell a same-client
    // environment fact from another customer's
    const withClient = (data as ReadonlyArray<MemoryMatch>).map((m) => ({
      ...m,
      client_name: (m.metadata?.client_name as string | undefined) ?? null,
    }));

    // Re-rank with composite scoring
    const ranked = this.applyCompositeScoring(withClient, clientName);

    const top = ranked.slice(0, this.config.max_recall);

    // Reinforce only the memories that are actually injected into the
    // prompt — reinforcing the whole candidate pool gave never-shown
    // memories eviction immunity
    await this.reinforceMemories(top.map((m) => m.id));

    return top;
  }

  /**
   * Concept-based recall fallback — extract concepts from query,
   * match against memory tags using array overlap.
   */
  private async recallByConcepts(
    agentName: string,
    queryText: string,
    clientName?: string | null,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    const concepts = await extractConcepts(queryText);

    if (concepts.length === 0) return [];

    // Use Supabase to find memories with overlapping tags
    const { data, error } = await this.supabase
      .from("agent_memories")
      .select(
        "id, agent_name, content, summary, memory_type, tags, confidence, metadata, created_at, times_recalled",
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

      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        agent_name: row.agent_name as string,
        content: row.content as string,
        summary: row.summary as string,
        memory_type: row.memory_type as MemoryType,
        tags: row.tags as ReadonlyArray<string>,
        confidence: row.confidence as number,
        similarity: this.clientAffinity(
          (metadata.client_name as string | undefined) ?? null,
          clientName,
        ) * similarity,
        metadata,
        created_at: row.created_at as string,
        times_recalled: row.times_recalled as number,
        client_name: (metadata.client_name as string | undefined) ?? null,
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
    memories: ReadonlyArray<MemoryMatch>,
    clientName?: string | null,
  ): ReadonlyArray<MemoryMatch> {
    const now = Date.now();

    const scored = memories.map((m) => {
      const ageHours = m.created_at
        ? (now - new Date(m.created_at).getTime()) / (1000 * 60 * 60)
        : 0;

      // Exponential recency decay
      const recencyScore = Math.exp(-this.config.decay_rate * ageHours);

      // Frequency score (normalized, capped at 20 recalls)
      const freqScore = Math.min((m.times_recalled ?? 0) / 20, 1);

      const finalScore =
        (m.similarity * this.config.similarity_weight +
          recencyScore * this.config.recency_weight +
          freqScore * this.config.frequency_weight) *
        this.clientAffinity(m.client_name ?? null, clientName);

      return { ...m, similarity: finalScore };
    });

    // Sort by composite score descending
    return [...scored].sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Client-affinity factor for recall ranking. A memory learned from a
   * DIFFERENT customer is rank-penalized (its environment facts don't
   * transfer), but not excluded — generic techniques still help. Memories
   * with no client tag are treated as client-agnostic knowledge.
   */
  private clientAffinity(
    memoryClient: string | null,
    currentClient: string | null | undefined,
  ): number {
    if (!memoryClient || !currentClient) return 1;
    return memoryClient.trim().toLowerCase() === currentClient.trim().toLowerCase()
      ? 1.1 // same client — its environment facts are directly relevant
      : 0.6; // different client — technique may transfer, facts do not
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
   * Recall memories from the shared "company_context" namespace.
   * All agents can read from this — it stores cross-cutting knowledge
   * like client-specific patterns, infrastructure notes, and org-wide insights.
   */
  async recallShared(
    queryText: string,
    clientName?: string | null,
  ): Promise<ReadonlyArray<MemoryMatch>> {
    return this.recall("company_context", queryText, clientName);
  }

  /**
   * Store a memory in the shared namespace that all agents can access.
   */
  async createSharedMemory(params: {
    readonly ticket_id: string | null;
    readonly content: string;
    readonly summary: string;
    readonly memory_type: MemoryType;
    readonly confidence?: number;
    readonly metadata?: Record<string, unknown>;
  }): Promise<string> {
    return this.createMemory({
      ...params,
      agent_name: "company_context",
    });
  }

  /**
   * Evict stale, low-value memories to prevent unbounded growth.
   *
   * Eviction criteria:
   * 1. Older than `maxAgeDays` AND never recalled → delete
   * 2. Older than `maxAgeDays * 2` AND recalled < 2 times → delete
   * 3. Confidence below `minConfidence` AND older than 7 days → delete
   *
   * Returns the number of memories evicted.
   */
  async evictStaleMemories(params?: {
    readonly maxAgeDays?: number;
    readonly minConfidence?: number;
  }): Promise<number> {
    const maxAgeDays = params?.maxAgeDays ?? 90;
    const minConfidence = params?.minConfidence ?? 0.3;

    const cutoffDate = new Date(
      Date.now() - maxAgeDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const deepCutoffDate = new Date(
      Date.now() - maxAgeDays * 2 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const recentCutoff = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    let evicted = 0;

    // 1. Old + never recalled
    const { data: neverRecalled } = await this.supabase
      .from("agent_memories")
      .select("id")
      .lt("created_at", cutoffDate)
      .eq("times_recalled", 0);

    if (neverRecalled && neverRecalled.length > 0) {
      const ids = neverRecalled.map((m) => m.id as string);
      await this.supabase
        .from("agent_memories")
        .delete()
        .in("id", ids);
      evicted += ids.length;
      console.log(`[MEMORY] Evicted ${ids.length} never-recalled memories older than ${maxAgeDays}d`);
    }

    // 2. Very old + rarely recalled
    const { data: rarelyRecalled } = await this.supabase
      .from("agent_memories")
      .select("id")
      .lt("created_at", deepCutoffDate)
      .lt("times_recalled", 2);

    if (rarelyRecalled && rarelyRecalled.length > 0) {
      const ids = rarelyRecalled.map((m) => m.id as string);
      await this.supabase
        .from("agent_memories")
        .delete()
        .in("id", ids);
      evicted += ids.length;
      console.log(`[MEMORY] Evicted ${ids.length} rarely-recalled memories older than ${maxAgeDays * 2}d`);
    }

    // 3. Low confidence + not recent
    const { data: lowConfidence } = await this.supabase
      .from("agent_memories")
      .select("id")
      .lt("confidence", minConfidence)
      .lt("created_at", recentCutoff);

    if (lowConfidence && lowConfidence.length > 0) {
      const ids = lowConfidence.map((m) => m.id as string);
      await this.supabase
        .from("agent_memories")
        .delete()
        .in("id", ids);
      evicted += ids.length;
      console.log(`[MEMORY] Evicted ${ids.length} low-confidence memories (< ${minConfidence})`);
    }

    console.log(`[MEMORY] Eviction complete: ${evicted} total memories removed`);
    return evicted;
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
