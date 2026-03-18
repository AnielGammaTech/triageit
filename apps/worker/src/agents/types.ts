import type { TicketClassification, AgentFinding } from "@triageit/shared";

export interface ClassificationResult {
  readonly classification: TicketClassification;
  readonly urgency_score: number;
  readonly urgency_reasoning: string;
  readonly recommended_priority: number;
  readonly entities: ReadonlyArray<string>;
  readonly security_flag: boolean;
  readonly security_notes: string | null;
}

export interface TriageContext {
  readonly ticketId: string;
  readonly haloId: number;
  readonly summary: string;
  readonly details: string | null;
  readonly clientName: string | null;
  readonly userName: string | null;
  readonly originalPriority: number | null;
  readonly actions?: ReadonlyArray<{
    readonly note: string;
    readonly who: string | null;
    readonly outcome: string | null;
    readonly date: string | null;
  }>;
}

export interface TriageOutput {
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
  readonly internal_notes: string;
  readonly processing_time_ms: number;
  readonly model_tokens_used: {
    readonly manager: number;
    readonly workers: Record<string, number>;
  };
}
