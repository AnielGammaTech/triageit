import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloTicket, HaloAction, HaloConfig } from "@triageit/shared";
import { HaloClient } from "../../integrations/halo/client.js";


interface ReTriageResult {
  readonly haloId: number;
  readonly summary: string;
  readonly clientName: string | null;
  readonly status: string;
  readonly flags: ReadonlyArray<string>;
  readonly recommendation: string;
  readonly daysOpen: number;
  readonly lastActivity: string | null;
  readonly severity: "critical" | "warning" | "info";
}

interface DailyScanResult {
  readonly totalOpen: number;
  readonly scanned: number;
  readonly critical: ReadonlyArray<ReTriageResult>;
  readonly warnings: ReadonlyArray<ReTriageResult>;
  readonly info: ReadonlyArray<ReTriageResult>;
  readonly processingTimeMs: number;
  readonly tokensUsed: number;
}

const RETRIAGE_PROMPT = `You are a ticket status reviewer for an MSP help desk. Analyze this open ticket and its action history.

Your job is to identify:
1. Is this ticket stale? (no activity in a while)
2. Is there a communication gap? (customer replied but tech hasn't responded, or vice versa)
3. Is this ticket at SLA risk?
4. Should it be escalated or reassigned?
5. Any recommendations for the tech team?

Respond with ONLY valid JSON:
{
  "flags": ["list of flags: wot_overdue, customer_waiting, sla_risk, stale, unassigned, needs_escalation"],
  "severity": "critical|warning|info",
  "recommendation": "Brief actionable recommendation for the team"
}`;

function getStatusName(ticket: HaloTicket): string {
  return ticket.status ?? `status_${ticket.status_id}`;
}

function daysBetween(date1: string, date2: string): number {
  return Math.floor(
    (new Date(date2).getTime() - new Date(date1).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function getLastActivity(actions: ReadonlyArray<HaloAction>): string | null {
  if (actions.length === 0) return null;
  const sorted = [...actions].sort(
    (a, b) =>
      new Date(b.datecreated ?? "").getTime() -
      new Date(a.datecreated ?? "").getTime(),
  );
  return sorted[0]?.datecreated ?? null;
}

function getLastCustomerReply(actions: ReadonlyArray<HaloAction>): string | null {
  const customerActions = actions.filter(
    (a) => !a.hiddenfromuser && a.who && !a.who.includes("TriageIt"),
  );
  if (customerActions.length === 0) return null;
  const sorted = [...customerActions].sort(
    (a, b) =>
      new Date(b.datecreated ?? "").getTime() -
      new Date(a.datecreated ?? "").getTime(),
  );
  return sorted[0]?.datecreated ?? null;
}

function getLastTechAction(actions: ReadonlyArray<HaloAction>): string | null {
  const techActions = actions.filter((a) => a.hiddenfromuser);
  if (techActions.length === 0) return null;
  const sorted = [...techActions].sort(
    (a, b) =>
      new Date(b.datecreated ?? "").getTime() -
      new Date(a.datecreated ?? "").getTime(),
  );
  return sorted[0]?.datecreated ?? null;
}

// Quick rule-based check before using AI (saves tokens)
function quickRuleCheck(
  ticket: HaloTicket,
  actions: ReadonlyArray<HaloAction>,
): ReTriageResult | null {
  const now = new Date().toISOString();
  const status = getStatusName(ticket);
  const statusLower = status.toLowerCase();
  const daysOpen = daysBetween(ticket.datecreated, now);
  const lastActivity = getLastActivity(actions);
  const flags: string[] = [];
  let severity: "critical" | "warning" | "info" = "info";

  // WOT > 1 day
  if (statusLower.includes("waiting on tech")) {
    const lastChange = lastActivity ?? ticket.datecreated;
    const hoursInStatus =
      (Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60);
    if (hoursInStatus > 24) {
      flags.push("wot_overdue");
      severity = "critical";
    }
  }

  // Customer Reply > 1 day with no tech response
  if (statusLower.includes("customer reply")) {
    const lastCustomer = getLastCustomerReply(actions);
    if (lastCustomer) {
      const hoursSinceReply =
        (Date.now() - new Date(lastCustomer).getTime()) / (1000 * 60 * 60);
      if (hoursSinceReply > 24) {
        flags.push("customer_waiting");
        severity = "critical";
      }
    }
  }

  // Unassigned
  if (!ticket.agent_id) {
    flags.push("unassigned");
    if (severity === "info") severity = "warning";
  }

  // Stale — no activity in 3+ days
  if (lastActivity) {
    const daysSinceActivity = daysBetween(lastActivity, now);
    if (daysSinceActivity >= 3) {
      flags.push("stale");
      if (severity === "info") severity = "warning";
    }
  }

  if (flags.length === 0) return null;

  const recommendations: string[] = [];
  if (flags.includes("wot_overdue"))
    recommendations.push("Tech has not acted on this ticket for 24+ hours — needs immediate attention.");
  if (flags.includes("customer_waiting"))
    recommendations.push("Customer replied 24+ hours ago with no tech follow-up — respond ASAP.");
  if (flags.includes("unassigned"))
    recommendations.push("Ticket is unassigned — needs to be picked up by a tech.");
  if (flags.includes("stale"))
    recommendations.push(`No activity for ${daysBetween(lastActivity!, now)} days — review and update.`);

  return {
    haloId: ticket.id,
    summary: ticket.summary,
    clientName: ticket.client_name ?? null,
    status,
    flags,
    recommendation: recommendations.join(" "),
    daysOpen,
    lastActivity,
    severity,
  };
}

export async function runDailyScan(supabase: SupabaseClient): Promise<DailyScanResult> {
  const startTime = Date.now();
  let tokensUsed = 0;

  // Get Halo config
  const { data: haloIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!haloIntegration) {
    throw new Error("Halo PSA integration not configured or inactive");
  }

  const halo = new HaloClient(haloIntegration.config as HaloConfig);

  // Pull all open tickets from Halo
  const openTickets = await halo.getOpenTickets();

  const critical: ReTriageResult[] = [];
  const warnings: ReTriageResult[] = [];
  const info: ReTriageResult[] = [];

  const client = new Anthropic();

  for (const ticket of openTickets) {
    try {
      // Pull actions for this ticket
      const actions = await halo.getTicketActions(ticket.id);

      // Quick rule-based check first (free, no tokens)
      const ruleResult = quickRuleCheck(ticket, actions);
      if (ruleResult) {
        if (ruleResult.severity === "critical") critical.push(ruleResult);
        else if (ruleResult.severity === "warning") warnings.push(ruleResult);
        else info.push(ruleResult);

        // Update ticket tracking in Supabase
        await supabase
          .from("tickets")
          .update({
            halo_status: getStatusName(ticket),
            halo_status_id: ticket.status_id,
            halo_team: ticket.team ?? null,
            halo_agent: ticket.agent_id ? String(ticket.agent_id) : null,
            last_retriage_at: new Date().toISOString(),
            last_customer_reply_at: getLastCustomerReply(actions),
            last_tech_action_at: getLastTechAction(actions),
            updated_at: new Date().toISOString(),
          })
          .eq("halo_id", ticket.id);

        continue;
      }

      // For non-obvious tickets, use Haiku for a quick assessment
      const now = new Date().toISOString();
      const daysOpen = daysBetween(ticket.datecreated, now);
      const lastActivity = getLastActivity(actions);
      const status = getStatusName(ticket);

      const contextMessage = [
        `Ticket #${ticket.id}: ${ticket.summary}`,
        `Client: ${ticket.client_name ?? "Unknown"}`,
        `Status: ${status}`,
        `Priority: ${ticket.priority ?? "Unknown"}`,
        `Team: ${ticket.team ?? "Unassigned"}`,
        `Agent: ${ticket.agent_id ? "Assigned" : "UNASSIGNED"}`,
        `Created: ${ticket.datecreated} (${daysOpen} days ago)`,
        `Last Activity: ${lastActivity ?? "None"}`,
        "",
        `Recent Actions (last 10):`,
        ...actions.slice(0, 10).map(
          (a) =>
            `  [${a.datecreated ?? "?"}] ${a.hiddenfromuser ? "(internal)" : "(customer-visible)"} ${a.who ?? "unknown"}: ${a.note?.substring(0, 200) ?? ""}`,
        ),
      ].join("\n");

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: RETRIAGE_PROMPT,
        messages: [{ role: "user", content: contextMessage }],
      });

      tokensUsed += response.usage.input_tokens + response.usage.output_tokens;

      const text =
        response.content[0].type === "text" ? response.content[0].text : "{}";
      const parsed = JSON.parse(text) as {
        flags: string[];
        severity: "critical" | "warning" | "info";
        recommendation: string;
      };

      const result: ReTriageResult = {
        haloId: ticket.id,
        summary: ticket.summary,
        clientName: ticket.client_name ?? null,
        status,
        flags: parsed.flags,
        recommendation: parsed.recommendation,
        daysOpen,
        lastActivity,
        severity: parsed.severity,
      };

      if (parsed.severity === "critical") critical.push(result);
      else if (parsed.severity === "warning") warnings.push(result);
      else info.push(result);

      // Update ticket tracking
      await supabase
        .from("tickets")
        .update({
          halo_status: status,
          halo_status_id: ticket.status_id,
          halo_team: ticket.team ?? null,
          halo_agent: ticket.agent_id ? String(ticket.agent_id) : null,
          last_retriage_at: new Date().toISOString(),
          last_customer_reply_at: getLastCustomerReply(actions),
          last_tech_action_at: getLastTechAction(actions),
          updated_at: new Date().toISOString(),
        })
        .eq("halo_id", ticket.id);

      // Insert re-triage result (only if we have a local ticket record)
      const { data: localTicket } = await supabase
        .from("tickets")
        .select("id")
        .eq("halo_id", ticket.id)
        .single();

      if (localTicket) {
        await supabase.from("triage_results").insert({
          id: crypto.randomUUID(),
          ticket_id: localTicket.id,
          classification: { type: "retriage", subtype: parsed.severity },
          urgency_score: parsed.severity === "critical" ? 5 : parsed.severity === "warning" ? 3 : 1,
          urgency_reasoning: parsed.recommendation,
          recommended_priority: parsed.severity === "critical" ? 1 : parsed.severity === "warning" ? 3 : 5,
          recommended_team: ticket.team ?? "General",
          security_flag: false,
          findings: { daily_scan: { flags: parsed.flags, recommendation: parsed.recommendation } },
          internal_notes: parsed.recommendation,
          processing_time_ms: Date.now() - startTime,
          model_tokens_used: { manager: 0, workers: { daily_scan: tokensUsed } },
          triage_type: "retriage",
        });
      }
    } catch (err) {
      console.error(`[RETRIAGE] Error scanning ticket #${ticket.id}:`, err);
    }
  }

  const processingTime = Date.now() - startTime;

  // Log the daily scan (use first ticket as reference, or skip if no tickets)
  if (openTickets.length > 0) {
    const { data: refTicket } = await supabase
      .from("tickets")
      .select("id")
      .eq("halo_id", openTickets[0].id)
      .single();

    if (refTicket) {
      await supabase.from("agent_logs").insert({
        ticket_id: refTicket.id,
        agent_name: "daily_scan",
        agent_role: "retriage",
        status: "completed",
        output_summary: `Scanned ${openTickets.length} tickets: ${critical.length} critical, ${warnings.length} warnings, ${info.length} info`,
        tokens_used: tokensUsed,
        duration_ms: processingTime,
      });
    }
  }

  return {
    totalOpen: openTickets.length,
    scanned: openTickets.length,
    critical,
    warnings,
    info,
    processingTimeMs: processingTime,
    tokensUsed,
  };
}
