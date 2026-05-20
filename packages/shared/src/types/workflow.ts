export type HaloWorkflowStatus =
  | "NEW"
  | "WOT"
  | "IN_PROGRESS"
  | "WAITING_ON_CUSTOMER"
  | "WAITING_ON_PARTS"
  | "NEEDS_QUOTE"
  | "PAST_DUE"
  | "RESOLVED";

export type HaloWorkflowOwnerRole =
  | "Triage"
  | "Assigned Tech"
  | "Parts Owner"
  | "Triage Lead"
  | "Help Desk Manager"
  | "Director";

export interface HaloWorkflowState {
  readonly workflow_status: HaloWorkflowStatus | null;
  readonly workflow_owner_role: HaloWorkflowOwnerRole | null;
  readonly auto_release_at: string | null;
  readonly resolution_time_at: string | null;
  readonly workflow_past_due: boolean | null;
  readonly rfi_cycle_count: number | null;
  readonly past_due_count: number | null;
  readonly escalation_level: 0 | 1 | 2 | 3 | null;
}
