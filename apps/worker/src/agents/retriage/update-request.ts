import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig, HaloAction, TeamsConfig } from "@triageit/shared";
import { HaloClient } from "../../integrations/halo/client.js";
import { TeamsClient } from "../../integrations/teams/client.js";
import { parseLlmJson } from "../parse-json.js";

const UPDATE_REQUEST_PATTERNS = [
  /\bupdate\b/i,
  /\bstatus\b/i,
  /\bany\s+news\b/i,
  /\bfollowing\s+up\b/i,
  /\bfollow\s*-?\s*up\b/i,
  /\bwhat('?s| is)\s+(the\s+)?(status|update|progress)\b/i,
  /\bwhen\s+(will|can)\b/i,
  /\bjust\s+checking\b/i,
  /\bany\s+progress\b/i,
  /\bwaiting\b/i,
  /\bstill\s+(waiting|pending|open)\b/i,
  /\bhas\s+(this|anything)\s+been\b/i,
  /\bcan\s+you\s+(provide|give)\b.*\bupdate\b/i,
  /\bETA\b/,
  /\bhaven'?t\s+heard\b/i,
  /\bno\s+response\b/i,
  /\bplease\s+(advise|update|respond)\b/i,
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

export async function handleUpdateRequest(
  haloTicketId: number,
  customerMessage: string,
  supabase: SupabaseClient,
): Promise<void> {
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

  // Build the internal note @mentioning the assigned tech
  const agentMention = ticket.agent_id
    ? `@agent:${ticket.agent_id}`
    : "@team";

  const internalNote = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;background:#1E2028;border-radius:8px;overflow:hidden;border:1px solid #2A2D35;">
  <div style="background:linear-gradient(135deg,#8B2C2C,#5C1A1A);padding:14px 18px;">
    <span style="font-size:15px;font-weight:700;color:#FFFFFF;">TriageIt — Customer Update Request</span>
  </div>

  <div style="padding:14px 18px;border-bottom:1px solid #2A2D35;background:#3E1A1A20;">
    <p style="margin:0;font-size:14px;color:#EF9A9A;font-weight:600;">
      ${agentMention} — The customer has requested an update on this ticket. Management has been notified.
    </p>
  </div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;width:140px;">Current Status</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${analysis.ticket_status_summary}</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;border-bottom:1px solid #2A2D35;">Work Done</td>
      <td style="padding:12px 14px;font-size:14px;color:#E0E0E0;border-bottom:1px solid #2A2D35;">${analysis.work_done}</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#FFB74D;font-weight:600;border-bottom:1px solid #2A2D35;">Next Step</td>
      <td style="padding:12px 14px;font-size:14px;color:#FFB74D;border-bottom:1px solid #2A2D35;font-weight:600;">${analysis.next_step}</td>
    </tr>
    <tr>
      <td style="padding:12px 14px;font-size:13px;color:#78909C;font-weight:600;">Suggested Reply</td>
      <td style="padding:12px 14px;font-size:14px;color:#90CAF9;line-height:1.6;">${analysis.suggested_response_to_customer}</td>
    </tr>
  </table>

  <div style="padding:10px 18px;background:#1A1C22;text-align:right;">
    <span style="font-size:11px;color:#546E7A;">TriageIt AI &middot; Update Request Handler</span>
  </div>
</div>`;

  // Post the internal note to Halo
  await halo.addInternalNote(haloTicketId, internalNote);

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
  const { data: localTicket } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", haloTicketId)
    .single();

  if (localTicket) {
    await supabase.from("agent_logs").insert({
      ticket_id: localTicket.id,
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
