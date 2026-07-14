import { createSupabaseClient } from "../db/supabase.js";
import { etTodayBounds } from "../dispatch/et-time.js";

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
  readonly tickets: { readonly halo_is_open: boolean | null } | ReadonlyArray<{ readonly halo_is_open: boolean | null }> | null;
}

function ticketIsOpen(row: ComplianceDashboardRow): boolean {
  const ticket = Array.isArray(row.tickets) ? row.tickets[0] : row.tickets;
  return ticket?.halo_is_open !== false;
}

export async function buildResponseComplianceDashboard() {
  const supabase = createSupabaseClient();
  const now = new Date();
  const { start } = etTodayBounds(now);
  const { data, error } = await supabase
    .from("ticket_response_compliance")
    .select("halo_id, ticket_summary, client_name, ticket_created_at, acknowledgment_due_at, acknowledgment_at, acknowledgment_met, dispatcher_outcome, approval_id, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_response_met, technician_missed_at, tickets(halo_is_open)")
    .order("ticket_created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReadonlyArray<ComplianceDashboardRow>;
  const todayRows = rows.filter((row) => Date.parse(row.ticket_created_at) >= Date.parse(start));
  const active = [...rows]
    .filter(ticketIsOpen)
    .filter((row) => !row.acknowledgment_at || (row.assigned_at && !row.technician_response_at))
    .sort((left, right) => {
      const leftDue = Math.min(Date.parse(left.acknowledgment_due_at), Date.parse(left.technician_response_due_at ?? "9999-12-31"));
      const rightDue = Math.min(Date.parse(right.acknowledgment_due_at), Date.parse(right.technician_response_due_at ?? "9999-12-31"));
      return leftDue - rightDue;
    })
    .slice(0, 8)
    .map((row) => ({
      ...row,
      acknowledgment_overdue: !row.acknowledgment_at && Date.parse(row.acknowledgment_due_at) <= now.getTime(),
      technician_overdue: Boolean(row.assigned_at && !row.technician_response_at && row.technician_response_due_at && Date.parse(row.technician_response_due_at) <= now.getTime()),
    }));

  return {
    generatedAt: now.toISOString(),
    summary: {
      acknowledgment: {
        onTime: todayRows.filter((row) => row.acknowledgment_met === true).length,
        missed: todayRows.filter((row) => row.dispatcher_outcome === "missed").length,
        ptoExempt: todayRows.filter((row) => row.dispatcher_outcome === "pto_exempt").length,
        ptoUnknown: todayRows.filter((row) => row.dispatcher_outcome === "pto_unknown").length,
        pending: rows.filter((row) => !row.acknowledgment_at && row.dispatcher_outcome === "pending").length,
        approvalNeeded: rows.filter((row) => !row.acknowledgment_at && row.approval_id !== null).length,
      },
      technician: {
        onTime: todayRows.filter((row) => row.technician_response_met === true).length,
        missed: todayRows.filter((row) => row.technician_response_met === false).length,
        pending: rows.filter((row) => row.assigned_at && !row.technician_response_at && !row.technician_missed_at).length,
      },
    },
    active,
  };
}
