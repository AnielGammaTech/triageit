export type AgentStatus = "started" | "completed" | "error" | "skipped";

export interface AgentLog {
  readonly id: string;
  readonly ticket_id: string;
  readonly agent_name: string;
  readonly agent_role: string;
  readonly status: AgentStatus;
  readonly input_summary: string | null;
  readonly output_summary: string | null;
  readonly tokens_used: number | null;
  readonly duration_ms: number | null;
  readonly error_message: string | null;
  readonly created_at: string;
}

export interface AgentDefinition {
  readonly name: string;
  readonly character: string;
  readonly role: string;
  readonly specialty: string;
  readonly integration: string | null;
  readonly model: "opus" | "sonnet" | "haiku";
  readonly description: string;
}
