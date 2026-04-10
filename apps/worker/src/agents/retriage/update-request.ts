import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig, HaloAction, TeamsConfig } from "@triageit/shared";
import { HaloClient } from "../../integrations/halo/client.js";
import { TeamsClient } from "../../integrations/teams/client.js";
import { parseLlmJson } from "../parse-json.js";

// Only match when the customer is ASKING for an update — not providing one.
// "please update the MFA list" is NOT an update request.
// "any update on this?" IS an update request.
const UPDATE_REQUEST_PATTERNS = [
  /\bany\s+(update|news|progress)\b/i,
  /\bwhat('?s| is)\s+(the\s+)?(status|update|progress)\b/i,
  /\bfollowing\s+up\b/i,
  /\bfollow\s*-?\s*up\s+on\b/i,
  /\bjust\s+checking\s+(in|on)\b/i,
  /\bstill\s+(waiting|pending|open)\b/i,
  /\bhas\s+(this|anything)\s+been\s+(done|resolved|fixed|addressed|looked\s+at)\b/i,
  /\bcan\s+(you|we)\s+(get|provide|give)\s+(an?\s+)?update\b/i,
  /\bwhat('?s| is)\s+the\s+ETA\b/i,
  /\bhaven'?t\s+heard\s+back\b/i,
  /\bno\s+(response|reply)\s+(from|yet)\b/i,
  /\bplease\s+(advise|respond)\b/i,
  /\bany\s+update\s*\?/i,
  /\bwhere\s+are\s+we\s+(on|with)\b/i,
  /\bis\s+anyone\s+(working|looking)\b/i,
];

const RETRIAGE_PROMPT = `You are an MSP help desk advisor. A customer has asked for an update on their ticket.

Review the ticket details and action history. Provide:
1. A brief summary of where the ticket currently stands
2. What has been done so far
3. What the next step should be
4. If the ticket is being handled properly or needs attention

Respond with ONLY valid JSON:
{
  "ticket_status_summary": "Brief summary of current ticket state",
  "work_done": "What has been done so far",
  "next_step": "Recommended next action for the tech",
  "needs_attention": true/false,
  "suggested_response_to_customer": "A brief, professional message to acknowledge the customer's request for update"
}`;

export function isUpdateRequest(text: string): boolean {
  return UPDATE_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

// In-memory backup dedup (survives within a single process lifecycle)
const recentUpdateRequests = new Map<number, number>();

export async function handleUpdateRequest(
  haloTicketId: number,
  customerMessage: string,
  supabase: SupabaseClient,
): Promise<void> {
  // In-memory dedup (fast, but resets on deploy)
  const lastHandled = recentUpdateRequests.get(haloTicketId);
  if (lastHandled && Date.now() - lastHandled < 30 * 60 * 1000) {
    console.log(`[UPDATE-REQUEST] Skipping duplicate for #${haloTicketId} — in-memory dedup`);
    return;
  }

  // DB-level dedup — check agent_logs for a recent update_request entry (survives restarts)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: dedupTicket } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", haloTicketId)
    .maybeSingle();

  if (dedupTicket) {
    const { data: recentForTicket } = await supabase
      .from("agent_logs")
      .select("id")
      .eq("agent_name", "update_request_handler")
      .eq("ticket_id", dedupTicket.id)
      .gte("created_at", thirtyMinAgo)
      .limit(1)
      .maybeSingle();

    if (recentForTicket) {
      console.log(`[UPDATE-REQUEST] Skipping duplicate for #${haloTicketId} — DB dedup (logged in last 30min)`);
      recentUpdateRequests.set(haloTicketId, Date.now());
      return;
    }
  }

  recentUpdateRequests.set(haloTicketId, Date.now());

  // Clean old in-memory entries
  for (const [id, time] of recentUpdateRequests) {
    if (Date.now() - time > 60 * 60 * 1000) recentUpdateRequests.delete(id);
  }

  // Get Halo config
  const { data: haloIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!haloIntegration) {
    console.error("[UPDATE-REQUEST] Halo not configured");
    return;
  }

  const halo = new HaloClient(haloIntegration.config as HaloConfig);

  // Get ticket details and actions
  let ticket;
  try {
    ticket = await halo.getTicket(haloTicketId);
  } catch {
    console.error(`[UPDATE-REQUEST] Failed to fetch ticket #${haloTicketId}`);
    return;
  }

  const actions = await halo.getTicketActions(haloTicketId);

  // Run quick Haiku re-triage focused on the update request
  const client = new Anthropic();

  const contextMessage = [
    `Ticket #${ticket.id}: ${ticket.summary}`,
    `Client: ${ticket.client_name ?? "Unknown"}`,
    `Status: ${ticket.status ?? "Unknown"}`,
    `Assigned Agent: ${ticket.agent_id ? `Agent #${ticket.agent_id}` : "UNASSIGNED"}`,
    `Created: ${ticket.datecreated}`,
    "",
    `Customer's update request: "${customerMessage}"`,
    "",
    "Recent Actions (last 15):",
    ...actions.slice(0, 15).map(
      (a: HaloAction) =>
        `  [${a.datecreated ?? "?"}] ${a.hiddenfromuser ? "(internal)" : "(customer-visible)"} ${a.who ?? "unknown"}: ${a.note?.substring(0, 300) ?? ""}`,
    ),
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: RETRIAGE_PROMPT,
    messages: [{ role: "user", content: contextMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  const analysis = parseLlmJson<{
    ticket_status_summary: string;
    work_done: string;
    next_step: string;
    needs_attention: boolean;
    suggested_response_to_customer: string;
  }>(text);

  // Resolve the assigned tech's name (not just agent_id)
  let techName: string | null = null;
  const raw = ticket as unknown as Record<string, unknown>;
  if (raw.agent_name && typeof raw.agent_name === "string") {
    techName = raw.agent_name;
  } else if (ticket.agent_id) {
    techName = await halo.resolveAgentName(null, ticket.agent_id);
  }
  const agentMention = techName ?? "Team";

  const internalNote = [
    `<table style="font-family:'Segoe UI',Roboto,sans-serif;width:100%;max-width:680px;border-collapse:collapse;background:#1E2028;border:1px solid #2A2D35;border-radius:6px;overflow:hidden;">`,
    `<tr><td colspan="2" style="padding:10px 14px;background:linear-gradient(135deg,#8B2C2C,#5C1A1A);color:#fff;font-size:14px;font-weight:700;">Customer Update Request</td></tr>`,
    `<tr><td colspan="2" style="padding:8px 14px;background:rgba(62,26,26,0.12);border-bottom:1px solid #2A2D35;font-size:13px;color:#EF9A9A;font-weight:600;">${agentMention} — customer is asking for an update. Management notified.</td></tr>`,
    `<tr><td style="padding:6px 14px;font-size:12px;color:#78909C;font-weight:600;width:100px;border-bottom:1px solid #2A2D35;">Status</td><td style="padding:6px 14px;font-size:13px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${analysis.ticket_status_summary}</td></tr>`,
    `<tr><td style="padding:6px 14px;font-size:12px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Done</td><td style="padding:6px 14px;font-size:13px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${analysis.work_done}</td></tr>`,
    `<tr><td style="padding:6px 14px;font-size:12px;color:#FFB74D;font-weight:600;border-bottom:1px solid #2A2D35;">Next</td><td style="padding:6px 14px;font-size:13px;color:#FFB74D;font-weight:600;border-bottom:1px solid #2A2D35;">${analysis.next_step}</td></tr>`,
    `<tr><td style="padding:6px 14px;font-size:12px;color:#78909C;font-weight:600;">Reply</td><td style="padding:6px 14px;font-size:13px;color:#90CAF9;line-height:1.5;">${analysis.suggested_response_to_customer}</td></tr>`,
    `<tr><td colspan="2" style="padding:4px 14px;background:#1A1C22;text-align:right;font-size:10px;color:#546E7A;">TriageIt AI &middot; update request</td></tr>`,
    `</table>`,
  ].join("");

  // Post or update the internal note in Halo
  // If a previous update request note exists, edit it instead of creating a new one
  const existingNoteId = await halo.findTriageItNote(haloTicketId, "update request");
  if (existingNoteId) {
    await halo.updateNote(existingNoteId, haloTicketId, internalNote);
    console.log(`[UPDATE-REQUEST] Updated existing note ${existingNoteId} for #${haloTicketId}`);
  } else {
    await halo.addInternalNote(haloTicketId, internalNote);
  }

  // Send Teams notification
  const { data: teamsIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  if (teamsIntegration) {
    const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
    await teams.sendImmediateAlert(
      {
        haloId: haloTicketId,
        summary: ticket.summary,
        clientName: ticket.client_name ?? null,
        status: ticket.status ?? "Unknown",
        flags: ["customer_update_request"],
        recommendation: `Customer asked for an update. ${analysis.needs_attention ? "NEEDS ATTENTION — " : ""}Next step: ${analysis.next_step}`,
        daysOpen: Math.floor(
          (Date.now() - new Date(ticket.datecreated).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
        severity: analysis.needs_attention ? "critical" : "warning",
      },
      "Customer Requesting Update",
    );
  }

  // Log the event
  const { data: logTicket } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", haloTicketId)
    .single();

  if (logTicket) {
    await supabase.from("agent_logs").insert({
      ticket_id: logTicket.id,
      agent_name: "update_request_handler",
      agent_role: "retriage",
      status: "completed",
      input_summary: `Customer update request: "${customerMessage.substring(0, 200)}"`,
      output_summary: `Needs attention: ${analysis.needs_attention}. Next step: ${analysis.next_step}`,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
      duration_ms: 0,
    });
  }

  console.log(
    `[UPDATE-REQUEST] Handled update request for ticket #${haloTicketId}. ` +
      `Needs attention: ${analysis.needs_attention}`,
  );
}
