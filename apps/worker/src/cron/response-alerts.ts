import { createSupabaseClient } from "../db/supabase.js";
import { TeamsClient } from "../integrations/teams/client.js";
import { isHelpdeskTechnicianName, type TeamsConfig } from "@triageit/shared";
import {
  isResponseBusinessTime,
  responseBusinessMinutesBetween,
} from "../response-compliance/business-time.js";
import { recordWeeklyScoreEvent } from "../scoring/weekly-score-events.js";
import { buildDispatchBoard } from "../dispatch/board.js";
import { namesMatch } from "../dispatch/board-sources.js";

const WARNING_HOURS = 1;
const ESCALATION_HOURS = 2;
const WARNING_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
const ESCALATION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Calculate business hours between a date and now.
 * Business hours: 8 AM - 5 PM ET, Mon-Fri only.
 */
function businessHoursSince(dateStr: string): number {
  return responseBusinessMinutesBetween(new Date(dateStr), new Date()) / 60;
}

interface AlertResult {
  readonly warnings: number;
  readonly escalations: number;
}

/**
 * Scan for tickets where tech hasn't responded to customer reply.
 * Sends warning at 1h, escalation to David at 2h.
 */
export async function scanForResponseAlerts(): Promise<AlertResult> {
  // Only run during business hours
  const now = new Date();
  if (!isResponseBusinessTime(now)) {
    return { warnings: 0, escalations: 0 };
  }

  const supabase = createSupabaseClient();

  // Find tickets where customer replied but tech hasn't responded.
  // halo_is_open is the source of truth — tickets closed via the 404 path
  // keep their last open status name, so status-name filters alone
  // re-alerted on closed tickets every 3-6h forever.
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_agent, halo_status, last_customer_reply_at, last_tech_action_at, last_response_alert_at, last_escalation_alert_at")
    .not("last_customer_reply_at", "is", null)
    .eq("halo_is_open", true)
    .not("halo_status", "ilike", "%waiting on customer%")
    .not("halo_status", "ilike", "%closed%")
    .not("halo_status", "ilike", "%resolved%")
    .not("halo_status", "ilike", "%cancelled%")
    .not("halo_status", "ilike", "%completed%")
    .not("status", "in", '("error","failed_permanent")');

  if (!tickets || tickets.length === 0) {
    return { warnings: 0, escalations: 0 };
  }

  // Filter: customer replied AFTER last tech action (or no tech action at all)
  const needsResponse = tickets.filter((t) => {
    if (!t.last_customer_reply_at) return false;
    if (!t.last_tech_action_at) return true;
    return new Date(t.last_customer_reply_at) > new Date(t.last_tech_action_at);
  });

  if (needsResponse.length === 0) {
    return { warnings: 0, escalations: 0 };
  }

  // The weekly deduction is an incident record, not a reflection of the live
  // queue. Persist it once the one-business-hour threshold is crossed so it
  // remains after the technician replies or the ticket is resolved.
  let schedule: Awaited<ReturnType<typeof buildDispatchBoard>> | null = null;
  try {
    schedule = await buildDispatchBoard();
  } catch {
    // A missing schedule signal must not erase an otherwise verified incident.
  }
  for (const ticket of needsResponse) {
    const hoursSince = businessHoursSince(ticket.last_customer_reply_at);
    if (hoursSince < WARNING_HOURS || !isHelpdeskTechnicianName(ticket.halo_agent)) continue;
    const state = schedule?.techs.find((tech) => namesMatch(tech.tech, ticket.halo_agent))?.status.state;
    if (state === "off" || state === "after_hours") continue;
    await recordWeeklyScoreEvent(supabase, {
      eventKey: `overdue_customer_reply:${ticket.halo_id}:${Date.parse(ticket.last_customer_reply_at)}`,
      eventType: "overdue_customer_reply",
      haloTicketId: ticket.halo_id,
      technicianName: ticket.halo_agent,
      points: -2,
      occurredAt: new Date().toISOString(),
      summary: ticket.summary,
      metadata: {
        customer_reply_at: ticket.last_customer_reply_at,
        business_hours_waited_when_recorded: Math.round(hoursSince * 100) / 100,
      },
    });
  }

  // Get Teams config
  const { data: teamsIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  if (!teamsIntegration) {
    console.log("[RESPONSE-ALERTS] Teams not configured — skipping");
    return { warnings: 0, escalations: 0 };
  }

  const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);

  let warnings = 0;
  let escalations = 0;
  const nowMs = Date.now();

  for (const ticket of needsResponse) {
    const hoursSince = businessHoursSince(ticket.last_customer_reply_at);

    // 2h escalation (check first — higher priority)
    if (hoursSince >= ESCALATION_HOURS) {
      const lastEsc = ticket.last_escalation_alert_at ? new Date(ticket.last_escalation_alert_at).getTime() : 0;
      if (nowMs - lastEsc > ESCALATION_COOLDOWN_MS) {
        await teams.sendResponseAlert({
          haloId: ticket.halo_id,
          summary: ticket.summary,
          clientName: ticket.client_name,
          techName: ticket.halo_agent,
          hoursSinceReply: Math.round(hoursSince * 10) / 10,
          isEscalation: true,
        });

        await supabase
          .from("tickets")
          .update({ last_escalation_alert_at: new Date().toISOString() })
          .eq("id", ticket.id);

        escalations++;
        console.log(`[RESPONSE-ALERTS] ESCALATION: #${ticket.halo_id} — ${hoursSince.toFixed(1)}h without tech response`);
      }
    }
    // 1h warning
    else if (hoursSince >= WARNING_HOURS) {
      const lastAlert = ticket.last_response_alert_at ? new Date(ticket.last_response_alert_at).getTime() : 0;
      if (nowMs - lastAlert > WARNING_COOLDOWN_MS) {
        await teams.sendResponseAlert({
          haloId: ticket.halo_id,
          summary: ticket.summary,
          clientName: ticket.client_name,
          techName: ticket.halo_agent,
          hoursSinceReply: Math.round(hoursSince * 10) / 10,
          isEscalation: false,
        });

        await supabase
          .from("tickets")
          .update({ last_response_alert_at: new Date().toISOString() })
          .eq("id", ticket.id);

        warnings++;
        console.log(`[RESPONSE-ALERTS] WARNING: #${ticket.halo_id} — ${hoursSince.toFixed(1)}h without tech response`);
      }
    }
  }

  return { warnings, escalations };
}
