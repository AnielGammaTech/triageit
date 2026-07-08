import type { TicketClassification, AgentFinding } from "@triageit/shared";

export interface ClassificationResult {
  readonly classification: TicketClassification;
  readonly urgency_score: number;
  readonly urgency_reasoning: string;
  readonly recommended_priority: number;
  readonly entities: ReadonlyArray<string>;
  readonly security_flag: boolean;
  readonly security_notes: string | null;
  readonly is_automated_alert?: boolean;
}

export interface TicketImageContext {
  readonly filename: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  readonly base64Data: string;
  readonly who: string | null;
}

export interface TicketDocumentContext {
  readonly filename: string;
  readonly kind: "pdf" | "text";
  readonly base64Data?: string;
  readonly textContent?: string;
  readonly who: string | null;
}

export interface TriageContext {
  readonly ticketId: string;
  readonly haloId: number;
  readonly summary: string;
  readonly details: string | null;
  readonly clientName: string | null;
  readonly clientId: number | null;
  readonly userName: string | null;
  readonly userEmail: string | null;
  readonly originalPriority: number | null;
  readonly assignedTechName?: string | null;
  readonly classificationType?: string | null;
  readonly actions?: ReadonlyArray<{
    readonly note: string;
    readonly who: string | null;
    readonly outcome: string | null;
    readonly date: string | null;
    readonly isInternal: boolean;
  }>;
  readonly images?: ReadonlyArray<TicketImageContext>;
  readonly imageDescriptions?: string;
  readonly documents?: ReadonlyArray<TicketDocumentContext>;
  readonly slaBreached?: boolean;
  readonly slaFixTargetMet?: boolean;
  readonly slaResponseTargetMet?: boolean;
  readonly slaFixByDate?: string | null;
  readonly slaRespondByDate?: string | null;
  readonly slaTimerText?: string | null;
  /** SLA plan + priority tier, e.g. "Gamma Tech SLA — Affects Single User" */
  readonly slaName?: string | null;
  /** Halo onhold flag — the SLA timer is PAUSED; targets are not burning */
  readonly slaOnHold?: boolean;
  /** Hours the SLA has spent on hold (Halo slaholdtime) */
  readonly slaHoldHours?: number | null;
  /** Hours left on the resolution timer (Halo fixtimeleft/slatimeleft) */
  readonly slaTimeLeftHours?: number | null;
  /** Percent of the SLA window consumed (Halo slapercused) */
  readonly slaPercentUsed?: number | null;
  /** When the first response actually happened (Halo responsedate) */
  readonly slaResponseDate?: string | null;
  /** Ticket follow-up date (Halo followupdate) */
  readonly followUpDate?: string | null;
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
  readonly analyzed_files: ReadonlyArray<string> | null;
  readonly duplicates: ReadonlyArray<{ halo_id: number; summary: string; similarity: number }> | null;
}
