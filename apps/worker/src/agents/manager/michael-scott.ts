import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticket, AgentFinding } from "@triageit/shared";
import type { TriageContext, TriageOutput } from "../types.js";
import { classifyTicket } from "../workers/ryan-howard.js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient } from "../../integrations/halo/client.js";
import type { HaloConfig, TeamsConfig } from "@triageit/shared";
import { TeamsClient } from "../../integrations/teams/client.js";
import {
  createAgent,
  getAgentsForClassification,
} from "../registry.js";
import {
  isAlertTicket,
  summarizeAlert,
} from "../workers/erin-hannon.js";
import { findSimilarTickets, storeTicketEmbedding } from "../similar-tickets.js";
import { detectDuplicates } from "../duplicate-detector.js";
import { selectManagerModel } from "../model-router.js";
import { generateCustomerResponse } from "../workers/pam-beesly.js";
import type { SimilarTicket } from "../similar-tickets.js";
import type { DuplicateCandidate } from "../duplicate-detector.js";
// AgentResult used internally by specialist agents via registry

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Michael Scott, the Regional Manager of Dunder Mifflin IT Triage.

You have received the classification from Ryan Howard AND specialist findings from your team of agents. Your job is to:

1. Review Ryan's classification and all specialist findings
2. Synthesize EVERYTHING into comprehensive, actionable technician notes
3. Identify the root cause hypothesis based on all evidence
4. Provide specific, concrete troubleshooting steps the tech should follow
5. Flag anything the tech needs to know before touching this ticket
6. Suggest which team should handle this and why

Think deeply. The technician depends on your analysis to work efficiently.

## CRITICAL: Calibrate Your Response to the ACTUAL Issue
DO NOT over-escalate routine requests. Match your response tone and urgency to the real impact:

### Routine Requests (NOT emergencies):
- Password resets, PIN requests, VM credentials, access requests → just fulfill the request
- A user asking for a VM PIN is NOT a security incident — it's a simple credential lookup
- Software install requests, printer setup, new mailbox → standard service requests
- One user can't log in → single user issue, not a company-wide breach
- A customer forwarding a suspicious email for review → informational, not an active breach

### Actual Emergencies (escalate these):
- CONFIRMED active breach with evidence of unauthorized access
- Ransomware actively encrypting files
- Complete service outage affecting multiple users
- Data exfiltration in progress

### Rule of Thumb:
- If a customer is ASKING for something (credentials, access, help), it's a REQUEST — not a threat
- If something is HAPPENING TO them (breach, outage, data loss), it may be an emergency
- When in doubt, treat it as routine. Do NOT catastrophize.

## CRITICAL: Troubleshooting Steps Must Be CONCRETE
Every step in your troubleshooting plan MUST include the actual action to take.

BAD (never do this):
- "Step 1: Check the thing"
- "Step"
- "Verify identity - Step"

GOOD (always do this):
- "1. Look up the VM PIN in Hudu under the client's assets → Cloud Servers section"
- "2. Call the user at their registered number to verify identity before sharing credentials"
- "3. Open Datto RMM → find the device → check last seen date and alert status"

If you mention a domain or email address in the ticket, include DNS/email verification steps:
- "Run SPF/DKIM/DMARC check on the domain using MX Toolbox: https://mxtoolbox.com/SuperTool.aspx?action=mx:domain.com"
- "Check WHOIS for domain expiry"

## Output Format
Respond with ONLY valid JSON, no markdown:
{
  "recommended_team": "<team name: Network, Security, Endpoint, Cloud, Identity, Email, Application, General>",
  "recommended_agent": "<specific technician if known, null otherwise>",
  "root_cause_hypothesis": "<your best guess at what is causing this issue and why>",
  "internal_notes": "<comprehensive internal notes with: root cause analysis, evidence from specialists, CONCRETE step-by-step troubleshooting plan (every step must say exactly what to do, where to go, what to click), tools to use with URLs where applicable, and any gotchas>",
  "customer_response": "<brief initial acknowledgment for the customer, or null if Pam Beesly will handle the detailed response>",
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

async function getTeamsConfig(
  supabase: SupabaseClient,
): Promise<TeamsConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  return data ? (data.config as TeamsConfig) : null;
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
  erin_hannon: "Erin Hannon (Alert Specialist)",
  oscar_martinez: "Oscar Martinez (Backup/Cove)",
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
      // Filter out TriageIt's own messages — we only care about tech and customer actions
      const filteredActions = rawActions.filter((a) => {
        const note = (a.note ?? "").toLowerCase();
        return !note.includes("triageit") && !note.includes("ai triage") && !note.includes("triagetit ai");
      });

      const formattedActions = filteredActions.map((a) => ({
        note: stripHtmlActions(a.note),
        who: a.who ?? null,
        outcome: a.outcome ?? null,
        date: a.datecreated ?? null,
        isInternal: a.hiddenfromuser,
      }));

      // Determine assigned tech: use the Halo ticket's agent info
      // Tech actions are internal notes (hiddenfromuser=true) or outcomes
      // that aren't from the customer (email_from, note_from_customer)
      const CUSTOMER_OUTCOMES = ["email_from", "note_from_customer", "customer_reply"];
      const techActionUsers = rawActions
        .filter((a) => a.who && !CUSTOMER_OUTCOMES.includes(a.outcome) && a.hiddenfromuser)
        .map((a) => a.who!);
      const assignedTechName = techActionUsers.length > 0
        ? techActionUsers[techActionUsers.length - 1]
        : null;

      // Fetch images from ticket attachments and inline images
      const [attachmentImages, inlineImages] = await Promise.all([
        haloEarly.getTicketImages(ticket.halo_id, rawActions),
        haloEarly.extractInlineImages(rawActions),
      ]);
      const allImages = [...attachmentImages, ...inlineImages].slice(0, 5);
      const imageContexts = allImages.map((img) => ({
        filename: img.filename,
        mediaType: img.mediaType,
        base64Data: img.base64Data,
        who: img.who,
      }));

      context = {
        ...context,
        actions: formattedActions,
        assignedTechName,
        images: imageContexts.length > 0 ? imageContexts : undefined,
      };
      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Fetched ${formattedActions.length} action(s)/comment(s) and ${imageContexts.length} image(s) from Halo for ticket #${ticket.halo_id}. These will be included in the triage context.`,
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

  // ── Fast path: Skip Sonnet for obvious notifications ────────────────

  const notificationKeywords = [
    "notification", "transactional", "confirmation", "receipt", "alert",
    "auto-replenish", "renewal", "invoice", "statement", "reminder",
    "processed", "completion", "delivered", "shipped",
  ];
  const subtype = classification.classification.subtype?.toLowerCase() ?? "";
  const classTypeLower = classification.classification.type?.toLowerCase() ?? "";
  const isNotification =
    notificationKeywords.some((kw) => subtype.includes(kw)) ||
    (classTypeLower === "billing" && classification.urgency_score <= 2) ||
    (classTypeLower === "other" && subtype.includes("email") && classification.urgency_score <= 2);

  if (
    isNotification &&
    classification.urgency_score <= 2 &&
    !classification.security_flag
  ) {
    const fastProcessingTime = Date.now() - startTime;

    await logThinking(
      supabase,
      ticket.id,
      "michael_scott",
      "manager",
      `Fast path: notification/transactional ticket (${classification.classification.type}/${classification.classification.subtype}, urgency ${classification.urgency_score}). Skipping Sonnet and specialists.`,
    );

    // Write a simple note to Halo
    const fastHaloConfig = await getHaloConfig(supabase);
    if (fastHaloConfig) {
      const halo = new HaloClient(fastHaloConfig);
      try {
        const fastNote = `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
          `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">fast path · ${(fastProcessingTime / 1000).toFixed(1)}s</span></td></tr>` +
          `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Classification</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;"><strong>${classification.classification.type} / ${classification.classification.subtype}</strong></td></tr>` +
          `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Result</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bbf7d0;">Notification / transactional — no action required. P${classification.recommended_priority} priority.</td></tr>` +
          `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · fast path · ${(fastProcessingTime / 1000).toFixed(1)}s</td></tr>` +
          `</table>`;
        await halo.addInternalNote(ticket.halo_id, fastNote);
      } catch (error) {
        console.error(`[MICHAEL] Fast path: Failed to write Halo note for #${ticket.halo_id}:`, error);
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
      findings: { ryan_howard: { agent_name: "ryan_howard", summary: `Notification: ${classification.classification.subtype}`, data: classification as unknown as Record<string, unknown>, confidence: classification.classification.confidence } },
      suggested_response: null,
      internal_notes: "Notification/transactional ticket — no action required.",
      processing_time_ms: fastProcessingTime,
      model_tokens_used: { manager: 0, workers: {} },
    };
  }

  // ── Alert fast path: cheap Haiku summary for automated alerts ──────

  const classType = classification.classification.type;
  const isAlert = isAlertTicket(
    ticket.summary,
    ticket.details,
    classType,
    classification.classification.subtype ?? "",
  );

  if (isAlert && !classification.security_flag) {
    const alertStart = Date.now();

    await logThinking(
      supabase,
      ticket.id,
      "michael_scott",
      "manager",
      `Alert detected (${classification.classification.type}/${classification.classification.subtype}). Routing to Erin Hannon for cheap alert summary — skipping specialist agents.`,
    );

    // Search for similar tickets in parallel with alert summary (both cheap)
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

    // Write alert summary note to Halo
    const alertHaloConfig = await getHaloConfig(supabase);
    if (alertHaloConfig) {
      const halo = new HaloClient(alertHaloConfig);
      try {
        const severityColor =
          alertResult.severity === "critical" ? "#f87171"
            : alertResult.severity === "warning" ? "#fbbf24"
            : "#4ade80";
        const severityEmoji =
          alertResult.severity === "critical" ? "🔴"
            : alertResult.severity === "warning" ? "🟡"
            : "🟢";
        const actionBadge = alertResult.actionable
          ? `<span style="background:#dc2626;color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">ACTION NEEDED</span>`
          : `<span style="background:#059669;color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">INFO ONLY</span>`;

        // Build similar tickets row for alert note
        const alertSimilarRow = alertSimilarTickets.length > 0
          ? alertSimilarTickets
              .map((t) => {
                const resolved = t.resolvedAt ? ` — <strong style="color:#4ade80;">RESOLVED</strong>` : "";
                return `<a href="#" style="color:#60a5fa;text-decoration:none;">⤴ #${t.haloId}</a> ${t.summary}${resolved} <span style="color:#64748b;font-size:11px;">(${(t.similarity * 100).toFixed(0)}% match${t.clientName ? `, ${t.clientName}` : ""})</span>`;
              })
              .join("<br/>")
          : "";

        const similarSection = alertSimilarRow
          ? `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;vertical-align:top;color:#818cf8;">🔗 Similar</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#c7d2fe;line-height:1.8;">${alertSimilarRow}<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">Check these tickets — a previous solution may apply here.</span></td></tr>`
          : "";

        const alertNote =
          `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
          `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">alert path · ${(alertProcessingTime / 1000).toFixed(1)}s</span></td></tr>` +
          `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Source</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;"><strong>${alertResult.alert_source}</strong> ${actionBadge}</td></tr>` +
          `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Alert Type</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.alert_type}</td></tr>` +
          `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Affected</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.affected_resource}</td></tr>` +
          `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:${severityColor};">${severityEmoji} Severity</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${severityColor};font-weight:700;">${alertResult.severity.toUpperCase()}</td></tr>` +
          `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#60a5fa;">📋 Action</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bfdbfe;">${alertResult.suggested_action}</td></tr>` +
          `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:130px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">What is this</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.summary}</td></tr>` +
          similarSection +
          `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · alert path · ${(alertProcessingTime / 1000).toFixed(1)}s</td></tr>` +
          `</table>`;

        await halo.addInternalNote(ticket.halo_id, alertNote);
      } catch (error) {
        console.error(`[MICHAEL] Alert path: Failed to write Halo note for #${ticket.halo_id}:`, error);
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

  // ── Step 2b: Check for duplicates and similar tickets ────────────
  let similarTickets: ReadonlyArray<SimilarTicket> = [];
  let duplicates: ReadonlyArray<DuplicateCandidate> = [];

  try {
    [similarTickets, duplicates] = await Promise.all([
      findSimilarTickets(supabase, {
        currentTicketId: ticket.id,
        summary: context.summary,
        details: context.details,
        clientName: context.clientName,
        maxResults: 3,
      }),
      detectDuplicates(supabase, {
        currentTicketId: ticket.id,
        summary: context.summary,
        details: context.details,
        clientName: context.clientName,
      }),
    ]);

    if (duplicates.length > 0) {
      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `⚠ Potential duplicate(s) detected: ${duplicates.map((d) => `#${d.haloId} (${(d.similarity * 100).toFixed(0)}% match)`).join(", ")}`,
      );
    }

    if (similarTickets.length > 0) {
      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Found ${similarTickets.length} similar past ticket(s): ${similarTickets.map((t) => `#${t.haloId} (${(t.similarity * 100).toFixed(0)}%)`).join(", ")}`,
      );
    }
  } catch (error) {
    console.warn("[MICHAEL] Similar/duplicate detection failed (non-fatal):", error);
  }

  // ── Step 3: Michael analyzes classification & picks specialists ────

  const specialistNames = await getAgentsForClassification(
    classType,
    supabase,
    ticket.client_name,
  );

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
    context.assignedTechName ? `**Assigned Tech:** ${context.assignedTechName}` : "",
    ...(context.actions && context.actions.length > 0
      ? [
          "## Ticket History / Comments",
          `_Customer: ${context.userName ?? "Unknown"} | Tech: ${context.assignedTechName ?? "Unknown"}_`,
          ...context.actions.map((a) => {
            const who = a.who ?? "Unknown";
            const when = a.date ?? "unknown date";
            const visibility = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
            return `- ${visibility} **${who}** (${when}): ${a.note}`;
          }),
          "",
        ]
      : []),
    specialistSections,
    // Similar tickets context
    ...(similarTickets.length > 0
      ? [
          "",
          "## Similar Past Tickets",
          ...similarTickets.map((t) =>
            `- **#${t.haloId}:** ${t.summary} (${(t.similarity * 100).toFixed(0)}% similar, status: ${t.status}${t.clientName ? `, client: ${t.clientName}` : ""})`
          ),
          "",
        ]
      : []),
    // Duplicate warnings
    ...(duplicates.length > 0
      ? [
          "",
          "## ⚠ POTENTIAL DUPLICATES",
          ...duplicates.map((d) =>
            `- **#${d.haloId}:** ${d.summary} (${(d.similarity * 100).toFixed(0)}% match, status: ${d.status})`
          ),
          "Consider merging these tickets if they are the same issue.",
          "",
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  // Build multi-modal content: text + images (if any)
  const messageContent: Anthropic.MessageCreateParams["messages"][0]["content"] = [
    { type: "text", text: michaelMessage },
  ];

  // Append ticket images for vision analysis
  if (context.images && context.images.length > 0) {
    for (const img of context.images) {
      messageContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64Data,
        },
      });
      messageContent.push({
        type: "text",
        text: `[Screenshot: ${img.filename}${img.who ? ` from ${img.who}` : ""}]`,
      });
    }
  }

  // Smart model routing — use Haiku for simple tickets, Sonnet for complex
  const routingDecision = selectManagerModel(classification, successfulSpecialists.length);
  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `Model routing: ${routingDecision.model.includes("haiku") ? "Haiku (efficient)" : "Sonnet (thorough)"} — ${routingDecision.reason}`,
  );

  const response = await client.messages.create({
    model: routingDecision.model,
    max_tokens: routingDecision.maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: messageContent }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const michaelResult = parseLlmJson<{
    recommended_team: string;
    recommended_agent: string | null;
    root_cause_hypothesis: string;
    internal_notes: string;
    customer_response: string | null;
    suggested_response: string | null;
    adjustments: string | null;
    escalation_needed: boolean;
    escalation_reason: string | null;
  }>(text);

  const processingTime = Date.now() - startTime;

  // ── Detect retriage vs first triage ────────────────────────────────
  const { data: existingTriages } = await supabase
    .from("triage_results")
    .select("id")
    .eq("ticket_id", ticket.id)
    .limit(1);
  const isRetriage = (existingTriages?.length ?? 0) > 0;

  // ── Step 6: Write note to Halo ─────────────────────────────────────

  const haloConfig = await getHaloConfig(supabase);
  if (haloConfig) {
    const halo = new HaloClient(haloConfig);

    // On retriage, post a compact review — not the full triage table
    if (isRetriage) {
      try {
        const compactNote = buildCompactRetrieageNote(
          classification,
          michaelResult,
          findings,
          processingTime,
        );
        await halo.addInternalNote(ticket.halo_id, compactNote);
      } catch (error) {
        console.error(
          `[MICHAEL] Failed to write retriage note for #${ticket.halo_id}:`,
          error,
        );
      }
    } else {
      // First triage — full comprehensive note
      try {
        const internalNote = buildHaloNote(
          classification,
          michaelResult,
          findings,
          processingTime,
          similarTickets,
          duplicates,
        );
        await halo.addInternalNote(ticket.halo_id, internalNote);
      } catch (error) {
        console.error(
          `[MICHAEL] Failed to write back to Halo for ticket #${ticket.halo_id}:`,
          error,
        );
      }
    }

    // ── Customer Response — Pam Beesly drafts the response ──────────
    try {
      const pamResult = await generateCustomerResponse(
        context,
        classification,
        findings,
        michaelResult,
        similarTickets,
      );

      if (pamResult.customer_response) {
        // Customer response is shown in the TriageIT embed tab — no need to
        // clutter the Halo ticket with a separate note.

        // If there are documentation gaps, post a separate note
        if (pamResult.missing_info.length > 0) {
          const gapNote = `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
            `<tr><td style="padding:8px 12px;background:linear-gradient(135deg,#d97706,#f59e0b);color:white;font-size:13px;font-weight:700;">📝 Documentation Gap — Update Hudu After Resolution</td></tr>` +
            `<tr style="background:#332b1a;"><td style="padding:10px 14px;font-size:13px;color:#fde68a;line-height:1.6;">` +
            `<strong>Missing from Hudu:</strong><ul style="margin:6px 0;padding-left:20px;">` +
            pamResult.missing_info.map((info) => `<li>${info}</li>`).join("") +
            `</ul></td></tr>` +
            `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · Pam Beesly · Documentation Gap Alert</td></tr>` +
            `</table>`;
          await halo.addInternalNote(ticket.halo_id, gapNote);
        }
      }

      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Pam Beesly drafted customer response (tone: ${pamResult.tone}). Docs referenced: ${pamResult.documentation_used.length}. Gaps found: ${pamResult.missing_info.length}.`,
      );
    } catch (error) {
      console.error(`[MICHAEL] Pam Beesly response generation failed for #${ticket.halo_id}:`, error);
      // Customer response (if any) is still saved to triage_results and
      // displayed in the TriageIT embed tab — just not posted as a Halo note.
    }

    // ── Auto-tag: Write classification to Halo custom field ──────────
    try {
      await halo.updateTicketCustomField(ticket.halo_id, "CFTriageClassification", `${classification.classification.type}/${classification.classification.subtype}`);
      await halo.updateTicketCustomField(ticket.halo_id, "CFTriageUrgency", String(classification.urgency_score));
    } catch (error) {
      // Custom field may not exist — not fatal
      console.warn(`[MICHAEL] Auto-tag failed for #${ticket.halo_id} (custom fields may not be configured):`, error);
    }

    // ── Priority Recommendation — RECOMMEND only, don't SET ──────────
    if (classification.recommended_priority !== ticket.original_priority && ticket.original_priority) {
      const currentP = ticket.original_priority;
      const recommendedP = classification.recommended_priority;
      const direction = recommendedP < currentP ? "⬆ Upgrade" : "⬇ Downgrade";
      const dirColor = recommendedP < currentP ? "#f59e0b" : "#4ade80";

      const priorityNote = `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:6px;overflow:hidden;">` +
        `<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:12px;font-weight:600;">${direction} Priority Recommendation</td></tr>` +
        `<tr style="background:#252830;"><td style="padding:6px 12px;width:100px;font-size:12px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Current</td><td style="padding:6px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid #3a3f4b;">P${currentP}</td></tr>` +
        `<tr style="background:#1E2028;"><td style="padding:6px 12px;width:100px;font-size:12px;color:${dirColor};font-weight:600;border-bottom:1px solid #3a3f4b;">Recommended</td><td style="padding:6px 12px;font-size:13px;color:${dirColor};font-weight:700;border-bottom:1px solid #3a3f4b;">P${recommendedP}</td></tr>` +
        `<tr style="background:#252830;"><td style="padding:6px 12px;width:100px;font-size:12px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Reason</td><td style="padding:6px 12px;font-size:12px;color:#cbd5e1;border-bottom:1px solid #3a3f4b;">${classification.urgency_reasoning}</td></tr>` +
        `<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · Priority Recommendation Only · Not Auto-Applied</td></tr>` +
        `</table>`;

      try {
        await halo.addInternalNote(ticket.halo_id, priorityNote);
      } catch (error) {
        console.error(`[MICHAEL] Failed to write priority recommendation:`, error);
      }
    }
  }

  // ── Step 7: Employee feedback — private coaching note ──────────────

  // Eligibility checks: only review tech performance when meaningful data exists
  const ticketAgeMs = Date.now() - new Date(ticket.created_at).getTime();
  const ticketAgeHours = ticketAgeMs / (1000 * 60 * 60);
  const actions = context.actions ?? [];

  // Separate customer vs tech actions for gap analysis
  const customerActions = actions.filter((a) => !a.isInternal);
  const techActions = actions.filter((a) => a.isInternal);

  // Find the longest gap between a customer reply and the next tech action
  const maxResponseGapHours = (() => {
    let maxGap = 0;
    for (const custAction of customerActions) {
      if (!custAction.date) continue;
      const custTime = new Date(custAction.date).getTime();
      // Find the earliest tech action AFTER this customer action
      const nextTech = techActions
        .filter((t) => t.date && new Date(t.date).getTime() > custTime)
        .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())[0];
      if (nextTech?.date) {
        const gapMs = new Date(nextTech.date).getTime() - custTime;
        maxGap = Math.max(maxGap, gapMs / (1000 * 60 * 60));
      } else {
        // Tech never responded after this customer action — measure gap to now
        const gapMs = Date.now() - custTime;
        maxGap = Math.max(maxGap, gapMs / (1000 * 60 * 60));
      }
    }
    return maxGap;
  })();

  const shouldReviewTech =
    haloConfig &&
    actions.length > 0 &&
    ticketAgeHours >= 1 &&                     // Ticket must be at least 1 hour old
    customerActions.length > 0 &&              // Customer must have engaged (not just initial submission)
    classification.urgency_score >= 2;          // Skip notification/billing tickets

  if (shouldReviewTech) {
    try {
      const halo = new HaloClient(haloConfig);
      const feedbackClient = new Anthropic();

      const assignedTech = context.assignedTechName ?? null;

      const feedbackPrompt = [
        `You are a senior IT service delivery manager reviewing how a TECHNICIAN handled a support ticket.`,
        ``,
        `## IMPORTANT: Identity Clarification`,
        `- **CUSTOMER (the person who submitted the ticket):** ${context.userName ?? context.clientName ?? "Unknown"}`,
        `- **CLIENT COMPANY:** ${context.clientName ?? "Unknown"}`,
        `- **ASSIGNED TECHNICIAN (the person you are reviewing):** ${assignedTech ?? "Unknown Tech"}`,
        ``,
        `You are reviewing the TECHNICIAN's performance, NOT the customer's. The customer is the one who reported the issue.`,
        `Actions marked [INTERNAL NOTE] are private tech notes not visible to the customer.`,
        `Actions marked [CUSTOMER-VISIBLE] are messages exchanged with the customer.`,
        ``,
        `## Ticket Context`,
        `- **Ticket #${context.haloId}:** ${context.summary}`,
        `- **Classification:** ${classification.classification.type} / ${classification.classification.subtype}`,
        `- **Urgency:** ${classification.urgency_score}/5`,
        `- **Ticket Age:** ${ticketAgeHours.toFixed(1)} hours`,
        `- **Customer actions:** ${customerActions.length} | **Tech actions:** ${techActions.length}`,
        `- **Longest response gap (customer → tech):** ${maxResponseGapHours.toFixed(1)} hours`,
        ``,
        `## Response Time Standards`,
        `- Gaps over 24 hours without any customer contact are UNACCEPTABLE and should be flagged.`,
        `- For high-urgency tickets (3+), gaps over 4 hours should be noted.`,
        `- Consider the ticket age when evaluating: a tech who just received the ticket hasn't had time to respond yet.`,
        ``,
        `## Full Conversation History`,
        ...actions.map((a) => {
          const who = a.who ?? "Unknown";
          const when = a.date ?? "";
          const visibility = a.isInternal ? "[INTERNAL NOTE]" : "[CUSTOMER-VISIBLE]";
          return `- ${visibility} **${who}** (${when}): ${a.note}`;
        }),
        ``,
        `## Your Task`,
        `Evaluate the TECHNICIAN (${assignedTech ?? "the assigned tech"})'s performance — NOT the customer's.`,
        `Review their communication quality, responsiveness, documentation, and technical approach.`,
        `Use the actual timestamps and response gaps to assess responsiveness — do NOT guess.`,
        `Reference the technician by name in your feedback. NEVER review or critique the customer.`,
        ``,
        `Respond with ONLY valid JSON:`,
        `{`,
        `  "rating": "<great | good | needs_improvement | poor>",`,
        `  "communication_score": "<1-5, where 5 = excellent>",`,
        `  "response_time_assessment": "<fast, adequate, slow, no_response>",`,
        `  "max_response_gap_hours": "<number, longest gap between customer msg and tech reply>",`,
        `  "strengths": "<what the TECH did well, null if nothing notable>",`,
        `  "improvement_areas": "<specific areas the TECH should improve, null if none>",`,
        `  "suggestions": ["<actionable suggestion for the TECH>"],`,
        `  "summary": "<1-2 sentence assessment of the TECH's handling>"`,
        `}`,
      ].join("\n");

      const feedbackResponse = await feedbackClient.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: feedbackPrompt }],
      });

      const feedbackText = feedbackResponse.content[0].type === "text" ? feedbackResponse.content[0].text : "";
      const feedback = parseLlmJson<{
        rating: string;
        communication_score: number;
        response_time_assessment: string;
        max_response_gap_hours: number;
        strengths: string | null;
        improvement_areas: string | null;
        suggestions: string[];
        summary: string;
      }>(feedbackText);

      // Build the private coaching note
      const ratingColor = feedback.rating === "great" ? "#4ade80" : feedback.rating === "good" ? "#60a5fa" : feedback.rating === "needs_improvement" ? "#fbbf24" : "#f87171";
      const ratingEmoji = feedback.rating === "great" ? "🌟" : feedback.rating === "good" ? "👍" : feedback.rating === "needs_improvement" ? "📋" : "⚠️";
      const commScoreBar = "█".repeat(feedback.communication_score) + "░".repeat(5 - feedback.communication_score);
      const gapWarning = maxResponseGapHours >= 24 ? " ⚠️ >24h gap" : "";

      const suggestionsHtml = feedback.suggestions.length > 0
        ? `<ol style="margin:4px 0;padding-left:20px;">${feedback.suggestions.map((s) => `<li style="margin-bottom:4px;">${s}</li>`).join("")}</ol>`
        : "No specific suggestions.";

      const coachingNote = `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
        `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#059669,#10b981);color:white;font-size:14px;font-weight:700;">${ratingEmoji} Tech Performance Review — TriageIt AI</td></tr>` +
        `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Rating</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${ratingColor};font-weight:700;">${feedback.rating.replace(/_/g, " ").toUpperCase()}</td></tr>` +
        `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Communication</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;font-family:monospace;">${commScoreBar} ${feedback.communication_score}/5</td></tr>` +
        `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Response Time</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${feedback.response_time_assessment}${gapWarning}</td></tr>` +
        `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Max Gap</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${maxResponseGapHours >= 24 ? "#f87171" : maxResponseGapHours >= 4 ? "#fbbf24" : "#4ade80"};">${maxResponseGapHours.toFixed(1)}h (ticket age: ${ticketAgeHours.toFixed(1)}h)</td></tr>` +
        (feedback.strengths ? `<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Strengths</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#bbf7d0;">${feedback.strengths}</td></tr>` : "") +
        (feedback.improvement_areas ? `<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#fbbf24;">Improve</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#fde68a;">${feedback.improvement_areas}</td></tr>` : "") +
        `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#60a5fa;">Suggestions</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#bfdbfe;">${suggestionsHtml}</td></tr>` +
        `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:140px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Summary</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;font-weight:500;">${feedback.summary}</td></tr>` +
        `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · Employee Feedback · Private Note</td></tr>` +
        `</table>`;

      await halo.addInternalNote(ticket.halo_id, coachingNote);

      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Employee feedback: ${feedback.rating} (${feedback.communication_score}/5 communication). ${feedback.summary}`,
      );
    } catch (error) {
      console.error(
        `[MICHAEL] Failed to generate employee feedback for ticket #${ticket.halo_id}:`,
        error,
      );
    }
  }

  // ── Step 8: Send triage summary to Teams ─────────────────────────

  try {
    const teamsConfig = await getTeamsConfig(supabase);
    if (teamsConfig) {
      const teams = new TeamsClient(teamsConfig);
      await teams.sendTriageSummary({
        haloId: ticket.halo_id,
        summary: context.summary,
        clientName: context.clientName,
        classification: `${classification.classification.type} / ${classification.classification.subtype}`,
        urgencyScore: classification.urgency_score,
        recommendedPriority: classification.recommended_priority,
        recommendedTeam: michaelResult.recommended_team,
        rootCause: michaelResult.root_cause_hypothesis,
        securityFlag: classification.security_flag,
        escalationNeeded: michaelResult.escalation_needed,
        processingTimeMs: processingTime,
        agentCount: Object.keys(findings).length,
      });
    }
  } catch (error) {
    console.error(
      `[MICHAEL] Failed to send Teams notification for ticket #${ticket.halo_id}:`,
      error,
    );
  }

  // ── Step 9: Final thinking + completed log ─────────────────────────

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

  // ── Post-triage: Store ticket embedding for future similarity searches ──
  try {
    await storeTicketEmbedding(supabase, {
      ticketId: ticket.id,
      haloId: ticket.halo_id,
      summary: context.summary,
      details: context.details,
      classification: classType,
      clientName: context.clientName,
    });
  } catch (error) {
    console.warn("[MICHAEL] Failed to store ticket embedding (non-fatal):", error);
  }

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

function formatTechNotes(notes: string): string {
  // Split on numbered patterns like "1)", "1.", "(1)", or "STEP 1:" etc.
  const numbered = notes.split(/(?:^|\s)(?:\d+[\).\-:]|\(\d+\))\s*/g).filter(Boolean);
  if (numbered.length > 1) {
    const items = numbered.map((item) => `<li style="margin-bottom:6px;">${item.trim()}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }
  // Split on sentence-ending patterns (". UPPERCASE" or ". Action:")
  const sentences = notes.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > 2) {
    const items = sentences.map((s) => `<li style="margin-bottom:6px;">${s.trim()}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }
  return notes;
}

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
  similarTickets?: ReadonlyArray<SimilarTicket>,
  duplicates?: ReadonlyArray<DuplicateCandidate>,
): string {
  const agentCount = Object.keys(findings).length;
  // Dark theme base styles
  const border = "border-bottom:1px solid #3a3f4b;";
  const td1 = `style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;white-space:nowrap;color:#94a3b8;"`;
  const td2 = `style="padding:8px 12px;${border}font-size:14px;color:#e2e8f0;line-height:1.5;word-break:break-word;"`;

  const rows: string[] = [];

  // Header — gradient
  rows.push(`<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // Classification
  rows.push(`<tr style="background:#252830;"><td ${td1}>Classification</td><td ${td2}><strong>${classification.classification.type} / ${classification.classification.subtype}</strong> <span style="color:#64748b;font-size:11px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td></tr>`);

  // Urgency
  rows.push(`<tr style="background:#1E2028;"><td ${td1} style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#f59e0b;">Urgency</td><td ${td2}><strong style="color:#f59e0b;">${classification.urgency_score}/5</strong></td></tr>`);
  if (classification.urgency_reasoning) {
    rows.push(`<tr style="background:#252830;"><td style="padding:4px 12px;${border}width:130px;"></td><td style="padding:4px 12px 8px;${border}font-size:12px;color:#94a3b8;line-height:1.4;word-break:break-word;">${classification.urgency_reasoning}</td></tr>`);
  }

  // Priority + Team
  rows.push(`<tr style="background:#1E2028;"><td ${td1} style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#22d3ee;">Priority</td><td ${td2}><strong style="color:#22d3ee;">P${classification.recommended_priority}</strong> → ${michaelResult.recommended_team}</td></tr>`);

  // Entities
  if (classification.entities.length > 0) {
    rows.push(`<tr style="background:#252830;"><td ${td1}>Entities</td><td ${td2}>${classification.entities.join(", ")}</td></tr>`);
  }

  // Security
  if (classification.security_flag) {
    rows.push(`<tr style="background:#3b1018;"><td style="padding:8px 12px;font-weight:700;width:130px;${border}font-size:13px;vertical-align:top;color:#f87171;">⚠ Security</td><td style="padding:8px 12px;${border}font-size:14px;color:#fca5a5;line-height:1.5;word-break:break-word;">${classification.security_notes}</td></tr>`);
  }

  // Escalation
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:700;width:130px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⬆ Escalation</td><td style="padding:8px 12px;${border}font-size:14px;color:#fcd34d;line-height:1.5;word-break:break-word;">${michaelResult.escalation_reason}</td></tr>`);
  }

  // Root Cause — amber tinted dark background
  rows.push(`<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">🔍 Root Cause</td><td style="padding:8px 12px;${border}font-size:14px;color:#fde68a;line-height:1.5;word-break:break-word;">${michaelResult.root_cause_hypothesis}</td></tr>`);

  // Tech Notes — blue tinted dark background, parsed into numbered list
  const formattedNotes = formatTechNotes(michaelResult.internal_notes);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#60a5fa;">📋 Tech Notes</td><td style="padding:8px 12px;${border}font-size:13px;color:#bfdbfe;line-height:1.5;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Specialist findings
  const specialists = Object.entries(findings).filter(([name]) => name !== "ryan_howard");
  if (specialists.length > 0) {
    rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:8px 12px;font-size:12px;font-weight:600;color:#94a3b8;${border}text-transform:uppercase;letter-spacing:0.5px;">Specialist Findings</td></tr>`);
    for (let i = 0; i < specialists.length; i++) {
      const [name, finding] = specialists[i];
      const label = AGENT_LABELS[name] ?? name;
      const bg = i % 2 === 0 ? "#252830" : "#1E2028";
      rows.push(`<tr style="background:${bg};"><td style="padding:6px 12px;${border}font-size:12px;font-weight:600;color:#818cf8;width:130px;vertical-align:top;">${label}</td><td style="padding:6px 12px;${border}font-size:13px;color:#cbd5e1;line-height:1.4;word-break:break-word;">${finding.summary}</td></tr>`);
    }
  }

  // Quick Links — Hudu links and credentials from Dwight
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  if (huduLinks.length > 0 || relevantPasswords.length > 0) {
    const linkItems = huduLinks
      .map((l) => `<a href="${l.url}" style="color:#60a5fa;text-decoration:underline;">${l.label}</a>`)
      .join(" · ");
    const pwItems = relevantPasswords.map((p) => p.name).join(", ");
    const content = [
      linkItems,
      pwItems ? `<br/><span style="color:#94a3b8;font-size:11px;">Credentials: ${pwItems}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    rows.push(`<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#4ade80;">📎 Quick Links</td><td style="padding:8px 12px;${border}font-size:13px;color:#bbf7d0;line-height:1.6;word-break:break-word;">${content}</td></tr>`);
  }

  // Similar tickets — actionable suggestions
  if (similarTickets && similarTickets.length > 0) {
    const similarItems = similarTickets
      .map((t) => {
        const resolved = t.resolvedAt ? ` — <strong style="color:#4ade80;">RESOLVED</strong>` : "";
        return `<a href="#" style="color:#60a5fa;text-decoration:none;">⤴ #${t.haloId}</a> ${t.summary}${resolved} <span style="color:#64748b;font-size:11px;">(${(t.similarity * 100).toFixed(0)}% match${t.clientName ? `, ${t.clientName}` : ""})</span>`;
      })
      .join("<br/>");
    const hasResolved = similarTickets.some((t) => t.resolvedAt);
    const hint = hasResolved
      ? `<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">💡 Check the resolved ticket(s) above — a previous fix may apply to this issue.</span>`
      : `<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">These tickets have similar context — cross-reference for patterns or related issues.</span>`;
    rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#818cf8;">🔗 Similar</td><td style="padding:8px 12px;${border}font-size:13px;color:#c7d2fe;line-height:1.8;word-break:break-word;">${similarItems}${hint}</td></tr>`);
  }

  // Duplicate warnings
  if (duplicates && duplicates.length > 0) {
    const dupItems = duplicates
      .map((d) => `<strong style="color:#fbbf24;">#${d.haloId}</strong> ${d.summary} <span style="color:#64748b;font-size:11px;">(${(d.similarity * 100).toFixed(0)}% match)</span>`)
      .join("<br/>");
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:600;width:130px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⚠ Duplicates</td><td style="padding:8px 12px;${border}font-size:13px;color:#fde68a;line-height:1.6;word-break:break-word;">${dupItems}<br/><span style="font-size:11px;color:#94a3b8;">Consider merging if same issue.</span></td></tr>`);
  }

  // Footer
  rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · ${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</td></tr>`);

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;font-size:13px;color:#e2e8f0;margin:0;padding:0;border:1px solid #3a3f4b;background:#1E2028;border-radius:8px;overflow:hidden;">${rows.join("")}</table>`;
}

// ── Compact Retriage Note ─────────────────────────────────────────────
// On retriage, only post a small review note — NOT the full triage table.
// Focus on changes, tech performance flags, and any new findings.

function buildCompactRetrieageNote(
  classification: {
    classification: { type: string; subtype: string; confidence: number };
    urgency_score: number;
    recommended_priority: number;
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
  const border = "border-bottom:1px solid #3a3f4b;";
  const rows: string[] = [];

  // Compact header
  rows.push(`<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;font-size:13px;font-weight:600;">📋 Retriage Check — TriageIt<span style="float:right;font-weight:400;font-size:10px;opacity:0.8;">${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // Status line
  rows.push(`<tr style="background:#252830;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:12px;color:#94a3b8;">Status</td><td style="padding:6px 12px;${border}font-size:13px;color:#e2e8f0;">${classification.classification.type}/${classification.classification.subtype} · P${classification.recommended_priority} · ${michaelResult.recommended_team}</td></tr>`);

  // Escalation flag if needed
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:6px 12px;font-weight:700;width:100px;${border}font-size:12px;color:#fbbf24;">⬆ Escalate</td><td style="padding:6px 12px;${border}font-size:13px;color:#fcd34d;">${michaelResult.escalation_reason}</td></tr>`);
  }

  // Only include notes if they contain actionable info
  const formattedNotes = formatTechNotes(michaelResult.internal_notes);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:12px;color:#60a5fa;">Notes</td><td style="padding:6px 12px;${border}font-size:12px;color:#bfdbfe;line-height:1.4;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Quick Links — Hudu links from Dwight (also in retriage)
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  if (huduLinks.length > 0 || relevantPasswords.length > 0) {
    const linkItems = huduLinks
      .slice(0, 5) // Compact — only top 5 links
      .map((l) => `<a href="${l.url}" style="color:#60a5fa;text-decoration:underline;font-size:11px;">${l.label}</a>`)
      .join(" · ");
    const pwItems = relevantPasswords.slice(0, 5).map((p) => p.name).join(", ");
    const content = [
      linkItems,
      pwItems ? `<br/><span style="color:#94a3b8;font-size:10px;">Credentials: ${pwItems}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    rows.push(`<tr style="background:#162216;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:11px;color:#4ade80;">📎 Links</td><td style="padding:6px 12px;${border}font-size:12px;color:#bbf7d0;line-height:1.4;word-break:break-word;">${content}</td></tr>`);
  }

  // Footer
  rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · retriage</td></tr>`);

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:680px;border-collapse:collapse;font-size:12px;color:#e2e8f0;border:1px solid #3a3f4b;background:#1E2028;border-radius:6px;overflow:hidden;">${rows.join("")}</table>`;
}

// Customer response is now only displayed in the TriageIT embed tab
// (no longer posted as a separate Halo note to reduce clutter).
