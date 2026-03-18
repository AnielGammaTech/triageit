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
  meredith_palmer: "Meredith Palmer (Backup/Recovery)",
  kelly_kapoor: "Kelly Kapoor (VoIP/Telephony)",
};

// ── Main Triage Pipeline ─────────────────────────────────────────────

export async function runTriage(
  ticket: Ticket,
  supabase: SupabaseClient,
): Promise<TriageOutput> {
  const startTime = Date.now();
  let context = buildTriageContext(ticket);

  // ── Pre-step: Fetch Halo ticket actions (history/comments) ─────────

  const haloConfigEarly = await getHaloConfig(supabase);
  if (haloConfigEarly) {
    try {
      const haloEarly = new HaloClient(haloConfigEarly);
      const rawActions = await haloEarly.getTicketActions(ticket.halo_id);
      const formattedActions = rawActions.map((a) => ({
        note: stripHtmlActions(a.note),
        who: a.who ?? null,
        outcome: a.outcome ?? null,
        date: a.datecreated ?? null,
      }));
      context = { ...context, actions: formattedActions };
      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Fetched ${formattedActions.length} action(s)/comment(s) from Halo for ticket #${ticket.halo_id}. These will be included in the triage context.`,
      );
    } catch (err) {
      console.warn(`[MICHAEL] Could not fetch Halo actions for ticket #${ticket.halo_id}:`, err);
    }
  }

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
    ...(context.actions && context.actions.length > 0
      ? [
          "## Ticket History / Comments",
          ...context.actions.map((a) => {
            const who = a.who ?? "Unknown";
            const when = a.date ?? "unknown date";
            const outcome = a.outcome ? ` [${a.outcome}]` : "";
            return `- **${who}** (${when})${outcome}: ${a.note}`;
          }),
          "",
        ]
      : []),
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

// ── HTML Strip (for Halo action notes) ───────────────────────────────

function stripHtmlActions(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
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
  const agentCount = Object.keys(findings).length;
  const td1 = 'style="padding:4px 8px;font-weight:600;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;white-space:nowrap;color:#64748b;"';
  const td2 = 'style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#1e293b;line-height:1.4;word-break:break-word;"';

  const rows: string[] = [];

  // Header
  rows.push(`<tr style="background:#1e293b;"><td colspan="2" style="padding:6px 8px;color:white;font-size:11px;font-weight:600;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:9px;opacity:0.7;">${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // Classification
  rows.push(`<tr style="background:#f8fafc;"><td ${td1}>Classification</td><td ${td2}>${classification.classification.type} / ${classification.classification.subtype} <span style="color:#94a3b8;font-size:9px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td></tr>`);

  // Urgency — score on its own, reasoning on next line
  rows.push(`<tr><td ${td1}>Urgency</td><td ${td2}><strong>${classification.urgency_score}/5</strong></td></tr>`);
  if (classification.urgency_reasoning) {
    rows.push(`<tr style="background:#f8fafc;"><td ${td1} style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:9px;color:#94a3b8;width:110px;vertical-align:top;"></td><td style="padding:2px 8px 4px;border-bottom:1px solid #e5e7eb;font-size:9px;color:#64748b;line-height:1.3;word-break:break-word;">${classification.urgency_reasoning}</td></tr>`);
  }

  // Priority + Team
  rows.push(`<tr><td ${td1}>Priority</td><td ${td2}><strong>P${classification.recommended_priority}</strong> → ${michaelResult.recommended_team}</td></tr>`);

  // Entities
  if (classification.entities.length > 0) {
    rows.push(`<tr style="background:#f8fafc;"><td ${td1}>Entities</td><td ${td2}>${classification.entities.join(", ")}</td></tr>`);
  }

  // Security
  if (classification.security_flag) {
    rows.push(`<tr><td style="padding:4px 8px;font-weight:700;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;color:#dc2626;">⚠ Security</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#dc2626;line-height:1.4;word-break:break-word;">${classification.security_notes}</td></tr>`);
  }

  // Escalation
  if (michaelResult.escalation_needed) {
    rows.push(`<tr><td style="padding:4px 8px;font-weight:700;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;color:#d97706;">⬆ Escalation</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#d97706;line-height:1.4;word-break:break-word;">${michaelResult.escalation_reason}</td></tr>`);
  }

  // Root Cause — highlighted section
  rows.push(`<tr style="background:#fefce8;"><td style="padding:4px 8px;font-weight:600;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;color:#854d0e;">🔍 Root Cause</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#713f12;line-height:1.4;word-break:break-word;">${michaelResult.root_cause_hypothesis}</td></tr>`);

  // Tech Notes — highlighted section
  rows.push(`<tr style="background:#eff6ff;"><td style="padding:4px 8px;font-weight:600;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;color:#1d4ed8;">📋 Tech Notes</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#1e293b;line-height:1.4;word-break:break-word;">${michaelResult.internal_notes}</td></tr>`);

  // Specialist findings
  const specialists = Object.entries(findings).filter(([name]) => name !== "ryan_howard");
  if (specialists.length > 0) {
    rows.push(`<tr style="background:#f1f5f9;"><td colspan="2" style="padding:4px 8px;font-size:9px;font-weight:600;color:#64748b;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:0.5px;">Specialist Findings</td></tr>`);
    for (const [name, finding] of specialists) {
      const label = AGENT_LABELS[name] ?? name;
      rows.push(`<tr><td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;font-size:9px;font-weight:600;color:#64748b;width:110px;vertical-align:top;">${label}</td><td style="padding:3px 8px;border-bottom:1px solid #f1f5f9;font-size:9px;color:#475569;line-height:1.3;word-break:break-word;">${finding.summary}</td></tr>`);
    }
  }

  // Quick Links — Hudu links and credentials from Dwight
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  if (huduLinks.length > 0 || relevantPasswords.length > 0) {
    const td1ql = 'style="padding:4px 8px;font-weight:600;width:110px;border-bottom:1px solid #e5e7eb;font-size:10px;vertical-align:top;white-space:nowrap;color:#15803d;"';
    const td2ql = 'style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#1e293b;line-height:1.6;word-break:break-word;"';
    const linkItems = huduLinks
      .map((l) => `<a href="${l.url}" style="color:#2563eb;text-decoration:none;">${l.label}</a>`)
      .join(" · ");
    const pwItems = relevantPasswords.map((p) => p.name).join(", ");
    const content = [
      linkItems,
      pwItems ? `<br/><span style="color:#64748b;font-size:9px;">Credentials: ${pwItems}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    rows.push(`<tr style="background:#f0fdf4;"><td ${td1ql}>📎 Quick Links</td><td ${td2ql}>${content}</td></tr>`);
  }

  // Footer
  rows.push(`<tr><td colspan="2" style="padding:3px 8px;color:#94a3b8;font-size:8px;text-align:right;">TriageIt AI · ${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</td></tr>`);

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:620px;border-collapse:collapse;font-size:10px;color:#334155;margin:0;padding:0;border:1px solid #e5e7eb;">${rows.join("")}</table>`;
}
