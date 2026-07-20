import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupportCallStaffName } from "@triageit/shared";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { sendProactiveTeamsCard } from "../integrations/teams/bot.js";
import { cnamIdentityFromEvidence } from "./call-transcriptions.js";
import { peopleNamesOverlap } from "./call-match-review-policy.js";

interface PendingCallReview {
  readonly recording_id: number;
  readonly tech_name: string | null;
  readonly direction: string | null;
  readonly started_at: string | null;
  readonly external_number: string | null;
  readonly summary: string | null;
  readonly identified_customer_name: string | null;
  readonly identified_client_name: string | null;
  readonly match_evidence: string | null;
}

interface ConversationReference {
  readonly user_aad_id: string;
  readonly user_teams_id: string;
  readonly user_name: string;
  readonly conversation_id: string;
  readonly service_url: string;
  readonly bot_id: string;
  readonly tenant_id: string | null;
}

export function buildCallMatchReviewCard(call: PendingCallReview): Record<string, unknown> {
  const when = call.started_at
    ? new Date(call.started_at).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time unavailable";
  const cnamIdentity = cnamIdentityFromEvidence(call.match_evidence);
  const customer = [call.identified_customer_name, call.identified_client_name].filter(Boolean).join(" · ")
    || (cnamIdentity ? `${cnamIdentity.name} (Twilio CNAM ${cnamIdentity.type?.toLowerCase() ?? "caller-name"} hint)` : "Customer not identified");
  const direction = call.direction === "outbound" ? "Outbound" : "Inbound";

  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text: "TriageIT needs your ticket match", weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text: `You handled this call, but TriageIT could not safely match recording ${call.recording_id}. Choose the correct ticket instead of letting the system guess.`, color: "Warning", wrap: true, spacing: "Small" },
          {
            type: "FactSet",
            facts: [
              { title: "Call", value: `${direction} · ${when}` },
              { title: "Customer", value: customer },
              ...(call.external_number ? [{ title: "Number", value: call.external_number }] : []),
            ],
          },
          ...(call.summary ? [
            { type: "TextBlock", text: "What the call was about", weight: "Bolder", wrap: true, spacing: "Medium" },
            { type: "TextBlock", text: call.summary, wrap: true, spacing: "Small" },
          ] : []),
          {
            type: "Input.Text",
            id: "halo_id",
            label: "Halo ticket number",
            placeholder: "Example: 41107",
            isRequired: false,
            errorMessage: "Enter the Halo ticket number",
            spacing: "Medium",
          },
        ],
        actions: [
          {
            type: "Action.Submit",
            title: "Match and post",
            style: "positive",
            data: { triageit_action: "match_call", recording_id: call.recording_id },
          },
          {
            type: "Action.Submit",
            title: "Separate call",
            data: { triageit_action: "separate_call", recording_id: call.recording_id },
          },
        ],
      },
    }],
  };
}

export async function sendPendingCallMatchReviews(supabase: SupabaseClient): Promise<number> {
  if (!isWithinBusinessHours()) return 0;
  const callReviewBotAppId = process.env.TEAMS_CALL_BOT_APP_ID?.toLowerCase();
  if (!callReviewBotAppId) return 0;

  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [{ data: calls, error: callError }, { data: references, error: referenceError }] = await Promise.all([
    supabase
      .from("call_analyses")
      .select("recording_id, tech_name, direction, started_at, external_number, summary, identified_customer_name, identified_client_name, match_evidence")
      .is("halo_id", null)
      .eq("teams_review_status", "pending")
      .is("teams_review_sent_at", null)
      .gte("started_at", cutoff)
      .order("started_at", { ascending: true })
      .limit(20),
    supabase
      .from("teams_conversation_references")
      .select("user_aad_id, user_teams_id, user_name, conversation_id, service_url, bot_id, tenant_id"),
  ]);
  if (callError) throw new Error(callError.message);
  if (referenceError) throw new Error(referenceError.message);

  let sent = 0;
  for (const call of (calls ?? []) as PendingCallReview[]) {
    if (!isSupportCallStaffName(call.tech_name)) continue;
    const reference = ((references ?? []) as ConversationReference[])
      .find((candidate) => candidate.bot_id.toLowerCase().includes(callReviewBotAppId)
        && peopleNamesOverlap(candidate.user_name, call.tech_name));
    if (!reference) continue;

    try {
      const activityId = await sendProactiveTeamsCard(reference, buildCallMatchReviewCard(call));
      const sentAt = new Date().toISOString();
      const { error } = await supabase
        .from("call_analyses")
        .update({ teams_review_sent_at: sentAt, teams_review_activity_id: activityId })
        .eq("recording_id", call.recording_id)
        .eq("teams_review_status", "pending")
        .is("teams_review_sent_at", null);
      if (error) throw new Error(error.message);
      sent++;
      console.log(`[CALL-REVIEW] Sent recording ${call.recording_id} to ${reference.user_name} in Teams`);
    } catch (error) {
      console.error(`[CALL-REVIEW] Could not notify ${call.tech_name ?? "unknown tech"} about recording ${call.recording_id}:`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}
