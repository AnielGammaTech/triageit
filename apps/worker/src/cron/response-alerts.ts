import { createSupabaseClient } from "../db/supabase.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

const WARNING_HOURS = 1;
const ESCALATION_HOURS = 2;
const WARNING_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
const ESCALATION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Calculate business hours between a date and now.
 * Business hours: 7 AM - 6 PM ET, Mon-Fri only.
 */
function businessHoursSince(dateStr: string): number {
  const start = new Date(dateStr);
  const now = new Date();
  let hours = 0;

  const current = new Date(start);
  while (current < now) {
    const et = new Date(current.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = et.getHours();
    const day = et.getDay();

    if (day >= 1 && day <= 5 && hour >= 7 && hour < 18) {
      hours += 1 / 60; // minute increments
    }

    current.setMinutes(current.getMinutes() + 1);

    // Safety: cap at 100 business hours to avoid infinite loops
    if (hours > 100) break;
  }

  return hours;
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
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = eastern.getHours();
  const day = eastern.getDay();
  if (day === 0 || day === 6 || hour < 7 || hour >= 18) {
    return { warnings: 0, escalations: 0 };
  }

  const supabase = createSupabaseClient();

  // Find tickets where customer replied but tech hasn't responded
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_agent, halo_status, last_customer_reply_at, last_tech_action_at, last_response_alert_at, last_escalation_alert_at")
    .not("last_customer_reply_at", "is", null)
    .not("halo_status", "ilike", "%waiting on customer%")
    .not("halo_status", "ilike", "%closed%")
    .not("halo_status", "ilike", "%resolved%")
    .not("halo_status", "ilike", "%cancelled%")
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
