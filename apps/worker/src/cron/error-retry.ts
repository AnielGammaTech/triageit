import { createSupabaseClient } from "../db/supabase.js";
import { enqueueTriageJob } from "../queue/producer.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

const MAX_RETRIES = 3;

interface RetryResult {
  readonly retried: number;
  readonly escalated: number;
}

/**
 * Auto-retry tickets stuck in error status.
 * After 3 failed retries, marks as permanently failed and sends escalation.
 */
const STUCK_AFTER_MS = 30 * 60 * 1000;

export async function retryErroredTickets(): Promise<RetryResult> {
  const supabase = createSupabaseClient();

  // Fold in tickets stranded mid-triage (worker crashed, deploy killed the
  // container, job lost) — mark them errored so the retry flow below picks
  // them up. Nothing else in the system ever recovers a stale "triaging".
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data: stuckTickets } = await supabase
    .from("tickets")
    .select("id, halo_id")
    .in("status", ["triaging", "pending"])
    .eq("halo_is_open", true)
    .lt("updated_at", stuckCutoff);

  if (stuckTickets && stuckTickets.length > 0) {
    console.log(`[ERROR-RETRY] Unsticking ${stuckTickets.length} tickets stalled in triaging/pending > 30 min`);
    await supabase
      .from("tickets")
      .update({
        status: "error",
        error_message: "Stalled in triaging — worker restarted or job lost",
        updated_at: new Date().toISOString(),
      })
      .in("id", stuckTickets.map((t) => t.id));
  }

  // Only retry tickets still open in Halo — closed tickets that errored
  // historically stay as-is instead of burning retries on dead work
  const { data: errorTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, retry_count, error_message")
    .eq("status", "error")
    .eq("halo_is_open", true)
    .order("updated_at", { ascending: true });

  if (!errorTickets || errorTickets.length === 0) {
    return { retried: 0, escalated: 0 };
  }

  console.log(`[ERROR-RETRY] Found ${errorTickets.length} errored tickets`);

  let retried = 0;
  let escalated = 0;
  const permanentFailures: typeof errorTickets = [];

  for (const ticket of errorTickets) {
    const currentRetries = ticket.retry_count ?? 0;

    if (currentRetries >= MAX_RETRIES) {
      // Permanent failure
      await supabase
        .from("tickets")
        .update({
          status: "failed_permanent",
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticket.id);

      permanentFailures.push(ticket);
      escalated++;
      console.log(`[ERROR-RETRY] Ticket #${ticket.halo_id} permanently failed after ${MAX_RETRIES} retries`);
    } else {
      // Retry: reset to pending and re-enqueue
      await supabase
        .from("tickets")
        .update({
          status: "pending",
          retry_count: currentRetries + 1,
          last_retry_at: new Date().toISOString(),
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticket.id);

      await enqueueTriageJob({
        ticketId: ticket.id,
        haloId: ticket.halo_id,
        summary: ticket.summary,
      });

      retried++;
      console.log(`[ERROR-RETRY] Retrying #${ticket.halo_id} (attempt ${currentRetries + 1}/${MAX_RETRIES})`);
    }
  }

  // Send escalation alert for permanent failures
  if (permanentFailures.length > 0) {
    const { data: teamsIntegration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "teams")
      .eq("is_active", true)
      .single();

    if (teamsIntegration) {
      const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
      await teams.sendPermanentFailureAlert(
        permanentFailures.map((t) => ({
          haloId: t.halo_id,
          summary: t.summary,
          clientName: t.client_name,
          errorMessage: t.error_message,
        })),
      );
    }
  }

  return { retried, escalated };
}
