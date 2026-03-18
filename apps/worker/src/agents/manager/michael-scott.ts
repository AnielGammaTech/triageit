import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticket } from "@triageit/shared";
import type { TriageContext, TriageOutput } from "../types.js";
import { classifyTicket } from "../workers/ryan-howard.js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";

const SYSTEM_PROMPT = `You are Michael Scott, the Regional Manager of Dunder Mifflin IT Triage.

You have just received the classification results from Ryan Howard (your classifier agent) for a support ticket. Your job is to:

1. Review Ryan's classification and adjust if needed
2. Synthesize all findings into clear internal notes for the technician
3. Suggest which team should handle this ticket
4. Write a brief internal summary

## Output Format
Respond with ONLY valid JSON, no markdown:
{
  "recommended_team": "<team name: Network, Security, Endpoint, Cloud, Identity, Email, Application, General>",
  "recommended_agent": "<specific technician if known, null otherwise>",
  "internal_notes": "<comprehensive internal notes for the assigned technician>",
  "suggested_response": "<brief client-facing acknowledgment if appropriate, null if not needed>",
  "adjustments": "<any adjustments to Ryan's classification, null if none>"
}`;

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

function buildTriageContext(ticket: Ticket): TriageContext {
  return {
    ticketId: ticket.id,
    haloId: ticket.halo_id,
    summary: ticket.summary,
    details: ticket.details,
    clientName: ticket.client_name,
    userName: ticket.user_name,
    originalPriority: ticket.original_priority,
  };
}

export async function runTriage(
  ticket: Ticket,
  supabase: SupabaseClient,
): Promise<TriageOutput> {
  const startTime = Date.now();
  const context = buildTriageContext(ticket);

  // Log Michael starting
  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "started",
    input_summary: `Triaging ticket #${ticket.halo_id}: ${ticket.summary}`,
  });

  // Step 1: Ryan classifies the ticket
  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "ryan_howard",
    agent_role: "classifier",
    status: "started",
    input_summary: `Classifying ticket #${ticket.halo_id}`,
  });

  const ryanStart = Date.now();
  const classification = await classifyTicket(context);
  const ryanDuration = Date.now() - ryanStart;

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "ryan_howard",
    agent_role: "classifier",
    status: "completed",
    output_summary: `Type: ${classification.classification.type}/${classification.classification.subtype}, Urgency: ${classification.urgency_score}/5, Security: ${classification.security_flag}`,
    duration_ms: ryanDuration,
  });

  // Step 2: Michael synthesizes and makes final decisions
  const client = new Anthropic();

  const michaelMessage = [
    `## Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Description:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
    context.userName ? `**Reported By:** ${context.userName}` : "",
    "",
    "## Ryan Howard's Classification",
    `**Type:** ${classification.classification.type} / ${classification.classification.subtype}`,
    `**Confidence:** ${(classification.classification.confidence * 100).toFixed(0)}%`,
    `**Urgency Score:** ${classification.urgency_score}/5`,
    `**Urgency Reasoning:** ${classification.urgency_reasoning}`,
    `**Recommended Priority:** P${classification.recommended_priority}`,
    `**Entities Found:** ${classification.entities.join(", ") || "None"}`,
    classification.security_flag
      ? `**SECURITY FLAG:** ${classification.security_notes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: michaelMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const michaelResult = parseLlmJson<{
    recommended_team: string;
    recommended_agent: string | null;
    internal_notes: string;
    suggested_response: string | null;
    adjustments: string | null;
  }>(text);

  const processingTime = Date.now() - startTime;

  // Step 3: Write back to Halo if configured
  const haloConfig = await getHaloConfig(supabase);
  if (haloConfig) {
    const halo = new HaloClient(haloConfig);
    try {
      const internalNote = [
        "## AI Triage Summary (TriageIt)",
        "",
        `**Classification:** ${classification.classification.type} / ${classification.classification.subtype} (${(classification.classification.confidence * 100).toFixed(0)}% confidence)`,
        `**Urgency:** ${classification.urgency_score}/5 — ${classification.urgency_reasoning}`,
        `**Recommended Priority:** P${classification.recommended_priority}`,
        `**Recommended Team:** ${michaelResult.recommended_team}`,
        classification.security_flag
          ? `**SECURITY ALERT:** ${classification.security_notes}`
          : "",
        "",
        "### Technician Notes",
        michaelResult.internal_notes,
        "",
        `*Processed in ${processingTime}ms by TriageIt*`,
      ]
        .filter(Boolean)
        .join("\n");

      await halo.addInternalNote(ticket.halo_id, internalNote);
    } catch (error) {
      console.error(
        `[MICHAEL] Failed to write back to Halo for ticket #${ticket.halo_id}:`,
        error,
      );
    }
  }

  // Log Michael completed
  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "completed",
    output_summary: `Team: ${michaelResult.recommended_team}, Priority: P${classification.recommended_priority}`,
    duration_ms: processingTime,
  });

  const triageId = crypto.randomUUID();

  return {
    id: triageId,
    ticket_id: ticket.id,
    classification: classification.classification,
    urgency_score: classification.urgency_score,
    urgency_reasoning: classification.urgency_reasoning,
    recommended_priority: classification.recommended_priority,
    recommended_team: michaelResult.recommended_team,
    recommended_agent: michaelResult.recommended_agent,
    security_flag: classification.security_flag,
    security_notes: classification.security_notes,
    findings: {
      ryan_howard: {
        agent_name: "ryan_howard",
        summary: `Classified as ${classification.classification.type}/${classification.classification.subtype} with ${classification.urgency_score}/5 urgency`,
        data: classification as unknown as Record<string, unknown>,
        confidence: classification.classification.confidence,
      },
    },
    suggested_response: michaelResult.suggested_response,
    internal_notes: michaelResult.internal_notes,
    processing_time_ms: processingTime,
    model_tokens_used: {
      manager: response.usage.input_tokens + response.usage.output_tokens,
      workers: { ryan_howard: 0 },
    },
  };
}
