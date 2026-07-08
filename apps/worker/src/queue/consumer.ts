import { Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";
import { createSupabaseClient } from "../db/supabase.js";
import { runTriage } from "../agents/manager/michael-scott.js";
import { syncTicketStatusFromHalo } from "./status-sync.js";
import { runTobyIncremental } from "../agents/workers/toby-incremental.js";
import type { TriageJobData } from "./producer.js";

const QUEUE_NAME = "triage";

export async function processTriageJob(
  data: TriageJobData,
  jobId = "direct",
): Promise<{ success: true; skipped?: true; reason?: string; triageResultId?: string }> {
  console.log(`[TRIAGE] Processing job ${jobId}: ticket #${data.haloId} (${data.ticketId})`);
  const supabase = createSupabaseClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", data.ticketId)
    .single();

  if (!ticket) {
    throw new Error(`Ticket not found: ${data.ticketId}`);
  }

  // In-flight guard: webhook + ticket-sync can enqueue the same new ticket
  // seconds apart — don't run two full pipelines concurrently
  if (ticket.status === "triaging" && ticket.updated_at) {
    const minutesInFlight = (Date.now() - new Date(ticket.updated_at).getTime()) / 60_000;
    if (minutesInFlight < 10) {
      console.log(
        `[TRIAGE] Skipping #${data.haloId} — another triage started ${minutesInFlight.toFixed(0)}m ago`,
      );
      return { success: true, skipped: true, reason: "in_flight" };
    }
  }

  await supabase
    .from("tickets")
    .update({
      status: "triaging",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.ticketId);

  try {
    // Check if this is a retriage (existing FULL results before this run —
    // daily-scan flag rows are triage_type='retriage' and don't count, else
    // a new ticket's first triage gets treated as a retriage)
    const { data: priorTriages } = await supabase
      .from("triage_results")
      .select("id, created_at, classification, urgency_score, recommended_priority, security_flag, internal_notes")
      .eq("ticket_id", data.ticketId)
      .neq("triage_type", "retriage")
      .order("created_at", { ascending: false });

    const priorTriageCount = priorTriages?.length ?? 0;

    // Cooldown: if triaged < 5 minutes ago, skip to avoid rapid-fire duplicates
    // (e.g. webhook + pull-tickets hitting the same ticket simultaneously)
    const lastTriagedAt = priorTriages?.[0]?.created_at;
    if (lastTriagedAt) {
      const minutesSinceLast = (Date.now() - new Date(lastTriagedAt).getTime()) / 60_000;
      if (minutesSinceLast < 5) {
        console.log(
          `[TRIAGE] Skipping #${data.haloId} — triaged ${minutesSinceLast.toFixed(0)}m ago (< 5m cooldown)`,
        );
        await supabase
          .from("tickets")
          .update({ status: priorTriageCount > 0 ? "re-triaged" : "triaged", updated_at: new Date().toISOString() })
          .eq("id", data.ticketId);
        return { success: true, skipped: true, reason: "recently_triaged" };
      }
    }

    const result = await runTriage(ticket, supabase);

    // Always insert triage results — even if identical to previous.
    // Every retriage must be recorded for full visibility.
    await supabase.from("triage_results").insert(result);

    const finalStatus = (priorTriageCount ?? 0) > 0 ? "re-triaged" : "triaged";
    await supabase
      .from("tickets")
      .update({
        status: finalStatus,
        last_retriage_at: finalStatus === "re-triaged" ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.ticketId);

    // Sync the latest Halo status (e.g. "Waiting on Tech") after triage
    await syncTicketStatusFromHalo(supabase, data.ticketId, data.haloId);

    // Toby incremental learning — update tech & customer profiles in background
    // Fire-and-forget: don't block the triage response
    runTobyIncremental(supabase, {
      ticketId: data.ticketId,
      haloId: data.haloId,
      clientName: ticket.client_name ?? null,
      techName: ticket.halo_agent ?? null,
      classificationType: result.classification?.type ?? null,
      classificationSubtype: result.classification?.subtype ?? null,
      urgencyScore: result.urgency_score,
      summary: ticket.summary ?? "",
    }).catch((err: unknown) => {
      console.error(`[TOBY-LIVE] Incremental update failed for #${data.haloId} (non-fatal):`, err);
    });

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
      .eq("id", data.ticketId);

    throw error;
  }
}

export function startTriageWorker(): Worker<TriageJobData> {
  const worker = new Worker<TriageJobData>(
    QUEUE_NAME,
    async (job: Job<TriageJobData>) => {
      return processTriageJob(job.data, job.id ?? "unknown");
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 3,
      limiter: {
        max: 10,
        duration: 60_000,
      },
      // Full triages run for minutes (specialists + synthesis + attachments).
      // The default 30s lock let a Redis blip mark an in-flight triage
      // stalled — it would re-run and post a duplicate Halo note.
      lockDuration: 600_000,
      maxStalledCount: 2,
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
