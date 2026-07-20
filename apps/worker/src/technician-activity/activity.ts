import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_TIME_ZONE,
  HELPDESK_TECHNICIANS,
  isHelpdeskTechnicianName,
  type HaloAction,
} from "@triageit/shared";
import { HaloClient } from "../integrations/halo/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { etTodayBounds } from "../dispatch/et-time.js";

export type TechnicianActivityCategory =
  | "customer_email"
  | "private_note"
  | "status_change"
  | "assignment_change"
  | "appointment"
  | "phone_call"
  | "work_log"
  | "other";

export interface TechnicianActivityRow {
  readonly halo_action_id: number;
  readonly halo_ticket_id: number;
  readonly technician_name: string;
  readonly technician_agent_id: number | null;
  readonly action_at: string;
  readonly category: TechnicianActivityCategory;
  readonly outcome: string | null;
  readonly is_customer_visible: boolean;
  readonly email_direction: string | null;
  readonly old_status: string | null;
  readonly new_status: string | null;
  readonly work_minutes: number;
  readonly charged_hours: number;
  readonly noncharge_hours: number;
  readonly is_billable: boolean | null;
  readonly synced_at: string;
}

export interface TechnicianActivityMetric {
  readonly technician: string;
  readonly ticketsTouched: number;
  readonly actions: number;
  readonly customerEmails: number;
  readonly privateNotes: number;
  readonly statusChanges: number;
  readonly assignmentChanges: number;
  readonly appointments: number;
  readonly phoneCalls: number;
  readonly workMinutes: number;
  readonly billableHours: number;
}

export interface TechnicianActivitySummary {
  readonly generatedAt: string;
  readonly period: "today";
  readonly timeZone: string;
  readonly definition: string;
  readonly team: TechnicianActivityMetric;
  readonly technicians: ReadonlyArray<TechnicianActivityMetric>;
}

const SYSTEM_OUTCOMES = new Set([
  "rule applied",
  "sla hold",
  "sla release",
  "opened",
  "closure reminder",
  "first user email",
]);

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function haloActionTimestamp(action: HaloAction): string | null {
  const raw = action.actiondatecreated ?? action.datetime ?? action.datecreated;
  if (!raw) return null;
  const value = raw.endsWith("Z") || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function canonicalTechnician(name: string | undefined): string | null {
  if (!isHelpdeskTechnicianName(name)) return null;
  const tokens = new Set((name ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return HELPDESK_TECHNICIANS.find((tech) =>
    tech.toLowerCase().split(/\s+/).every((token) => tokens.has(token)),
  ) ?? name ?? null;
}

export function classifyTechnicianAction(action: HaloAction, syncedAt = new Date().toISOString()): TechnicianActivityRow | null {
  const technician = canonicalTechnician(action.who);
  const actionAt = haloActionTimestamp(action);
  if (!technician || !actionAt || !action.id || !action.ticket_id) return null;

  const outcome = (action.outcome ?? "").trim();
  const normalizedOutcome = outcome.toLowerCase();
  if (SYSTEM_OUTCOMES.has(normalizedOutcome)) return null;

  const outgoingEmail = !action.hiddenfromuser && action.emaildirection?.toUpperCase() === "O";
  const workHours = Math.max(finiteNumber(action.timetakenadjusted), finiteNumber(action.timetaken));
  const chargedHours = finiteNumber(action.actionchargehours) + finiteNumber(action.actiontravelchargehours);
  const nonchargeHours = finiteNumber(action.actionnonchargehours);

  let category: TechnicianActivityCategory;
  if (outgoingEmail) category = "customer_email";
  // Halo includes old/new status metadata on ordinary note actions. The
  // explicit outcome is the reliable signal for what the technician did.
  else if (action.hiddenfromuser && /note/.test(normalizedOutcome)) category = "private_note";
  else if (/call|phone/.test(normalizedOutcome)) category = "phone_call";
  else if (/schedule|appointment/.test(normalizedOutcome)) category = "appointment";
  else if (/re-?assign|assignment/.test(normalizedOutcome)) category = "assignment_change";
  else if (/change status|fix status|responded/.test(normalizedOutcome)) category = "status_change";
  else if (workHours > 0 || chargedHours > 0 || nonchargeHours > 0) category = "work_log";
  else category = "other";

  return {
    halo_action_id: action.id,
    halo_ticket_id: action.ticket_id,
    technician_name: technician,
    technician_agent_id: action.who_agentid ?? action.actionby_agent_id ?? null,
    action_at: actionAt,
    category,
    outcome: outcome || null,
    is_customer_visible: !action.hiddenfromuser,
    email_direction: action.emaildirection ?? null,
    old_status: action.old_status ?? null,
    new_status: action.new_status_name ?? action.new_status ?? null,
    work_minutes: Math.round(workHours * 60 * 100) / 100,
    charged_hours: Math.round(chargedHours * 100) / 100,
    noncharge_hours: Math.round(nonchargeHours * 100) / 100,
    is_billable: action.actisbillable ?? null,
    synced_at: syncedAt,
  };
}

export async function storeTechnicianActions(
  supabase: SupabaseClient,
  haloTicketId: number,
  lastHaloActionAt: string | null,
  actions: ReadonlyArray<HaloAction>,
): Promise<number> {
  const syncedAt = new Date().toISOString();
  const rows = actions
    .map((action) => classifyTechnicianAction(action, syncedAt))
    .filter((row): row is TechnicianActivityRow => row !== null);

  if (rows.length > 0) {
    const { error } = await supabase
      .from("technician_ticket_activity")
      .upsert(rows, { onConflict: "halo_ticket_id,halo_action_id" });
    if (error) throw new Error(`Technician activity upsert failed: ${error.message}`);
  }

  const { error: stateError } = await supabase
    .from("technician_activity_ticket_sync")
    .upsert({
      halo_ticket_id: haloTicketId,
      last_halo_action_at: lastHaloActionAt,
      synced_at: syncedAt,
    }, { onConflict: "halo_ticket_id" });
  if (stateError) throw new Error(`Technician activity state failed: ${stateError.message}`);
  return rows.length;
}

export async function syncTechnicianActivityForTicket(
  supabase: SupabaseClient,
  halo: HaloClient,
  haloTicketId: number,
  lastHaloActionAt: string | null,
): Promise<number> {
  const actions = await halo.getTicketActions(haloTicketId, true);
  return storeTechnicianActions(supabase, haloTicketId, lastHaloActionAt, actions);
}

export async function syncTechnicianActivity(
  supabase: SupabaseClient,
  options: { readonly lookbackDays?: number; readonly maxTickets?: number } = {},
): Promise<{ readonly candidates: number; readonly syncedTickets: number; readonly storedActions: number }> {
  const lookbackDays = options.lookbackDays ?? 7;
  const maxTickets = options.maxTickets ?? 75;
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("halo_id, last_tech_action_at")
    .gte("last_tech_action_at", since)
    .order("last_tech_action_at", { ascending: false })
    .limit(2_000);
  if (error) throw new Error(`Technician activity candidates failed: ${error.message}`);

  const candidateRows = tickets ?? [];
  const candidateIds = candidateRows.map((ticket) => ticket.halo_id);
  const { data: states, error: stateError } = candidateIds.length > 0
    ? await supabase
      .from("technician_activity_ticket_sync")
      .select("halo_ticket_id, last_halo_action_at")
      .in("halo_ticket_id", candidateIds)
    : { data: [], error: null };
  if (stateError) throw new Error(`Technician activity states failed: ${stateError.message}`);

  const stateByTicket = new Map((states ?? []).map((state) => [state.halo_ticket_id, state.last_halo_action_at]));
  const pending = candidateRows.filter((ticket) =>
    (stateByTicket.get(ticket.halo_id) ?? null) !== (ticket.last_tech_action_at ?? null),
  ).slice(0, maxTickets);

  const config = await getCachedHaloConfig(supabase);
  if (!config) return { candidates: candidateRows.length, syncedTickets: 0, storedActions: 0 };
  const halo = new HaloClient(config);
  let cursor = 0;
  let storedActions = 0;
  const workers = Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (cursor < pending.length) {
      const ticket = pending[cursor++];
      try {
        storedActions += await syncTechnicianActivityForTicket(
          supabase,
          halo,
          ticket.halo_id,
          ticket.last_tech_action_at ?? null,
        );
      } catch (activityError) {
        console.warn(`[TECH-ACTIVITY] Failed #${ticket.halo_id}:`, activityError instanceof Error ? activityError.message : activityError);
      }
    }
  });
  await Promise.all(workers);
  return { candidates: candidateRows.length, syncedTickets: pending.length, storedActions };
}

function emptyMetric(technician: string): TechnicianActivityMetric {
  return {
    technician,
    ticketsTouched: 0,
    actions: 0,
    customerEmails: 0,
    privateNotes: 0,
    statusChanges: 0,
    assignmentChanges: 0,
    appointments: 0,
    phoneCalls: 0,
    workMinutes: 0,
    billableHours: 0,
  };
}

export function summarizeTechnicianActivity(
  rows: ReadonlyArray<TechnicianActivityRow>,
  generatedAt = new Date().toISOString(),
): TechnicianActivitySummary {
  const metrics = new Map<string, TechnicianActivityMetric>(
    HELPDESK_TECHNICIANS.map((tech) => [tech, emptyMetric(tech)]),
  );
  const ticketSets = new Map<string, Set<number>>(
    HELPDESK_TECHNICIANS.map((tech) => [tech, new Set<number>()]),
  );
  for (const row of rows) {
    const metric = metrics.get(row.technician_name);
    const ticketSet = ticketSets.get(row.technician_name);
    if (!metric || !ticketSet) continue;
    ticketSet.add(row.halo_ticket_id);
    const next = {
      ...metric,
      actions: metric.actions + 1,
      customerEmails: metric.customerEmails + (row.category === "customer_email" ? 1 : 0),
      privateNotes: metric.privateNotes + (row.category === "private_note" ? 1 : 0),
      statusChanges: metric.statusChanges + (row.category === "status_change" ? 1 : 0),
      assignmentChanges: metric.assignmentChanges + (row.category === "assignment_change" ? 1 : 0),
      appointments: metric.appointments + (row.category === "appointment" ? 1 : 0),
      phoneCalls: metric.phoneCalls + (row.category === "phone_call" ? 1 : 0),
      workMinutes: Math.round((metric.workMinutes + Number(row.work_minutes || 0)) * 100) / 100,
      billableHours: Math.round((metric.billableHours + Number(row.charged_hours || 0)) * 100) / 100,
    };
    metrics.set(row.technician_name, next);
  }

  const technicians = [...metrics.values()].map((metric) => ({
    ...metric,
    ticketsTouched: ticketSets.get(metric.technician)?.size ?? 0,
  })).sort((a, b) => b.actions - a.actions || a.technician.localeCompare(b.technician));
  const allTickets = new Set(rows.map((row) => row.halo_ticket_id));
  const team = technicians.reduce<TechnicianActivityMetric>((sum, metric) => ({
    technician: "Team",
    ticketsTouched: allTickets.size,
    actions: sum.actions + metric.actions,
    customerEmails: sum.customerEmails + metric.customerEmails,
    privateNotes: sum.privateNotes + metric.privateNotes,
    statusChanges: sum.statusChanges + metric.statusChanges,
    assignmentChanges: sum.assignmentChanges + metric.assignmentChanges,
    appointments: sum.appointments + metric.appointments,
    phoneCalls: sum.phoneCalls + metric.phoneCalls,
    workMinutes: Math.round((sum.workMinutes + metric.workMinutes) * 100) / 100,
    billableHours: Math.round((sum.billableHours + metric.billableHours) * 100) / 100,
  }), emptyMetric("Team"));

  return {
    generatedAt,
    period: "today",
    timeZone: BUSINESS_TIME_ZONE,
    definition: "Verified human technician actions from Halo. TriageIT automation and system events are excluded.",
    team,
    technicians,
  };
}

export async function buildTechnicianActivitySummary(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TechnicianActivitySummary> {
  const { start } = etTodayBounds(now);
  const { data, error } = await supabase
    .from("technician_ticket_activity")
    .select("*")
    .gte("action_at", start)
    .lte("action_at", now.toISOString())
    .order("action_at", { ascending: false })
    .limit(10_000);
  if (error) {
    console.warn("[TECH-ACTIVITY] Summary unavailable:", error.message);
    return summarizeTechnicianActivity([], now.toISOString());
  }
  return summarizeTechnicianActivity((data ?? []) as TechnicianActivityRow[], now.toISOString());
}
