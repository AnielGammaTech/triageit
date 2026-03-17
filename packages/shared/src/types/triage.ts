export interface TicketClassification {
  readonly type: string;
  readonly subtype: string;
  readonly confidence: number;
}

export interface AgentFinding {
  readonly agent_name: string;
  readonly summary: string;
  readonly data: Record<string, unknown>;
  readonly confidence: number;
}

export interface ModelTokenUsage {
  readonly manager: number;
  readonly workers: Record<string, number>;
}

export interface TriageResult {
  readonly id: string;
  readonly ticket_id: string;
  readonly classification: TicketClassification;
  readonly urgency_score: number;
  readonly urgency_reasoning: string;
  readonly recommended_priority: number;
  readonly recommended_team: string | null;
  readonly recommended_agent: string | null;
  readonly security_flag: boolean;
  readonly security_notes: string | null;
  readonly findings: Record<string, AgentFinding>;
  readonly suggested_response: string | null;
  readonly internal_notes: string | null;
  readonly processing_time_ms: number;
  readonly model_tokens_used: ModelTokenUsage;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly created_at: string;
}
