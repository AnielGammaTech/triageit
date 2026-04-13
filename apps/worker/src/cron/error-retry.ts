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
export async function retryErroredTickets(): Promise<RetryResult> {
  const supabase = createSupabaseClient();

  const { data: errorTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, retry_count, error_message")
    .eq("status", "error")
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
