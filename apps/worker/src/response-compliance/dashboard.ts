import { createSupabaseClient } from "../db/supabase.js";
import { etTodayBounds } from "../dispatch/et-time.js";
import { isCustomerResponseClient } from "./eligibility.js";
import {
  buildTechnicianEmailPerformance,
  type TechnicianResponsePerformanceRow,
} from "./performance.js";
import { buildTechnicianActivitySummary } from "../technician-activity/activity.js";

interface CurrentTicketState {
  readonly halo_is_open: boolean | null;
  readonly client_name: string | null;
}

interface ComplianceDashboardRow {
  readonly halo_id: number;
  readonly ticket_summary: string;
  readonly client_name: string | null;
  readonly ticket_created_at: string;
  readonly acknowledgment_due_at: string;
  readonly acknowledgment_at: string | null;
  readonly acknowledgment_met: boolean | null;
  readonly dispatcher_outcome: "pending" | "met" | "missed" | "pto_exempt" | "pto_unknown";
  readonly approval_id: string | null;
  readonly assigned_tech: string | null;
  readonly assigned_at: string | null;
  readonly technician_response_due_at: string | null;
  readonly technician_response_at: string | null;
  readonly technician_response_met: boolean | null;
  readonly technician_missed_at: string | null;
  readonly tickets: CurrentTicketState | ReadonlyArray<CurrentTicketState> | null;
}

function currentTicket(row: ComplianceDashboardRow): CurrentTicketState | null {
  return (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) ?? null;
}

function ticketIsOpen(row: ComplianceDashboardRow): boolean {
  return currentTicket(row)?.halo_is_open !== false;
}

function currentClientName(row: ComplianceDashboardRow): string | null {
  return currentTicket(row)?.client_name ?? row.client_name;
}

function dashboardItem(row: ComplianceDashboardRow, now: Date) {
  return {
    halo_id: row.halo_id,
    ticket_summary: row.ticket_summary,
    client_name: currentClientName(row),
    ticket_created_at: row.ticket_created_at,
    ticket_is_open: ticketIsOpen(row),
    acknowledgment_due_at: row.acknowledgment_due_at,
    acknowledgment_at: row.acknowledgment_at,
    acknowledgment_met: row.acknowledgment_met,
    acknowledgment_overdue: !row.acknowledgment_at && Date.parse(row.acknowledgment_due_at) <= now.getTime(),
    dispatcher_outcome: row.dispatcher_outcome,
    approval_id: row.approval_id,
    assigned_tech: row.assigned_tech,
    assigned_at: row.assigned_at,
    technician_response_due_at: row.technician_response_due_at,
    technician_response_at: row.technician_response_at,
    technician_response_met: row.technician_response_met,
    technician_overdue: Boolean(
      row.assigned_at
      && !row.technician_response_at
      && row.technician_response_due_at
      && Date.parse(row.technician_response_due_at) <= now.getTime()
    ),
  };
}

export async function buildResponseComplianceDashboard() {
  const supabase = createSupabaseClient();
  const now = new Date();
  const { start } = etTodayBounds(now);
  const { data, error } = await supabase
    .from("ticket_response_compliance")
    .select("halo_id, ticket_summary, client_name, ticket_created_at, acknowledgment_due_at, acknowledgment_at, acknowledgment_met, dispatcher_outcome, approval_id, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_response_met, technician_missed_at, tickets(halo_is_open, client_name)")
    .order("ticket_created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as ReadonlyArray<ComplianceDashboardRow>)
    .filter((row) => isCustomerResponseClient(currentClientName(row)));
  const technicianEmailPerformance = buildTechnicianEmailPerformance(
    rows as ReadonlyArray<ComplianceDashboardRow & TechnicianResponsePerformanceRow>,
    now,
  );
  const technicianActivity = await buildTechnicianActivitySummary(supabase, now);
  const todayRows = rows.filter((row) => Date.parse(row.ticket_created_at) >= Date.parse(start));
  const openRows = rows.filter(ticketIsOpen);
  const detailRows = {
    ackOnTime: todayRows.filter((row) => row.acknowledgment_met === true),
    ackMissed: todayRows.filter((row) => row.dispatcher_outcome === "missed"),
    ptoExempt: todayRows.filter((row) => row.dispatcher_outcome === "pto_exempt"),
    needsApproval: openRows.filter((row) => !row.acknowledgment_at && row.approval_id !== null),
    techOnTime: todayRows.filter((row) => row.technician_response_met === true),
    techMissed: todayRows.filter((row) => row.technician_response_met === false),
    ackPending: openRows
      .filter((row) => !row.acknowledgment_at && row.dispatcher_outcome === "pending")
      .sort((left, right) => Date.parse(left.acknowledgment_due_at) - Date.parse(right.acknowledgment_due_at)),
    techPending: openRows
      .filter((row) => row.assigned_at && !row.technician_response_at && !row.technician_missed_at)
      .sort((left, right) => Date.parse(left.technician_response_due_at ?? "9999-12-31") - Date.parse(right.technician_response_due_at ?? "9999-12-31")),
  } as const;
  const active = [...openRows]
    .filter((row) => !row.acknowledgment_at || (row.assigned_at && !row.technician_response_at))
    .sort((left, right) => {
      const leftDue = Math.min(Date.parse(left.acknowledgment_due_at), Date.parse(left.technician_response_due_at ?? "9999-12-31"));
      const rightDue = Math.min(Date.parse(right.acknowledgment_due_at), Date.parse(right.technician_response_due_at ?? "9999-12-31"));
      return leftDue - rightDue;
    })
    .slice(0, 8)
    .map((row) => dashboardItem(row, now));

  return {
    generatedAt: now.toISOString(),
    technicianEmailPerformance,
    technicianActivity,
    summary: {
      acknowledgment: {
        onTime: detailRows.ackOnTime.length,
        missed: detailRows.ackMissed.length,
        ptoExempt: detailRows.ptoExempt.length,
        ptoUnknown: todayRows.filter((row) => row.dispatcher_outcome === "pto_unknown").length,
        pending: detailRows.ackPending.length,
        approvalNeeded: detailRows.needsApproval.length,
      },
      technician: {
        onTime: detailRows.techOnTime.length,
        missed: detailRows.techMissed.length,
        pending: detailRows.techPending.length,
      },
    },
    details: {
      ackOnTime: detailRows.ackOnTime.map((row) => dashboardItem(row, now)),
      ackMissed: detailRows.ackMissed.map((row) => dashboardItem(row, now)),
      ptoExempt: detailRows.ptoExempt.map((row) => dashboardItem(row, now)),
      needsApproval: detailRows.needsApproval.map((row) => dashboardItem(row, now)),
      techOnTime: detailRows.techOnTime.map((row) => dashboardItem(row, now)),
      techMissed: detailRows.techMissed.map((row) => dashboardItem(row, now)),
      ackPending: detailRows.ackPending.map((row) => dashboardItem(row, now)),
      techPending: detailRows.techPending.map((row) => dashboardItem(row, now)),
    },
    active,
  };
}
