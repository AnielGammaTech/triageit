import type { ThreeCxConfig } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import { ThreeCxClient } from "../integrations/threecx/client.js";
import { manuallyMatchRecording } from "../cron/call-analysis.js";
import { invalidateCallTranscriptionCache } from "./call-transcriptions.js";
import { peopleNamesOverlap } from "./call-match-review-policy.js";

interface ReviewActionInput {
  readonly value: Record<string, unknown>;
  readonly actorName: string | null;
}

export async function resolveCallMatchReviewAction(input: ReviewActionInput): Promise<string> {
  const action = String(input.value.triageit_action ?? "");
  const recordingId = Number(input.value.recording_id);
  if (!Number.isInteger(recordingId) || recordingId <= 0) return "This review card has an invalid recording number.";
  if (action !== "match_call" && action !== "separate_call") return "This review action is not supported.";

  const supabase = createSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("call_analyses")
    .select("recording_id, tech_name, halo_id, matched_by, teams_review_status, teams_review_ticket_id")
    .eq("recording_id", recordingId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return `Recording ${recordingId} is no longer available.`;
  if (!peopleNamesOverlap(existing.tech_name, input.actorName)) {
    return `This review belongs to ${existing.tech_name ?? "the tech on the call"}. Only that person can resolve it.`;
  }
  if (existing.halo_id) return `This call is already matched to Halo ticket #${existing.halo_id}.`;
  if (existing.teams_review_status === "separate") return "This call was already marked as separate from any ticket.";

  const reviewedAt = new Date().toISOString();
  if (action === "separate_call") {
    const { data: updated, error } = await supabase
      .from("call_analyses")
      .update({
        matched_by: "confirmed_separate_call",
        teams_review_status: "separate",
        teams_reviewed_at: reviewedAt,
        teams_reviewed_by: input.actorName,
        teams_review_ticket_id: null,
      })
      .eq("recording_id", recordingId)
      .is("halo_id", null)
      .eq("teams_review_status", "pending")
      .select("recording_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return "This call review was already resolved.";
    invalidateCallTranscriptionCache();
    return `Recording ${recordingId} is marked as a separate call. No Halo ticket was changed.`;
  }

  const haloId = Number(input.value.halo_id);
  if (!Number.isInteger(haloId) || haloId <= 0) return "Enter a valid Halo ticket number, then select Match and post.";

  const { data: claimed, error: claimError } = await supabase
    .from("call_analyses")
    .update({ teams_review_status: "resolving" })
    .eq("recording_id", recordingId)
    .is("halo_id", null)
    .eq("teams_review_status", "pending")
    .select("recording_id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return "This call review is already being resolved or has been completed.";

  try {
    const [{ data: integration }, haloConfig] = await Promise.all([
      supabase.from("integrations").select("config").eq("service", "threecx").eq("is_active", true).maybeSingle(),
      getCachedHaloConfig(supabase),
    ]);
    if (!integration || !haloConfig) throw new Error("3CX or Halo is unavailable");

    const tcx = new ThreeCxClient(integration.config as ThreeCxConfig);
    const [recording] = (await tcx.getRecordingsSince(recordingId - 1, 1)) ?? [];
    if (!recording || recording.Id !== recordingId) throw new Error("The 3CX recording is no longer available");

    const result = await manuallyMatchRecording(supabase, new HaloClient(haloConfig), recording, haloId);
    await supabase.from("call_analyses").update({
      teams_review_status: "matched",
      teams_reviewed_at: reviewedAt,
      teams_reviewed_by: input.actorName,
      teams_review_ticket_id: haloId,
    }).eq("recording_id", recordingId);
    invalidateCallTranscriptionCache();
    return result.posted
      ? `Matched recording ${recordingId} to Halo ticket #${haloId}. The call summary was posted.`
      : `Matched recording ${recordingId} to Halo ticket #${haloId}, but the call summary needs attention in TriageIT.`;
  } catch (error) {
    await supabase.from("call_analyses").update({ teams_review_status: "pending" }).eq("recording_id", recordingId).eq("teams_review_status", "resolving");
    throw error;
  }
}
