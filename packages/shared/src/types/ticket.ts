export interface HaloTicket {
  readonly id: number;
  readonly summary: string;
  readonly details: string;
  readonly tickettype_id: number;
  readonly client_id: number;
  readonly client_name: string;
  readonly site_id?: number;
  readonly user_id?: number;
  readonly user_name?: string;
  readonly agent_id?: number;
  readonly team?: string;
  readonly status_id: number;
  readonly status?: string;
  readonly priority_id: number;
  readonly priority?: string;
  readonly sla_id?: number;
  readonly category_1?: string;
  readonly category_2?: string;
  readonly category_3?: string;
  readonly category_4?: string;
  readonly asset_id?: number;
  readonly dateoccurred?: string;
  readonly datecreated: string;
  readonly deadlinedate?: string;
  readonly customfields?: ReadonlyArray<HaloCustomField>;
}

export interface HaloCustomField {
  readonly id: number;
  readonly value: string;
}

export interface HaloAction {
  readonly id: number;
  readonly ticket_id: number;
  readonly note: string;
  readonly outcome: string;
  readonly hiddenfromuser: boolean;
  readonly who?: string;
  readonly datecreated?: string;
  readonly attachments?: ReadonlyArray<HaloAttachment>;
}

export interface HaloAttachment {
  readonly id: number;
  readonly filename: string;
  readonly type?: string;
  readonly isimage?: boolean;
  readonly ticket_id?: number;
  readonly action_id?: number;
  readonly url?: string;
  readonly [key: string]: unknown;
}

export type TicketStatus =
  | "pending"
  | "triaging"
  | "triaged"
  | "approved"
  | "needs_review"
  | "error";

export interface Ticket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly details: string | null;
  readonly client_name: string | null;
  readonly client_id: number | null;
  readonly user_name: string | null;
  readonly user_email: string | null;
  readonly original_priority: number | null;
  readonly status: TicketStatus;
  readonly raw_data: HaloTicket | null;
  readonly created_at: string;
  readonly updated_at: string;
}
