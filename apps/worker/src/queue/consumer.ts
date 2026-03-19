import { Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";
import { createSupabaseClient } from "../db/supabase.js";
import { runTriage } from "../agents/manager/michael-scott.js";
import { syncTicketStatusFromHalo } from "./status-sync.js";
import type { TriageJobData } from "./producer.js";

const QUEUE_NAME = "triage";

export function startTriageWorker(): Worker<TriageJobData> {
  const worker = new Worker<TriageJobData>(
    QUEUE_NAME,
    async (job: Job<TriageJobData>) => {
      console.log(`[TRIAGE] Processing job ${job.id}: ticket #${job.data.haloId} (${job.data.ticketId})`);
      const supabase = createSupabaseClient();

      await supabase
        .from("tickets")
        .update({
          status: "triaging",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.data.ticketId);

      const { data: ticket } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", job.data.ticketId)
        .single();

      if (!ticket) {
        throw new Error(`Ticket not found: ${job.data.ticketId}`);
      }

      try {
        const result = await runTriage(ticket, supabase);

        await supabase.from("triage_results").insert(result);

        await supabase
          .from("tickets")
          .update({ status: "triaged", updated_at: new Date().toISOString() })
          .eq("id", job.data.ticketId);

        // Sync the latest Halo status (e.g. "Waiting on Tech") after triage
        await syncTicketStatusFromHalo(supabase, job.data.ticketId, job.data.haloId);

        return { success: true, triageResultId: result.id };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        await supabase
          .from("tickets")
          .update({
            status: "error",
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.data.ticketId);

        throw error;
      }
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 3,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`[TRIAGE] Completed: ${job.id} (ticket: ${job.data.haloId})`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[TRIAGE] Failed: ${job?.id} (ticket: ${job?.data.haloId}):`,
      error.message,
    );
  });

  worker.on("error", (error) => {
    console.error("[TRIAGE] Worker error:", error.message);
  });

  worker.on("ready", () => {
    console.log("[TRIAGE] Worker connected to Redis and ready");
  });

  worker.on("stalled", (jobId) => {
    console.warn(`[TRIAGE] Job stalled: ${jobId}`);
  });

  return worker;
}
