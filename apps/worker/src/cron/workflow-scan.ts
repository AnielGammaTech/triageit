import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloWorkflowOwnerRole, HaloWorkflowStatus, TeamsConfig } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import { TeamsClient } from "../integrations/teams/client.js";

interface WorkflowTicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
  readonly halo_is_open: boolean | null;
  readonly workflow_status: HaloWorkflowStatus | null;
  readonly workflow_owner_role: HaloWorkflowOwnerRole | null;
  readonly auto_release_at: string | null;
  readonly resolution_time_at: string | null;
  readonly workflow_past_due: boolean | null;
  readonly rfi_cycle_count: number | null;
  readonly past_due_count: number | null;
  readonly escalation_level: 0 | 1 | 2 | 3 | null;
  readonly created_at: string;
}

interface WorkflowIssue {
  readonly ticket: WorkflowTicketRow;
  readonly type: string;
  readonly severity: "critical" | "warning" | "info";
  readonly note: string;
  readonly nextPastDueCount?: number;
}

interface WorkflowScanResult {
  readonly checked: number;
  readonly issues: number;
  readonly eventsLogged: number;
  readonly ticketsMarkedPastDue: number;
  readonly haloPrivateNotesPosted: number;
  readonly teamsAlertsSent: number;
}

const ACTIVE_STATUSES = new Set<HaloWorkflowStatus>([
  "NEW",
  "WOT",
  "IN_PROGRESS",
  "NEEDS_QUOTE",
  "PAST_DUE",
]);

const PAUSED_STATUSES = new Set<HaloWorkflowStatus>([
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
]);

function isPast(timestamp: string | null, nowMs: number): boolean {
  if (!timestamp) return false;
  const ms = Date.parse(timestamp);
  return !Number.isNaN(ms) && ms <= nowMs;
}

function daysOpen(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function workflowOwnerLabel(ticket: WorkflowTicketRow): string {
  if (ticket.workflow_owner_role === "Assigned Tech" && ticket.halo_agent) {
    return ticket.halo_agent;
  }
  if (ticket.workflow_owner_role === "Triage") return "Triage / Bryanna";
  if (ticket.workflow_owner_role) return ticket.workflow_owner_role;
  return ticket.halo_agent ?? "Unassigned";
}

function buildPrivateWorkflowNote(
  ticket: WorkflowTicketRow,
  issues: ReadonlyArray<WorkflowIssue>,
): string {
  const severity = issues.some((issue) => issue.severity === "critical")
    ? "CRITICAL"
    : "WARNING";
  const issueRows = issues
    .map((issue) => `<li><strong>${escapeHtml(issue.type)}</strong>: ${escapeHtml(issue.note)}</li>`)
    .join("");

  return [
    `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:12px;">`,
    `<div style="font-size:13px;color:#a5b4fc;font-weight:700;">Private TriageIT Workflow Reminder - ${severity}</div>`,
    `<div style="margin-top:8px;font-size:13px;"><strong>Ticket:</strong> #${ticket.halo_id} - ${escapeHtml(ticket.summary)}</div>`,
    `<div style="font-size:13px;"><strong>Internal owner to act:</strong> ${escapeHtml(workflowOwnerLabel(ticket))}</div>`,
    `<div style="font-size:13px;"><strong>Workflow state:</strong> ${escapeHtml(ticket.workflow_status ?? "Unknown")} / ${escapeHtml(ticket.workflow_owner_role ?? "No owner role")}</div>`,
    `<ul style="margin:10px 0 0 18px;padding:0;font-size:13px;">${issueRows}</ul>`,
    `<div style="margin-top:10px;font-size:12px;color:#fbbf24;"><strong>Internal only:</strong> do not email the customer automatically. A human manager or tech decides any customer follow-up.</div>`,
    `</div>`,
  ].join("");
}

async function postPrivateWorkflowNotes(
  supabase: SupabaseClient,
  issues: ReadonlyArray<WorkflowIssue>,
): Promise<number> {
  const haloConfig = await getCachedHaloConfig(supabase);
  if (!haloConfig) {
    console.log("[WORKFLOW] Halo not configured - skipping private workflow notes");
    return 0;
  }

  const halo = new HaloClient(haloConfig);
  const grouped = new Map<string, WorkflowIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.ticket.id) ?? [];
    existing.push(issue);
    grouped.set(issue.ticket.id, existing);
  }

  let posted = 0;
  for (const ticketIssues of grouped.values()) {
    const ticket = ticketIssues[0]?.ticket;
    if (!ticket) continue;

    try {
      await halo.addInternalNote(
        ticket.halo_id,
        buildPrivateWorkflowNote(ticket, ticketIssues),
      );
      posted++;
    } catch (err) {
      console.error(`[WORKFLOW] Failed to post private note for #${ticket.halo_id}:`, err);
    }
  }

  return posted;
}

async function getTeamsConfig(supabase: SupabaseClient): Promise<TeamsConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .maybeSingle();

  return data ? (data.config as TeamsConfig) : null;
}

function evaluateTicket(ticket: WorkflowTicketRow, nowMs: number): ReadonlyArray<WorkflowIssue> {
  const issues: WorkflowIssue[] = [];
  const status = ticket.workflow_status;

  if (!status || status === "RESOLVED" || ticket.halo_is_open === false) {
    return issues;
  }

  if (!ticket.workflow_owner_role) {
    issues.push({
      ticket,
      type: "missing_owner_role",
      severity: "warning",
      note: "Workflow owner role is missing. Ownership must be explicit before the ticket can be managed reliably.",
    });
  }

  if (ACTIVE_STATUSES.has(status) && !ticket.resolution_time_at) {
    issues.push({
      ticket,
      type: "missing_resolution_time",
      severity: "warning",
      note: "Active workflow state is missing resolution_time. Set the promised next action deadline.",
    });
  }

  if (PAUSED_STATUSES.has(status)) {
    if (!ticket.auto_release_at) {
      issues.push({
        ticket,
        type: "missing_auto_release",
        severity: "warning",
        note: "Paused workflow state is missing auto_release. Set when the ticket should re-enter the active queue.",
      });
    }

    if (!ticket.resolution_time_at) {
      issues.push({
        ticket,
        type: "missing_paused_resolution_time",
        severity: "warning",
        note: "Paused workflow state is missing resolution_time. Set the deadline that follows the hold or RFI window.",
      });
    }
  }

  if (PAUSED_STATUSES.has(status) && isPast(ticket.auto_release_at, nowMs)) {
    const rfiCycleCount = ticket.rfi_cycle_count ?? 0;
    if (status === "WAITING_ON_CUSTOMER" && rfiCycleCount >= 2) {
      issues.push({
        ticket,
        type: "stuck_rfi_escalation_paused",
        severity: "critical",
        note: "RFI loop has reached 2 cycles. Escalate internally to Triage Lead and create a manager reminder. Do not email the customer automatically.",
      });
    } else {
      issues.push({
        ticket,
        type: "auto_release_due",
        severity: "warning",
        note: "auto_release has fired. Review the ticket and either reissue RFI, resume work, or set the next valid workflow state.",
      });
    }
  }

  if (
    ACTIVE_STATUSES.has(status) &&
    !ticket.workflow_past_due &&
    isPast(ticket.resolution_time_at, nowMs)
  ) {
    const nextPastDueCount = (ticket.past_due_count ?? 0) + 1;
    issues.push({
      ticket,
      type: nextPastDueCount >= 2 ? "second_resolution_time_missed" : "resolution_time_missed",
      severity: "critical",
      nextPastDueCount,
      note: nextPastDueCount >= 2
        ? "Ticket missed its promised deadline a second time. Transfer ownership to Triage Lead internally and create a manager reminder. Do not email the customer automatically."
        : "Ticket missed its promised next-action deadline. Notify Triage Lead internally and reset the deadline. Do not email the customer automatically.",
    });
  }

  if ((ticket.escalation_level ?? 0) > 0 && ticket.workflow_owner_role === "Assigned Tech") {
    issues.push({
      ticket,
      type: "escalation_owner_mismatch",
      severity: "warning",
      note: "Ticket has an escalation level but is still owned by Assigned Tech. Transfer ownership by role and keep the reminder internal.",
    });
  }

  return issues;
}

export async function scanWorkflowState(
  supabase: SupabaseClient = createSupabaseClient(),
): Promise<WorkflowScanResult> {
  const now = new Date();
  const nowMs = now.getTime();
  const twoHoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_status, halo_agent, halo_is_open, workflow_status, workflow_owner_role, auto_release_at, resolution_time_at, workflow_past_due, rfi_cycle_count, past_due_count, escalation_level, created_at")
    .limit(2000);

  if (error) {
    throw new Error(`Workflow scan failed to load tickets: ${error.message}`);
  }

  const tickets = ((rows ?? []) as WorkflowTicketRow[])
    .filter((ticket) => ticket.halo_is_open !== false && ticket.workflow_status !== "RESOLVED");

  const issues = tickets.flatMap((ticket) => evaluateTicket(ticket, nowMs));

  if (issues.length === 0) {
    return {
      checked: tickets.length,
      issues: 0,
      eventsLogged: 0,
      ticketsMarkedPastDue: 0,
      haloPrivateNotesPosted: 0,
      teamsAlertsSent: 0,
    };
  }

  const ticketIds = [...new Set(issues.map((issue) => issue.ticket.id))];
  const eventTypes = [...new Set(issues.map((issue) => issue.type))];
  const { data: recentEvents } = await supabase
    .from("workflow_events")
    .select("ticket_id, event_type")
    .in("ticket_id", ticketIds)
    .in("event_type", eventTypes)
    .gte("created_at", twoHoursAgo);

  const recentEventKeys = new Set(
    (recentEvents ?? []).map((event) => `${event.ticket_id}:${event.event_type}`),
  );
  const newIssues = issues.filter(
    (issue) => !recentEventKeys.has(`${issue.ticket.id}:${issue.type}`),
  );

  if (newIssues.length === 0) {
    return {
      checked: tickets.length,
      issues: issues.length,
      eventsLogged: 0,
      ticketsMarkedPastDue: 0,
      haloPrivateNotesPosted: 0,
      teamsAlertsSent: 0,
    };
  }

  const eventRows = newIssues.map((issue) => ({
    ticket_id: issue.ticket.id,
    halo_id: issue.ticket.halo_id,
    event_type: issue.type,
    from_owner_role: issue.ticket.workflow_owner_role,
    to_owner_role: null,
    workflow_status: issue.ticket.workflow_status,
    auto_release_at: issue.ticket.auto_release_at,
    resolution_time_at: issue.ticket.resolution_time_at,
    escalation_level: issue.ticket.escalation_level ?? 0,
    note: issue.note,
    payload: {
      severity: issue.severity,
      halo_status: issue.ticket.halo_status,
      halo_agent: issue.ticket.halo_agent,
      past_due_count: issue.ticket.past_due_count ?? 0,
      rfi_cycle_count: issue.ticket.rfi_cycle_count ?? 0,
    },
  }));

  const { error: insertError } = await supabase
    .from("workflow_events")
    .insert(eventRows);

  if (insertError) {
    throw new Error(`Workflow scan failed to log events: ${insertError.message}`);
  }

  let ticketsMarkedPastDue = 0;
  for (const issue of newIssues) {
    if (!issue.nextPastDueCount) continue;
    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        workflow_status: "PAST_DUE",
        workflow_past_due: true,
        past_due_count: issue.nextPastDueCount,
        updated_at: now.toISOString(),
      })
      .eq("id", issue.ticket.id);

    if (!updateError) ticketsMarkedPastDue++;
  }

  const haloPrivateNotesPosted = await postPrivateWorkflowNotes(supabase, newIssues);

  let teamsAlertsSent = 0;
  const teamsConfig = await getTeamsConfig(supabase);
  if (teamsConfig) {
    const teams = new TeamsClient(teamsConfig);
    const alertIssues = newIssues
      .filter((issue) => issue.severity !== "info")
      .slice(0, 10);

    for (const issue of alertIssues) {
      try {
        await teams.sendImmediateAlert(
          {
            haloId: issue.ticket.halo_id,
            summary: issue.ticket.summary,
            clientName: issue.ticket.client_name,
            status: issue.ticket.workflow_status ?? issue.ticket.halo_status ?? "Unknown",
            flags: [issue.type],
            recommendation: issue.note,
            daysOpen: daysOpen(issue.ticket.created_at),
            severity: issue.severity,
          },
          `Workflow ${issue.severity.toUpperCase()}`,
        );
        teamsAlertsSent++;
      } catch (err) {
        console.error(`[WORKFLOW] Failed to send Teams alert for #${issue.ticket.halo_id}:`, err);
      }
    }
  }

  console.log(
    `[WORKFLOW] Checked ${tickets.length} tickets, found ${issues.length} issue(s), logged ${eventRows.length}, marked ${ticketsMarkedPastDue} past due, posted ${haloPrivateNotesPosted} private Halo note(s), sent ${teamsAlertsSent} Teams alert(s)`,
  );

  return {
    checked: tickets.length,
    issues: issues.length,
    eventsLogged: eventRows.length,
    ticketsMarkedPastDue,
    haloPrivateNotesPosted,
    teamsAlertsSent,
  };
}
