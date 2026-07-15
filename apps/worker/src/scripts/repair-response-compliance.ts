import type { HaloConfig } from "@triageit/shared";
import { sortedOutboundEmails } from "../cron/ticket-response-compliance.js";
import { createSupabaseClient } from "../db/supabase.js";
import { namesMatch } from "../dispatch/board-sources.js";
import { etTodayBounds } from "../dispatch/et-time.js";
import { HaloClient } from "../integrations/halo/client.js";
import { haloActionTimestamp } from "../voice/customer-wait-state.js";

interface ComplianceRow {
  readonly id: string;
  readonly halo_id: number;
  readonly ticket_created_at: string;
  readonly acknowledgment_due_at: string;
  readonly acknowledgment_at: string | null;
  readonly acknowledgment_action_id: number | null;
  readonly acknowledgment_by: string | null;
  readonly acknowledgment_met: boolean | null;
  readonly dispatcher_outcome: "pending" | "met" | "missed" | "pto_exempt" | "pto_unknown";
  readonly dispatcher_pto_status: "yes" | "no" | "unknown";
  readonly dispatcher_missed_at: string | null;
  readonly assigned_tech: string | null;
  readonly assigned_at: string | null;
  readonly technician_response_due_at: string | null;
  readonly technician_response_at: string | null;
  readonly technician_response_action_id: number | null;
  readonly technician_response_met: boolean | null;
  readonly technician_missed_at: string | null;
}

type RepairPatch = Record<string, string | number | boolean | null>;

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right || (left == null && right == null)) return true;
  if (typeof left === "string" && typeof right === "string" && left.includes("T") && right.includes("T")) {
    const leftMs = Date.parse(left);
    const rightMs = Date.parse(right);
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
  }
  return false;
}

function changedPatch(row: ComplianceRow, patch: RepairPatch): RepairPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => !sameValue(row[key as keyof ComplianceRow], value)),
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const supabase = createSupabaseClient();
  const { data: haloIntegration, error: integrationError } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .maybeSingle();
  if (integrationError) throw new Error(integrationError.message);
  if (!haloIntegration?.config) throw new Error("Active Halo integration not found");

  const { data, error } = await supabase
    .from("ticket_response_compliance")
    .select("id, halo_id, ticket_created_at, acknowledgment_due_at, acknowledgment_at, acknowledgment_action_id, acknowledgment_by, acknowledgment_met, dispatcher_outcome, dispatcher_pto_status, dispatcher_missed_at, assigned_tech, assigned_at, technician_response_due_at, technician_response_at, technician_response_action_id, technician_response_met, technician_missed_at")
    .order("ticket_created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const halo = new HaloClient(haloIntegration.config as HaloConfig);
  const now = new Date();
  const { start: todayStart } = etTodayBounds(now);
  const changes: Array<{ haloId: number; fields: ReadonlyArray<string> }> = [];
  const failures: Array<{ haloId: number; error: string }> = [];
  const projectedToday = {
    acknowledgmentOnTime: 0,
    acknowledgmentMissed: 0,
    acknowledgmentPtoExempt: 0,
    acknowledgmentPending: 0,
    technicianOnTime: 0,
    technicianMissed: 0,
    technicianPending: 0,
  };

  for (const row of (data ?? []) as ReadonlyArray<ComplianceRow>) {
    try {
      const actions = await halo.getTicketActions(row.halo_id, true);
      const outbound = sortedOutboundEmails(actions, Date.parse(row.ticket_created_at));
      const acknowledgment = outbound[0] ?? null;
      const acknowledgmentAt = acknowledgment
        ? new Date(haloActionTimestamp(acknowledgment)).toISOString()
        : null;
      const acknowledgmentDue = Date.parse(row.acknowledgment_due_at);
      const acknowledgmentMet = acknowledgmentAt
        ? Date.parse(acknowledgmentAt) <= acknowledgmentDue
        : now.getTime() < acknowledgmentDue ? null : false;
      const preservePto = row.dispatcher_outcome === "pto_exempt" || row.dispatcher_outcome === "pto_unknown";
      const dispatcherOutcome = acknowledgmentMet === true
        ? "met"
        : preservePto
          ? row.dispatcher_outcome
          : acknowledgmentMet === false ? "missed" : "pending";

      let technicianResponseAt: string | null = null;
      let technicianResponseActionId: number | null = null;
      let technicianResponseMet: boolean | null = null;
      let technicianMissedAt: string | null = null;
      if (row.assigned_at && row.assigned_tech && row.technician_response_due_at) {
        const assignmentMs = Date.parse(row.assigned_at);
        const technicianResponse = outbound.find((action) =>
          haloActionTimestamp(action) >= assignmentMs && namesMatch(action.who, row.assigned_tech),
        );
        if (technicianResponse) {
          technicianResponseAt = new Date(haloActionTimestamp(technicianResponse)).toISOString();
          technicianResponseActionId = technicianResponse.id;
          technicianResponseMet = Date.parse(technicianResponseAt) <= Date.parse(row.technician_response_due_at);
          technicianMissedAt = technicianResponseMet ? null : technicianResponseAt;
        } else if (now.getTime() >= Date.parse(row.technician_response_due_at)) {
          technicianResponseMet = false;
          technicianMissedAt = row.technician_response_due_at;
        }
      }

      if (Date.parse(row.ticket_created_at) >= Date.parse(todayStart)) {
        if (acknowledgmentMet === true) projectedToday.acknowledgmentOnTime++;
        else if (dispatcherOutcome === "missed") projectedToday.acknowledgmentMissed++;
        else if (dispatcherOutcome === "pto_exempt") projectedToday.acknowledgmentPtoExempt++;
        else if (dispatcherOutcome === "pending") projectedToday.acknowledgmentPending++;
        if (technicianResponseMet === true) projectedToday.technicianOnTime++;
        else if (technicianResponseMet === false) projectedToday.technicianMissed++;
        else if (row.assigned_at) projectedToday.technicianPending++;
      }

      const patch = changedPatch(row, {
        acknowledgment_at: acknowledgmentAt,
        acknowledgment_action_id: acknowledgment?.id ?? null,
        acknowledgment_by: acknowledgment?.who ?? null,
        acknowledgment_met: acknowledgmentMet,
        dispatcher_outcome: dispatcherOutcome,
        dispatcher_pto_status: acknowledgmentMet === true ? "unknown" : row.dispatcher_pto_status,
        dispatcher_missed_at: acknowledgmentMet === true
          ? null
          : acknowledgmentMet === false ? acknowledgmentAt ?? row.acknowledgment_due_at : null,
        technician_response_at: technicianResponseAt,
        technician_response_action_id: technicianResponseActionId,
        technician_response_met: technicianResponseMet,
        technician_missed_at: technicianMissedAt,
      });
      if (Object.keys(patch).length === 0) continue;

      changes.push({ haloId: row.halo_id, fields: Object.keys(patch) });
      if (apply) {
        const { error: updateError } = await supabase
          .from("ticket_response_compliance")
          .update({ ...patch, updated_at: now.toISOString() })
          .eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
      }
    } catch (error) {
      failures.push({
        haloId: row.halo_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scanned: data?.length ?? 0,
    changed: changes.length,
    projectedToday,
    failures,
    changes,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

await main();
