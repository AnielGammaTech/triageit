import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticket } from "@triageit/shared";
import type { TriageContext, TriageOutput } from "../types.js";
import { classifyTicket } from "../workers/ryan-howard.js";
import { diagnoseEmail } from "../workers/phyllis-vance.js";
import type { EmailDiagnosticsResult } from "../workers/phyllis-vance.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";

const SYSTEM_PROMPT = `You are Michael Scott, the Regional Manager of Dunder Mifflin IT Triage.

You have just received the classification results from your team for a support ticket. Your job is to:

1. Review Ryan Howard's classification and adjust if needed
2. If Phyllis Vance (Email & DNS Specialist) provided findings, incorporate her diagnostics — she understands Mimecast, MX records, SPF/DKIM/DMARC, email gateways, and bounce reasons deeply
3. Synthesize ALL agent findings into clear, actionable internal notes for the technician
4. Suggest which team should handle this ticket
5. Write a brief internal summary that includes specific next steps

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

  // Fast path: skip expensive Sonnet call for simple notifications
  const isNotification =
    classification.classification.subtype?.toLowerCase().includes("notification") ||
    classification.classification.subtype?.toLowerCase().includes("alert") ||
    classification.classification.subtype?.toLowerCase().includes("auto-replenish") ||
    classification.classification.subtype?.toLowerCase().includes("informational");

  if (
    isNotification &&
    classification.urgency_score <= 1 &&
    !classification.security_flag
  ) {
    const processingTime = Date.now() - startTime;

    await supabase.from("agent_logs").insert({
      ticket_id: ticket.id,
      agent_name: "michael_scott",
      agent_role: "manager",
      status: "completed",
      output_summary: `Fast path — notification. Team: General, Priority: P${classification.recommended_priority}`,
      duration_ms: processingTime,
    });

    const defaultNotes = `This is an informational notification, not a support request. Classification: ${classification.classification.type}/${classification.classification.subtype}. No technical action required.`;

    // Write to Halo if configured
    const haloConfig = await getHaloConfig(supabase);
    if (haloConfig) {
      const halo = new HaloClient(haloConfig);
      try {
        const processingSeconds = (processingTime / 1000).toFixed(1);
        const confidencePct = (classification.classification.confidence * 100).toFixed(0);

        const internalNote = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;background:#1E2028;border-radius:8px;overflow:hidden;border:1px solid #2A2D35;">
  <div style="background:linear-gradient(135deg,#2C3E6B,#1A2744);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:15px;font-weight:700;color:#FFFFFF;letter-spacing:0.3px;">TriageIt</span>
    <span style="font-size:12px;color:#8899BB;">1 agent &middot; ${processingSeconds}s</span>
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;width:140px;">Classification</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${classification.classification.type} / ${classification.classification.subtype} <span style="color:#546E7A;font-size:12px;">(${confidencePct}%)</span></td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Urgency</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${classification.urgency_score}/5 — ${classification.urgency_reasoning}</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Priority</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">P${classification.recommended_priority} — General</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;">Entities</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;">${classification.entities.join(", ") || "None detected"}</td>
    </tr>
  </table>
  <div style="padding:14px 18px;">
    <p style="margin:0;font-size:14px;color:#90A4AE;line-height:1.6;background:#252830;padding:10px 14px;border-radius:6px;border-left:3px solid #546E7A;">Notification only — no technical action required.</p>
  </div>
  <div style="padding:10px 18px;background:#1A1C22;text-align:right;">
    <span style="font-size:11px;color:#546E7A;">TriageIt AI &middot; 1 agent &middot; ${processingSeconds}s</span>
  </div>
</div>`;

        await halo.addInternalNote(ticket.halo_id, internalNote);
      } catch (error) {
        console.error(
          `[MICHAEL] Failed to write fast-path note to Halo for ticket #${ticket.halo_id}:`,
          error,
        );
      }
    }

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
          summary: `Classified as ${classification.classification.type}/${classification.classification.subtype} with ${classification.urgency_score}/5 urgency`,
          data: classification as unknown as Record<string, unknown>,
          confidence: classification.classification.confidence,
        },
      },
      suggested_response: null,
      internal_notes: defaultNotes,
      processing_time_ms: processingTime,
      model_tokens_used: {
        manager: 0,
        workers: { ryan_howard: 0 },
      },
    };
  }

  // Step 2: If email-related, call Phyllis Vance for diagnostics
  let phyllisResult: EmailDiagnosticsResult | null = null;
  const isEmailTicket =
    classification.classification.type === "email" ||
    classification.classification.subtype
      ?.toLowerCase()
      .includes("email") ||
    classification.classification.subtype
      ?.toLowerCase()
      .includes("dns");

  if (isEmailTicket) {
    await supabase.from("agent_logs").insert({
      ticket_id: ticket.id,
      agent_name: "phyllis_vance",
      agent_role: "dns_email",
      status: "started",
      input_summary: `Email diagnostics for ticket #${ticket.halo_id}`,
    });

    const phyllisStart = Date.now();
    try {
      phyllisResult = await diagnoseEmail(context, supabase);
      const phyllisDuration = Date.now() - phyllisStart;

      await supabase.from("agent_logs").insert({
        ticket_id: ticket.id,
        agent_name: "phyllis_vance",
        agent_role: "dns_email",
        status: "completed",
        output_summary: `Severity: ${phyllisResult.severity}, Domain: ${phyllisResult.domain_analyzed ?? "N/A"}, Root cause: ${phyllisResult.root_cause ?? "undetermined"}`,
        duration_ms: phyllisDuration,
      });
    } catch (err) {
      const phyllisDuration = Date.now() - phyllisStart;
      console.error(
        `[MICHAEL] Phyllis Vance failed for ticket #${ticket.halo_id}:`,
        err,
      );
      await supabase.from("agent_logs").insert({
        ticket_id: ticket.id,
        agent_name: "phyllis_vance",
        agent_role: "dns_email",
        status: "error",
        error_message:
          err instanceof Error ? err.message : String(err),
        duration_ms: phyllisDuration,
      });
    }
  }

  // Step 3: Michael synthesizes and makes final decisions
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
    ...(phyllisResult
      ? [
          "",
          "## Phyllis Vance's Email & DNS Diagnostics",
          `**Severity:** ${phyllisResult.severity}`,
          `**Domain Analyzed:** ${phyllisResult.domain_analyzed ?? "N/A"}`,
          `**Diagnosis:** ${phyllisResult.summary}`,
          `**Root Cause:** ${phyllisResult.root_cause ?? "Undetermined"}`,
          `**Findings:**`,
          ...phyllisResult.findings.map((f) => `- ${f}`),
          `**Recommended Actions:**`,
          ...phyllisResult.recommended_actions.map((a) => `- ${a}`),
          `**Confidence:** ${(phyllisResult.confidence * 100).toFixed(0)}%`,
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: michaelMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const michaelResult = JSON.parse(text) as {
    recommended_team: string;
    recommended_agent: string | null;
    internal_notes: string;
    suggested_response: string | null;
    adjustments: string | null;
  };

  const processingTime = Date.now() - startTime;

  // Step 4: Write back to Halo if configured
  const haloConfig = await getHaloConfig(supabase);
  if (haloConfig) {
    const halo = new HaloClient(haloConfig);
    try {
      const agentCount = phyllisResult ? 2 : 1;
      const processingSeconds = (processingTime / 1000).toFixed(1);
      const confidencePct = (classification.classification.confidence * 100).toFixed(0);

      const priorityMap: Record<number, string> = {
        1: "P1 — Critical",
        2: "P2 — High",
        3: "P3 — Medium",
        4: "P4 — Low",
        5: "P5 — Minimal",
      };
      const priorityLabel = priorityMap[classification.recommended_priority] ?? `P${classification.recommended_priority}`;

      // Parse tech notes into separate numbered points
      const techNoteLines = michaelResult.internal_notes
        .split(/(?:\d+\)\s*|\d+\.\s*|(?:^|\n)[-•]\s*)/)
        .map((s) => s.trim())
        .filter(Boolean);

      const techNotesHtml = techNoteLines.length > 1
        ? `<ol style="margin:0;padding-left:20px;font-size:14px;color:#E0E0E0;line-height:1.7;">${techNoteLines.map((t) => `<li style="margin-bottom:8px;">${t}</li>`).join("")}</ol>`
        : `<p style="margin:0;font-size:14px;color:#E0E0E0;line-height:1.7;">${michaelResult.internal_notes}</p>`;

      // Build specialist findings rows
      const specialistRows: string[] = [];

      // Ryan Howard (always present)
      specialistRows.push(`
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#90CAF9;font-weight:600;border-bottom:1px solid #2A2D35;white-space:nowrap;vertical-align:top;">Ryan Howard<br><span style="font-weight:400;color:#78909C;font-size:11px;">(Classification)</span></td>
          <td style="padding:10px 14px;font-size:13px;color:#B0B8C1;border-bottom:1px solid #2A2D35;line-height:1.6;">Classified as <strong>${classification.classification.type}/${classification.classification.subtype}</strong> with ${confidencePct}% confidence. Urgency ${classification.urgency_score}/5.</td>
        </tr>`);

      // Phyllis Vance (if present)
      if (phyllisResult) {
        specialistRows.push(`
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#CE93D8;font-weight:600;border-bottom:1px solid #2A2D35;white-space:nowrap;vertical-align:top;">Phyllis Vance<br><span style="font-weight:400;color:#78909C;font-size:11px;">(Email & DNS)</span></td>
          <td style="padding:10px 14px;font-size:13px;color:#B0B8C1;border-bottom:1px solid #2A2D35;line-height:1.6;">${phyllisResult.summary}${phyllisResult.domain_analyzed ? ` Domain: <strong>${phyllisResult.domain_analyzed}</strong>.` : ""}${phyllisResult.root_cause ? ` Root cause: ${phyllisResult.root_cause}.` : ""}</td>
        </tr>`);
      }

      const securityHtml = classification.security_flag
        ? `<tr>
            <td style="padding:10px 14px;font-size:14px;color:#EF5350;font-weight:600;vertical-align:top;">Security Alert</td>
            <td style="padding:10px 14px;font-size:14px;color:#EF9A9A;background:#3E1A1A;border-radius:4px;">${classification.security_notes}</td>
          </tr>`
        : "";

      const rootCauseText = phyllisResult?.root_cause ?? michaelResult.internal_notes.split(".")[0] + ".";

      const internalNote = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;background:#1E2028;border-radius:8px;overflow:hidden;border:1px solid #2A2D35;">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#2C3E6B,#1A2744);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:15px;font-weight:700;color:#FFFFFF;letter-spacing:0.3px;">TriageIt</span>
    <span style="font-size:12px;color:#8899BB;">${agentCount} agent${agentCount > 1 ? "s" : ""} &middot; ${processingSeconds}s</span>
  </div>

  <!-- Main fields -->
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;width:140px;vertical-align:top;">Classification</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${classification.classification.type} / ${classification.classification.subtype} <span style="color:#546E7A;font-size:12px;">(${confidencePct}%)</span></td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;vertical-align:top;">Urgency</td>
      <td style="padding:12px 14px;border-bottom:1px solid #2A2D35;">
        <span style="font-size:14px;font-weight:600;color:#E0E0E0;">${classification.urgency_score}/5</span>
        <p style="margin:6px 0 0;font-size:13px;color:#90A4AE;line-height:1.5;">${classification.urgency_reasoning}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Priority</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${priorityLabel} &rarr; ${michaelResult.recommended_team}</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Entities</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${classification.entities.join(", ") || "None detected"}</td>
    </tr>
    ${securityHtml}
  </table>

  <!-- Root Cause -->
  <div style="padding:14px 18px;border-bottom:1px solid #2A2D35;">
    <div style="font-size:13px;color:#FFB74D;font-weight:600;margin-bottom:8px;">Root Cause</div>
    <p style="margin:0;font-size:14px;color:#E0E0E0;line-height:1.6;background:#252830;padding:10px 14px;border-radius:6px;border-left:3px solid #FFB74D;">${rootCauseText}</p>
  </div>

  <!-- Tech Notes -->
  <div style="padding:14px 18px;border-bottom:1px solid #2A2D35;">
    <div style="font-size:13px;color:#4FC3F7;font-weight:600;margin-bottom:10px;">Tech Notes</div>
    <div style="background:#252830;padding:12px 14px;border-radius:6px;">
      ${techNotesHtml}
    </div>
  </div>

  <!-- Specialist Findings -->
  <div style="padding:14px 18px;">
    <div style="font-size:12px;color:#78909C;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Specialist Findings</div>
    <table style="width:100%;border-collapse:collapse;background:#252830;border-radius:6px;overflow:hidden;">
      ${specialistRows.join("")}
    </table>
  </div>

  <!-- Footer -->
  <div style="padding:10px 18px;background:#1A1C22;text-align:right;">
    <span style="font-size:11px;color:#546E7A;">TriageIt AI &middot; ${agentCount} agent${agentCount > 1 ? "s" : ""} &middot; ${processingSeconds}s</span>
  </div>
</div>`;

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
      ...(phyllisResult
        ? {
            phyllis_vance: {
              agent_name: "phyllis_vance",
              summary: phyllisResult.summary,
              data: {
                domain_analyzed: phyllisResult.domain_analyzed,
                findings: phyllisResult.findings,
                root_cause: phyllisResult.root_cause,
                recommended_actions: phyllisResult.recommended_actions,
                severity: phyllisResult.severity,
              } as Record<string, unknown>,
              confidence: phyllisResult.confidence,
            },
          }
        : {}),
    },
    suggested_response: michaelResult.suggested_response,
    internal_notes: michaelResult.internal_notes,
    processing_time_ms: processingTime,
    model_tokens_used: {
      manager: response.usage.input_tokens + response.usage.output_tokens,
      workers: { ryan_howard: 0, ...(phyllisResult ? { phyllis_vance: 0 } : {}) },
    },
  };
}
