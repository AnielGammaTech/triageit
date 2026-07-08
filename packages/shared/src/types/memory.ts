// ── Skill Types ───────────────────────────────────────────────────────

export type SkillType =
  | "instruction"
  | "procedure"
  | "runbook"
  | "template"
  | "context";

export interface AgentSkill {
  readonly id: string;
  readonly agent_name: string;
  readonly title: string;
  readonly content: string;
  readonly skill_type: SkillType;
  readonly is_active: boolean;
  readonly metadata: {
    readonly times_used?: number;
    readonly source_agent?: string;
    readonly source_ticket?: string;
    readonly auto_generated?: boolean;
    readonly [key: string]: unknown;
  };
  readonly created_at: string;
  readonly updated_at: string;
}

// ── Memory Types ──────────────────────────────────────────────────────

export type MemoryType =
  | "resolution"
  | "pattern"
  | "insight"
  | "escalation"
  | "workaround";

export interface AgentMemory {
  readonly id: string;
  readonly agent_name: string;
  readonly ticket_id: string | null;
  readonly content: string;
  readonly summary: string;
  readonly memory_type: MemoryType;
  readonly tags: ReadonlyArray<string>;
  readonly confidence: number;
  readonly times_recalled: number;
  readonly last_recalled_at: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface MemoryMatch {
  readonly id: string;
  readonly agent_name: string;
  readonly content: string;
  readonly summary: string;
  readonly memory_type: MemoryType;
  readonly tags: ReadonlyArray<string>;
  readonly confidence: number;
  readonly similarity: number;
  readonly metadata?: Record<string, unknown>;
  readonly created_at?: string;
  readonly times_recalled?: number;
  /** Client this memory was learned from (metadata.client_name), null if client-agnostic */
  readonly client_name?: string | null;
}

// ── Memory Manager Config ─────────────────────────────────────────────

export interface MemoryConfig {
  /** Minimum cosine similarity threshold (0-1) for memory recall */
  readonly match_threshold: number;
  /** Maximum number of memories to recall per query */
  readonly max_recall: number;
  /** Decay factor for recency weighting (higher = faster decay) */
  readonly decay_rate: number;
  /** Weight for similarity score in final ranking */
  readonly similarity_weight: number;
  /** Weight for recency in final ranking */
  readonly recency_weight: number;
  /** Weight for usage frequency in final ranking */
  readonly frequency_weight: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  // Calibrated for text-embedding-3-small (2026-07-07): related content
  // scores 0.40-0.60 on cosine — the old 0.65 (Voyage-era) returned ZERO
  // recalls. Precision comes from composite re-ranking, not the gate.
  match_threshold: 0.4,
  max_recall: 5,
  decay_rate: 0.01,
  similarity_weight: 0.6,
  recency_weight: 0.25,
  frequency_weight: 0.15,
} as const;
