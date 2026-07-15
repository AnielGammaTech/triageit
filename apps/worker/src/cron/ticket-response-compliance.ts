import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DISPATCHER,
  isHelpdeskTechnicianName,
  type HaloAction,
  type HaloConfig,
  type TeamsConfig,
} from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { stageInitialAcknowledgment } from "../dispatch/customer-update-approvals.js";
import { fetchCalendarSignals, fetchRoster, namesMatch } from "../dispatch/board-sources.js";
import { etTodayBounds } from "../dispatch/et-time.js";
import { HaloClient } from "../integrations/halo/client.js";
import { TeamsClient } from "../integrations/teams/client.js";
import { haloActionTimestamp, isOutboundCustomerEmail } from "../voice/customer-wait-state.js";
import {
  addResponseBusinessMinutes,
  formatResponseDeadline,
} from "../response-compliance/business-time.js";

interface TrackedTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly user_name: string | null;
  readonly user_email: string | null;
  readonly halo_agent: string | null;
  readonly created_at: string;
}

interface ComplianceRow {
  readonly id: string;
  readonly halo_id: number;
  readonly acknowledgment_due_at: string;
  readonly acknowledgment_at: string | null;
  readonly dispatcher_outcome: "pending" | "met" | "missed" | "pto_exempt" | "pto_unknown";
  readonly approval_id: string | null;
  readonly teams_alerted_at: string | null;
  readonly assigned_tech: string | null;
  readonly assigned_at: string | null;
  readonly technician_response_due_at: string | null;
  readonly technician_response_at: string | null;
  readonly technician_missed_at: string | null;
}

interface ComplianceSettings {
  readonly tracking_started_at: string;
  readonly acknowledgment_minutes: number;
  readonly technician_response_minutes: number;
}

type PtoStatus = "yes" | "no" | "unknown";

export interface ResponseComplianceScanResult {
  readonly tracked: number;
  readonly acknowledgmentsMet: number;
  readonly dispatcherMisses: number;
  readonly ptoExemptions: number;
  readonly technicianResponsesMet: number;
  readonly technicianMisses: number;
  readonly approvalsStaged: number;
  readonly teamsAlertsSent: number;
}

let ptoCache: { readonly at: number; readonly status: PtoStatus } | null = null;
const PTO_CACHE_MS = 5 * 60_000;
// Halo can write its first confirmation action a few seconds before the
// webhook-backed ticket row reaches Supabase. Keep a small ingestion tolerance
// so that legitimate immediate confirmations are not discarded.
const HALO_ACTION_INGESTION_TOLERANCE_MS = 5 * 60_000;

function firstName(value: string | null): string | null {
  const token = value?.trim().split(/\s+/)[0]?.replace(/[^a-z'-]/gi, "") ?? "";
  return token.length >= 2 ? token : null;
}

function exactEasternDeadline(iso: string): string {
  return formatResponseDeadline(new Date(iso)).replace(/\bE[DS]T\b/, "Eastern");
}

export function buildInitialAcknowledgmentDraft(input: {
  readonly customerName: string | null;
  readonly summary: string;
  readonly assignedTech: string | null;
  readonly technicianDueAt: string | null;
}): string {
  const greeting = firstName(input.customerName) ? `Hi ${firstName(input.customerName)},` : "Hello,";
  const subject = input.summary.replace(/\s+/g, " ").trim().slice(0, 160);
  const assignment = input.assignedTech && input.technicianDueAt
    ? `${firstName(input.assignedTech) ?? input.assignedTech} is assigned and will email you with an update by ${exactEasternDeadline(input.technicianDueAt)}. Please let us know if that time works for you.`
    : "Our dispatch team is assigning the right technician now and will email you with the next update as soon as the assignment is confirmed.";
  return [
    greeting,
    "",
    `Thank you for contacting Gamma Tech. We received your request about \"${subject}\" and are reviewing it now.`,
    "",
    assignment,
    "",
    "If the issue changes or becomes more urgent, please reply to this email.",
    "",
    "Thank you,",
    "Gamma Tech Support",
  ].join("\n");
}

export function sortedOutboundEmails(actions: ReadonlyArray<HaloAction>, afterMs: number): ReadonlyArray<HaloAction> {
  return [...actions]
    .filter((action) =>
      isOutboundCustomerEmail(action)
      && haloActionTimestamp(action) >= afterMs - HALO_ACTION_INGESTION_TOLERANCE_MS
    )
    .sort((left, right) => haloActionTimestamp(left) - haloActionTimestamp(right));
}

async function dispatcherPtoStatus(
  supabase: SupabaseClient,
  halo: HaloClient,
  now: Date,
): Promise<PtoStatus> {
  if (ptoCache && now.getTime() - ptoCache.at < PTO_CACHE_MS) return ptoCache.status;
  try {
    const roster = await fetchRoster(halo);
    if (!roster) return "unknown";
    const { start, end } = etTodayBounds(now);
    const calendar = await fetchCalendarSignals(supabase, roster, start, end);
    const dispatcher = [...(calendar?.byTech.entries() ?? [])]
      .find(([name]) => namesMatch(name, DISPATCHER))?.[1];
    const status: PtoStatus = dispatcher ? (dispatcher.onPtoToday ? "yes" : "no") : "unknown";
    ptoCache = { at: now.getTime(), status };
    return status;
  } catch (error) {
    console.warn("[RESPONSE-COMPLIANCE] Dispatcher PTO lookup failed:", error instanceof Error ? error.message : error);
    return "unknown";
  }
}

function outcomeForPto(status: PtoStatus): "missed" | "pto_exempt" | "pto_unknown" {
  if (status === "yes") return "pto_exempt";
  if (status === "unknown") return "pto_unknown";
  return "missed";
}

async function teamsClient(supabase: SupabaseClient): Promise<TeamsClient | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .maybeSingle();
  return data?.config ? new TeamsClient(data.config as TeamsConfig) : null;
}

function dispatchApprovalUrl(): string {
  const base = process.env.TRIAGEIT_WEB_URL ?? "https://triageit.gtools.io";
  try {
    return new URL("/dispatch#customer-email-approvals", base).toString();
  } catch {
    return "https://triageit.gtools.io/dispatch#customer-email-approvals";
  }
}

async function createTrackingRow(
  supabase: SupabaseClient,
  ticket: TrackedTicket,
  settings: ComplianceSettings,
  now: Date,
): Promise<ComplianceRow> {
  const createdAt = new Date(ticket.created_at);
  const assignedTech = isHelpdeskTechnicianName(ticket.halo_agent) ? ticket.halo_agent : null;
  // When a ticket is already assigned on its first one-minute observation,
  // ticket creation is the closest reliable assignment boundary Halo gives
  // us. Later unassigned -> assigned transitions use their observation time.
  const assignedAt = assignedTech ? ticket.created_at : null;
  const payload = {
    ticket_id: ticket.id,
    halo_id: ticket.halo_id,
    ticket_summary: ticket.summary,
    client_name: ticket.client_name,
    ticket_created_at: ticket.created_at,
    acknowledgment_due_at: addResponseBusinessMinutes(createdAt, settings.acknowledgment_minutes).toISOString(),
    assigned_tech: assignedTech,
    assigned_at: assignedAt,
    technician_response_due_at: assignedAt
      ? addResponseBusinessMinutes(new Date(assignedAt), settings.technician_response_minutes).toISOString()
      : null,
    updated_at: now.toISOString(),
  };
  const { data, error } = await supabase
    .from("ticket_response_compliance")
    .upsert(payload, { onConflict: "halo_id", ignoreDuplicates: true })
    .select("id, halo_id, acknowledgment_due_at, acknowledgment_at, dispatcher_outcome, approval_id, teams_alerted_at, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_missed_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? `Could not track ticket #${ticket.halo_id}`);
  return data as ComplianceRow;
}

async function observeAssignment(
  supabase: SupabaseClient,
  row: ComplianceRow,
  ticket: TrackedTicket,
  settings: ComplianceSettings,
  now: Date,
): Promise<ComplianceRow> {
  if (row.assigned_at || !isHelpdeskTechnicianName(ticket.halo_agent)) return row;
  const assignedAt = now.toISOString();
  const dueAt = addResponseBusinessMinutes(now, settings.technician_response_minutes).toISOString();
  const { data, error } = await supabase
    .from("ticket_response_compliance")
    .update({ assigned_tech: ticket.halo_agent, assigned_at: assignedAt, technician_response_due_at: dueAt, updated_at: assignedAt })
    .eq("id", row.id)
    .is("assigned_at", null)
    .select("id, halo_id, acknowledgment_due_at, acknowledgment_at, dispatcher_outcome, approval_id, teams_alerted_at, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_missed_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ComplianceRow | null) ?? row;
}

export async function scanTicketResponseCompliance(): Promise<ResponseComplianceScanResult> {
  const supabase = createSupabaseClient();
  const now = new Date();
  const counters = {
    tracked: 0,
    acknowledgmentsMet: 0,
    dispatcherMisses: 0,
    ptoExemptions: 0,
    technicianResponsesMet: 0,
    technicianMisses: 0,
    approvalsStaged: 0,
    teamsAlertsSent: 0,
  };

  const [{ data: settingsData, error: settingsError }, { data: haloIntegration }] = await Promise.all([
    supabase.from("response_compliance_settings").select("tracking_started_at, acknowledgment_minutes, technician_response_minutes").eq("id", true).maybeSingle(),
    supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).maybeSingle(),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (!settingsData || !haloIntegration?.config) return counters;
  const settings = settingsData as ComplianceSettings;
  const halo = new HaloClient(haloIntegration.config as HaloConfig);

  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, user_name, user_email, halo_agent, created_at")
    .eq("halo_is_open", true)
    .eq("tickettype_id", 31)
    .gte("created_at", settings.tracking_started_at)
    .order("created_at", { ascending: true })
    .limit(200);
  if (ticketError) throw new Error(ticketError.message);
  if (!tickets?.length) return counters;

  const haloIds = tickets.map((ticket) => Number(ticket.halo_id));
  const { data: existing, error: existingError } = await supabase
    .from("ticket_response_compliance")
    .select("id, halo_id, acknowledgment_due_at, acknowledgment_at, dispatcher_outcome, approval_id, teams_alerted_at, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_missed_at")
    .in("halo_id", haloIds);
  if (existingError) throw new Error(existingError.message);
  const existingByHalo = new Map((existing ?? []).map((row) => [Number(row.halo_id), row as ComplianceRow]));

  let currentPto: PtoStatus | null = null;
  let teams: TeamsClient | null | undefined;
  for (const rawTicket of tickets) {
    const ticket = rawTicket as TrackedTicket;
    try {
      let row = existingByHalo.get(ticket.halo_id);
      if (!row) {
        row = await createTrackingRow(supabase, ticket, settings, now);
        counters.tracked++;
      }
      row = await observeAssignment(supabase, row, ticket, settings, now);
      const needsAcknowledgment = !row.acknowledgment_at;
      const needsTechnicianResponse = Boolean(row.assigned_at && !row.technician_response_at);
      if (!needsAcknowledgment && !needsTechnicianResponse) continue;

      const actions = await halo.getTicketActions(ticket.halo_id, true);
      const outbound = sortedOutboundEmails(actions, Date.parse(ticket.created_at));
      const firstOutbound = outbound[0];
      if (needsAcknowledgment && firstOutbound) {
        const at = new Date(haloActionTimestamp(firstOutbound)).toISOString();
        const met = Date.parse(at) <= Date.parse(row.acknowledgment_due_at);
        if (!met && row.dispatcher_outcome === "pending") {
          currentPto ??= await dispatcherPtoStatus(supabase, halo, now);
        }
        const lateOutcome = currentPto ? outcomeForPto(currentPto) : "missed";
        const outcome = met ? "met" : row.dispatcher_outcome === "pending" ? lateOutcome : row.dispatcher_outcome;
        await supabase.from("ticket_response_compliance").update({
          acknowledgment_at: at,
          acknowledgment_by: firstOutbound.who ?? null,
          acknowledgment_action_id: firstOutbound.id,
          acknowledgment_met: met,
          dispatcher_outcome: outcome,
          dispatcher_pto_status: met ? "unknown" : currentPto ?? "unknown",
          dispatcher_missed_at: met ? null : at,
          updated_at: now.toISOString(),
        }).eq("id", row.id).is("acknowledgment_at", null);
        if (met) counters.acknowledgmentsMet++;
        else if (outcome === "pto_exempt") counters.ptoExemptions++;
        else counters.dispatcherMisses++;
        row = { ...row, acknowledgment_at: at, dispatcher_outcome: outcome };
      }

      if (!row.acknowledgment_at && now.getTime() >= Date.parse(row.acknowledgment_due_at)) {
        currentPto ??= await dispatcherPtoStatus(supabase, halo, now);
        const outcome = outcomeForPto(currentPto);
        if (row.dispatcher_outcome === "pending") {
          await supabase.from("ticket_response_compliance").update({
            dispatcher_outcome: outcome,
            dispatcher_pto_status: currentPto,
            dispatcher_missed_at: now.toISOString(),
            updated_at: now.toISOString(),
          }).eq("id", row.id).eq("dispatcher_outcome", "pending");
          if (outcome === "pto_exempt") counters.ptoExemptions++;
          else counters.dispatcherMisses++;
          row = { ...row, dispatcher_outcome: outcome };
        }

        let approvalId = row.approval_id;
        const draft = buildInitialAcknowledgmentDraft({
          customerName: ticket.user_name,
          summary: ticket.summary,
          assignedTech: row.assigned_tech,
          technicianDueAt: row.technician_response_due_at,
        });
        if (!approvalId) {
          const staged = await stageInitialAcknowledgment(supabase, {
            ticketId: ticket.id,
            haloId: ticket.halo_id,
            ticketSummary: ticket.summary,
            clientName: ticket.client_name,
            customerName: ticket.user_name,
            customerEmail: ticket.user_email,
            techName: row.assigned_tech,
            draftMessage: draft,
            nextActionAt: row.technician_response_due_at,
            dispatcherOutcome: outcome,
          });
          approvalId = staged.id;
          await supabase.from("ticket_response_compliance").update({ approval_id: approvalId, updated_at: now.toISOString() }).eq("id", row.id);
          counters.approvalsStaged++;
        }

        if (!row.teams_alerted_at) {
          teams ??= await teamsClient(supabase);
          if (teams) {
            const sent = await teams.sendInitialAcknowledgmentApproval({
              haloId: ticket.halo_id,
              summary: ticket.summary,
              clientName: ticket.client_name,
              assignedTech: row.assigned_tech,
              dispatcherOutcome: outcome,
              draftMessage: draft,
              dispatchUrl: dispatchApprovalUrl(),
            });
            if (sent) {
              await supabase.from("ticket_response_compliance").update({ teams_alerted_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", row.id);
              counters.teamsAlertsSent++;
            }
          }
        }
      }

      if (row.assigned_at && row.technician_response_due_at && !row.technician_response_at) {
        const assignmentMs = Date.parse(row.assigned_at);
        const techResponse = outbound.find((action) =>
          haloActionTimestamp(action) >= assignmentMs && namesMatch(action.who, row.assigned_tech),
        );
        if (techResponse) {
          const at = new Date(haloActionTimestamp(techResponse)).toISOString();
          const met = Date.parse(at) <= Date.parse(row.technician_response_due_at);
          await supabase.from("ticket_response_compliance").update({
            technician_response_at: at,
            technician_response_action_id: techResponse.id,
            technician_response_met: met,
            technician_missed_at: met ? null : at,
            updated_at: now.toISOString(),
          }).eq("id", row.id).is("technician_response_at", null);
          if (met) counters.technicianResponsesMet++;
          else counters.technicianMisses++;
        } else if (!row.technician_missed_at && now.getTime() >= Date.parse(row.technician_response_due_at)) {
          await supabase.from("ticket_response_compliance").update({
            technician_response_met: false,
            technician_missed_at: now.toISOString(),
            updated_at: now.toISOString(),
          }).eq("id", row.id).is("technician_missed_at", null);
          counters.technicianMisses++;
        }
      }
    } catch (error) {
      console.error(`[RESPONSE-COMPLIANCE] Ticket #${ticket.halo_id} failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log("[RESPONSE-COMPLIANCE] Scan complete", counters);
  return counters;
}
