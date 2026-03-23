import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticket } from "@triageit/shared";
import type { TriageContext, TriageOutput, ClassificationResult } from "../types.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";
import {
  isAlertTicket,
  summarizeAlert,
} from "../workers/erin-hannon.js";
import { findSimilarTickets } from "../similar-tickets.js";
import type { SimilarTicket } from "../similar-tickets.js";
import { buildFastPathNote, buildAlertPathNote } from "./halo-note-builder.js";

// Halo ticket type IDs
const HALO_ALERTS_TYPE_ID = 36;

// ── Helpers ──────────────────────────────────────────────────────────

async function getHaloConfig(
  supabase: SupabaseClient,
): Promise<HaloConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  return data ? (data.config as HaloConfig) : null;
}

// ── Notification Fast Path ───────────────────────────────────────────

const NOTIFICATION_KEYWORDS = [
  "notification", "transactional", "confirmation", "receipt", "alert",
  "auto-replenish", "renewal", "invoice", "statement", "reminder",
  "processed", "completion", "delivered", "shipped",
] as const;

export async function tryNotificationFastPath(
  classification: ClassificationResult,
  context: TriageContext,
  supabase: SupabaseClient,
  ticket: Ticket,
  startTime: number,
): Promise<TriageOutput | null> {
  const subtype = classification.classification.subtype?.toLowerCase() ?? "";
  const classTypeLower = classification.classification.type?.toLowerCase() ?? "";
  const isNotification =
    NOTIFICATION_KEYWORDS.some((kw) => subtype.includes(kw)) ||
    (classTypeLower === "billing" && classification.urgency_score <= 2) ||
    (classTypeLower === "other" && subtype.includes("email") && classification.urgency_score <= 2);

  if (
    !isNotification ||
    classification.urgency_score > 2 ||
    classification.security_flag ||
    context.slaBreached
  ) {
    return null;
  }

  const fastProcessingTime = Date.now() - startTime;

  const fastHaloConfig = await getHaloConfig(supabase);
  if (fastHaloConfig) {
    const halo = new HaloClient(fastHaloConfig);
    try {
      const fastNote = buildFastPathNote(classification, fastProcessingTime);
      await halo.addInternalNote(ticket.halo_id, fastNote);
    } catch (error) {
      console.error(`[MICHAEL] Fast path: Failed to write Halo note for #${ticket.halo_id}:`, error);
    }

    // Move notification tickets to "Alerts" type (id=36) in Halo
    try {
      await halo.updateTicketType(ticket.halo_id, HALO_ALERTS_TYPE_ID);
      console.log(`[MICHAEL] Fast path: Changed ticket #${ticket.halo_id} to Alerts type`);
    } catch (error) {
      console.error(`[MICHAEL] Fast path: Failed to change ticket type for #${ticket.halo_id}:`, error);
    }
  }

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "completed",
    output_summary: `Fast path: ${classification.classification.type}/${classification.classification.subtype}, P${classification.recommended_priority}`,
    duration_ms: fastProcessingTime,
  });

  const triageId = crypto.randomUUID();
  return {
    id: triageId,
    ticket_id: ticket.id,
    classification: classification.classification,
    urgency_score: classification.urgency_score,
    urgency_reasoning: classification.urgency_reasoning,
    recommended_priority: classification.recommended_priority,
    recommended_team: "General",
    recommended_agent: null,
    security_flag: false,
    security_notes: null,
    findings: {
      ryan_howard: {
        agent_name: "ryan_howard",
        summary: `Notification: ${classification.classification.subtype}`,
        data: classification as unknown as Record<string, unknown>,
        confidence: classification.classification.confidence,
      },
    },
    suggested_response: null,
    internal_notes: "Notification/transactional ticket — no action required.",
    processing_time_ms: fastProcessingTime,
    model_tokens_used: { manager: 0, workers: {} },
  };
}

// ── Alert Fast Path ──────────────────────────────────────────────────

export async function tryAlertFastPath(
  classification: ClassificationResult,
  context: TriageContext,
  supabase: SupabaseClient,
  ticket: Ticket,
  startTime: number,
): Promise<TriageOutput | null> {
  const classType = classification.classification.type;
  const isAlert = classification.is_automated_alert || isAlertTicket(
    ticket.summary,
    ticket.details,
    classType,
    classification.classification.subtype ?? "",
  );

  // Skip fast path for SLA-breached tickets (need full analysis).
  // Allow security_flag through for alerts — DMARC reports, phishing alerts, etc.
  // are automated and should still use the alert fast path.
  if (!isAlert || context.slaBreached) {
    return null;
  }

  const alertStart = Date.now();

  const [alertResult, alertSimilarTickets] = await Promise.all([
    (async () => {
      await supabase.from("agent_logs").insert({
        ticket_id: ticket.id,
        agent_name: "erin_hannon",
        agent_role: "alert_specialist",
        status: "started",
        input_summary: `Summarizing alert: ${ticket.summary}`,
      });
      return summarizeAlert(context);
    })(),
    findSimilarTickets(supabase, {
      currentTicketId: ticket.id,
      summary: context.summary,
      details: context.details,
      clientName: context.clientName,
      maxResults: 3,
    }).catch(() => [] as ReadonlyArray<SimilarTicket>),
  ]);

  const alertProcessingTime = Date.now() - startTime;

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "erin_hannon",
    agent_role: "alert_specialist",
    status: "completed",
    output_summary: alertResult.summary,
    duration_ms: Date.now() - alertStart,
  });

  const alertHaloConfig = await getHaloConfig(supabase);
  if (alertHaloConfig) {
    const halo = new HaloClient(alertHaloConfig);
    try {
      const alertNote = buildAlertPathNote(alertResult, alertProcessingTime, alertSimilarTickets);
      await halo.addInternalNote(ticket.halo_id, alertNote);
    } catch (error) {
      console.error(`[MICHAEL] Alert path: Failed to write Halo note for #${ticket.halo_id}:`, error);
    }

    // Move ticket to "Alerts" type (id=36) in Halo so it doesn't clog the main queue
    try {
      await halo.updateTicketType(ticket.halo_id, HALO_ALERTS_TYPE_ID);
      console.log(`[MICHAEL] Alert path: Changed ticket #${ticket.halo_id} to Alerts type`);
    } catch (error) {
      console.error(`[MICHAEL] Alert path: Failed to change ticket type for #${ticket.halo_id}:`, error);
    }
  }

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "completed",
    output_summary: `Alert path: ${alertResult.alert_source} — ${alertResult.alert_type} (${alertResult.severity})`,
    duration_ms: alertProcessingTime,
  });

  const triageId = crypto.randomUUID();
  return {
    id: triageId,
    ticket_id: ticket.id,
    classification: classification.classification,
    urgency_score: classification.urgency_score,
    urgency_reasoning: classification.urgency_reasoning,
    recommended_priority: classification.recommended_priority,
    recommended_team: alertResult.alert_source,
    recommended_agent: null,
    security_flag: false,
    security_notes: null,
    findings: {
      ryan_howard: {
        agent_name: "ryan_howard",
        summary: `Classified as ${classification.classification.type}/${classification.classification.subtype}`,
        data: classification as unknown as Record<string, unknown>,
        confidence: classification.classification.confidence,
      },
      erin_hannon: {
        agent_name: "erin_hannon",
        summary: alertResult.summary,
        data: alertResult as unknown as Record<string, unknown>,
        confidence: 0.9,
      },
    },
    suggested_response: null,
    internal_notes: `Alert: ${alertResult.summary}. Action: ${alertResult.suggested_action}`,
    processing_time_ms: alertProcessingTime,
    model_tokens_used: { manager: 0, workers: { erin_hannon: 0 } },
  };
}
