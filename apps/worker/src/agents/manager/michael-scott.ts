import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticket, AgentFinding } from "@triageit/shared";
import type { TriageContext, TriageOutput } from "../types.js";
import { classifyTicket } from "../workers/ryan-howard.js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";
import {
  createAgent,
  getAgentsForClassification,
} from "../registry.js";
// AgentResult used internally by specialist agents via registry

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Michael Scott, the Regional Manager of Dunder Mifflin IT Triage.

You have received the classification from Ryan Howard AND specialist findings from your team of agents. Your job is to:

1. Review Ryan's classification and all specialist findings
2. Synthesize EVERYTHING into comprehensive, actionable technician notes
3. Identify the root cause hypothesis based on all evidence
4. Provide specific troubleshooting steps the tech should follow
5. Flag anything the tech needs to know before touching this ticket
6. Suggest which team should handle this and why

Think deeply. The technician depends on your analysis to work efficiently.

## Output Format
Respond with ONLY valid JSON, no markdown:
{
  "recommended_team": "<team name: Network, Security, Endpoint, Cloud, Identity, Email, Application, General>",
  "recommended_agent": "<specific technician if known, null otherwise>",
  "root_cause_hypothesis": "<your best guess at what is causing this issue and why>",
  "internal_notes": "<comprehensive internal notes: include root cause analysis, all evidence from specialists, step-by-step troubleshooting plan, what to check first, what tools to use, and any gotchas>",
  "suggested_response": "<brief client-facing acknowledgment, null if not needed>",
  "adjustments": "<any adjustments to Ryan's classification, null if none>",
  "escalation_needed": <true/false>,
  "escalation_reason": "<why escalation is needed, null if not>"
}`;

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

async function logThinking(
  supabase: SupabaseClient,
  ticketId: string,
  agentName: string,
  agentRole: string,
  thought: string,
): Promise<void> {
  await supabase.from("agent_logs").insert({
    ticket_id: ticketId,
    agent_name: agentName,
    agent_role: agentRole,
    status: "thinking",
    output_summary: thought,
  });
}

// ── Agent name to display label ──────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  dwight_schrute: "Dwight Schrute (Documentation)",
  jim_halpert: "Jim Halpert (Identity)",
  andy_bernard: "Andy Bernard (Endpoint/RMM)",
  stanley_hudson: "Stanley Hudson (Cloud)",
  phyllis_vance: "Phyllis Vance (Email/DNS)",
  angela_martin: "Angela Martin (Security)",
};

// ── Main Triage Pipeline ─────────────────────────────────────────────

export async function runTriage(
  ticket: Ticket,
  supabase: SupabaseClient,
): Promise<TriageOutput> {
  const startTime = Date.now();
  const context = buildTriageContext(ticket);

  // ── Step 1: Michael starts ─────────────────────────────────────────

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "started",
    input_summary: `Triaging ticket #${ticket.halo_id}: ${ticket.summary}`,
  });

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `Received ticket #${ticket.halo_id} from ${ticket.client_name ?? "unknown client"}. Starting triage — sending to Ryan Howard for classification first.`,
  );

  // ── Step 2: Ryan classifies ────────────────────────────────────────

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

  // ── Step 3: Michael analyzes classification & picks specialists ────

  const classType = classification.classification.type;
  const specialistNames = getAgentsForClassification(classType);

  // Always include Angela Martin for security assessment
  const allSpecialists = classification.security_flag
    ? [...new Set([...specialistNames, "angela_martin"])]
    : specialistNames;

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `Ryan classified as ${classType}/${classification.classification.subtype} (${(classification.classification.confidence * 100).toFixed(0)}% confidence), urgency ${classification.urgency_score}/5. ${classification.security_flag ? "⚠ SECURITY FLAG raised — deploying Angela Martin for security assessment." : ""} Deploying specialist agents: ${allSpecialists.map((n) => AGENT_LABELS[n] ?? n).join(", ")}.`,
  );

  // ── Step 4: Run specialist agents in parallel ──────────────────────

  const findings: Record<string, AgentFinding> = {
    ryan_howard: {
      agent_name: "ryan_howard",
      summary: `Classified as ${classification.classification.type}/${classification.classification.subtype} with ${classification.urgency_score}/5 urgency`,
      data: classification as unknown as Record<string, unknown>,
      confidence: classification.classification.confidence,
    },
  };

  const workerTokens: Record<string, number> = { ryan_howard: 0 };

  const specialistResults = await Promise.allSettled(
    allSpecialists.map(async (agentName) => {
      const agent = createAgent(agentName, supabase);
      if (!agent) {
        await supabase.from("agent_logs").insert({
          ticket_id: ticket.id,
          agent_name: agentName,
          agent_role: "worker",
          status: "skipped",
          output_summary: "Agent implementation not available",
        });
        return { agentName, result: null };
      }

      try {
        const result = await agent.execute(context);
        return { agentName, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[MICHAEL] Specialist ${agentName} failed:`, message);
        return { agentName, result: null };
      }
    }),
  );

  // Collect all specialist findings
  for (const settled of specialistResults) {
    if (settled.status === "fulfilled" && settled.value.result) {
      const { agentName, result } = settled.value;
      findings[agentName] = {
        agent_name: agentName,
        summary: result.summary,
        data: result.data,
        confidence: result.confidence,
      };
      workerTokens[agentName] = 0; // Token tracking per agent TBD
    }
  }

  const successfulSpecialists = Object.keys(findings).filter(
    (k) => k !== "ryan_howard",
  );

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `${successfulSpecialists.length} specialist agents completed: ${successfulSpecialists.map((n) => AGENT_LABELS[n] ?? n).join(", ")}. Now synthesizing all findings into final triage decision.`,
  );

  // ── Step 5: Michael synthesizes ALL findings ───────────────────────

  const client = new Anthropic();

  const specialistSections = Object.entries(findings)
    .map(([name, finding]) => {
      const label = AGENT_LABELS[name] ?? name;
      return [
        `## ${label}'s Findings`,
        `**Summary:** ${finding.summary}`,
        `**Confidence:** ${(finding.confidence * 100).toFixed(0)}%`,
        `**Data:** ${JSON.stringify(finding.data, null, 2)}`,
      ].join("\n");
    })
    .join("\n\n");

  const michaelMessage = [
    `## Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Description:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
    context.userName ? `**Reported By:** ${context.userName}` : "",
    context.originalPriority
      ? `**Original Priority:** P${context.originalPriority}`
      : "",
    "",
    "## Ryan Howard's Classification",
    `**Type:** ${classification.classification.type} / ${classification.classification.subtype}`,
    `**Confidence:** ${(classification.classification.confidence * 100).toFixed(0)}%`,
    `**Urgency Score:** ${classification.urgency_score}/5`,
    `**Urgency Reasoning:** ${classification.urgency_reasoning}`,
    `**Recommended Priority:** P${classification.recommended_priority}`,
    `**Entities Found:** ${classification.entities.join(", ") || "None"}`,
    classification.security_flag
      ? `**⚠ SECURITY FLAG:** ${classification.security_notes}`
      : "",
    "",
    specialistSections,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: michaelMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const michaelResult = parseLlmJson<{
    recommended_team: string;
    recommended_agent: string | null;
    root_cause_hypothesis: string;
    internal_notes: string;
    suggested_response: string | null;
    adjustments: string | null;
    escalation_needed: boolean;
    escalation_reason: string | null;
  }>(text);

  const processingTime = Date.now() - startTime;

  // ── Step 6: Write comprehensive note to Halo ───────────────────────

  const haloConfig = await getHaloConfig(supabase);
  if (haloConfig) {
    const halo = new HaloClient(haloConfig);
    try {
      const internalNote = buildHaloNote(
        classification,
        michaelResult,
        findings,
        processingTime,
      );
      await halo.addInternalNote(ticket.halo_id, internalNote);
    } catch (error) {
      console.error(
        `[MICHAEL] Failed to write back to Halo for ticket #${ticket.halo_id}:`,
        error,
      );
    }
  }

  // ── Step 7: Final thinking + completed log ─────────────────────────

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `Triage complete. Root cause hypothesis: ${michaelResult.root_cause_hypothesis}. Routing to ${michaelResult.recommended_team} team.${michaelResult.escalation_needed ? ` ⚠ ESCALATION NEEDED: ${michaelResult.escalation_reason}` : ""}`,
  );

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "completed",
    output_summary: `Team: ${michaelResult.recommended_team}, Priority: P${classification.recommended_priority}, Agents used: ${Object.keys(findings).length}`,
    duration_ms: processingTime,
  });

  // ── Return triage output ───────────────────────────────────────────

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
    findings,
    suggested_response: michaelResult.suggested_response,
    internal_notes: michaelResult.internal_notes,
    processing_time_ms: processingTime,
    model_tokens_used: {
      manager: response.usage.input_tokens + response.usage.output_tokens,
      workers: workerTokens,
    },
  };
}

// ── Halo Note Builder ────────────────────────────────────────────────

function buildHaloNote(
  classification: {
    classification: { type: string; subtype: string; confidence: number };
    urgency_score: number;
    urgency_reasoning: string;
    recommended_priority: number;
    security_flag: boolean;
    security_notes: string | null;
    entities: ReadonlyArray<string>;
  },
  michaelResult: {
    recommended_team: string;
    root_cause_hypothesis: string;
    internal_notes: string;
    escalation_needed: boolean;
    escalation_reason: string | null;
  },
  findings: Record<string, AgentFinding>,
  processingTime: number,
): string {
  const securityRow = classification.security_flag
    ? `<tr><td style="padding:4px 8px;font-weight:bold;color:#ef4444;border-bottom:1px solid #e2e8f0;font-size:11px;">⚠ Security</td><td style="padding:4px 8px;color:#ef4444;border-bottom:1px solid #e2e8f0;font-size:11px;">${classification.security_notes}</td></tr>`
    : "";

  const escalationRow = michaelResult.escalation_needed
    ? `<tr><td style="padding:4px 8px;font-weight:bold;color:#f59e0b;border-bottom:1px solid #e2e8f0;font-size:11px;">⬆ Escalation</td><td style="padding:4px 8px;color:#f59e0b;border-bottom:1px solid #e2e8f0;font-size:11px;">${michaelResult.escalation_reason}</td></tr>`
    : "";

  const entitiesRow =
    classification.entities.length > 0
      ? `<tr style="background:#f8fafc;"><td style="padding:4px 8px;font-weight:600;border-bottom:1px solid #e2e8f0;font-size:11px;">Entities</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;">${classification.entities.join(", ")}</td></tr>`
      : "";

  // Build specialist findings sections
  const specialistHtml = Object.entries(findings)
    .filter(([name]) => name !== "ryan_howard")
    .map(([name, finding]) => {
      const label = AGENT_LABELS[name] ?? name;
      return `<div style="background:#f8fafc;border-left:2px solid #94a3b8;padding:4px 8px;margin-bottom:4px;border-radius:0 3px 3px 0;">
  <div style="font-weight:600;font-size:10px;color:#475569;margin-bottom:1px;">${label}</div>
  <div style="color:#334155;font-size:10px;line-height:1.4;">${finding.summary}</div>
</div>`;
    })
    .join("\n");

  const agentCount = Object.keys(findings).length;

  return `<div style="font-family:'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;font-size:11px;line-height:1.4;color:#334155;">
<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
  <tr style="background:#1e293b;">
    <td colspan="2" style="padding:6px 10px;color:#f8fafc;font-size:12px;font-weight:600;border-radius:4px 4px 0 0;">
      🤖 AI Triage — TriageIt <span style="font-weight:400;font-size:10px;opacity:0.6;">(${agentCount} agents · ${processingTime}ms)</span>
    </td>
  </tr>
  <tr style="background:#f8fafc;">
    <td style="padding:4px 8px;font-weight:600;width:140px;border-bottom:1px solid #e2e8f0;font-size:11px;">Classification</td>
    <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;">${classification.classification.type}/${classification.classification.subtype} <span style="color:#94a3b8;font-size:10px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td>
  </tr>
  <tr>
    <td style="padding:4px 8px;font-weight:600;border-bottom:1px solid #e2e8f0;font-size:11px;">Urgency</td>
    <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;">${classification.urgency_score}/5 — ${classification.urgency_reasoning}</td>
  </tr>
  <tr style="background:#f8fafc;">
    <td style="padding:4px 8px;font-weight:600;border-bottom:1px solid #e2e8f0;font-size:11px;">Priority</td>
    <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;"><strong>P${classification.recommended_priority}</strong> → ${michaelResult.recommended_team}</td>
  </tr>
  ${entitiesRow}
  ${securityRow}
  ${escalationRow}
</table>

<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:6px 10px;border-radius:0 4px 4px 0;margin-bottom:8px;">
  <div style="font-weight:600;margin-bottom:2px;color:#92400e;font-size:11px;">🔍 Root Cause</div>
  <div style="color:#78350f;font-size:11px;line-height:1.4;">${michaelResult.root_cause_hypothesis}</div>
</div>

<div style="background:#f0f9ff;border-left:3px solid #3b82f6;padding:6px 10px;border-radius:0 4px 4px 0;margin-bottom:8px;">
  <div style="font-weight:600;margin-bottom:2px;color:#1e40af;font-size:11px;">📋 Tech Notes</div>
  <div style="color:#334155;font-size:11px;line-height:1.5;">${michaelResult.internal_notes}</div>
</div>

${specialistHtml ? `<div style="margin-bottom:8px;"><div style="font-weight:600;font-size:11px;color:#475569;margin-bottom:4px;">🔬 Specialist Findings</div>${specialistHtml}</div>` : ""}

<div style="color:#94a3b8;font-size:9px;text-align:right;border-top:1px solid #e2e8f0;padding-top:4px;">TriageIt AI · ${agentCount} agents</div>
</div>`;
}
