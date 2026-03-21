import Fastify from "fastify";
import { startTriageWorker } from "./queue/consumer.js";
import { createSupabaseClient } from "./db/supabase.js";
import { enqueueTriageJob } from "./queue/producer.js";
import {
  startCronScheduler,
  stopCronScheduler,
  triggerDailyRetriage,
  reloadCronScheduler,
  triggerCronJob,
} from "./cron/scheduler.js";
import {
  isUpdateRequest,
  handleUpdateRequest,
} from "./agents/retriage/update-request.js";
import { scanForSlaBreaches } from "./cron/sla-scan.js";
import {
  triageSchema,
  cronTriggerSchema,
  webhookActionSchema,
} from "./validation/schemas.js";
import { MemoryManager } from "./memory/memory-manager.js";
import { runTobyAnalysis } from "./agents/workers/toby-flenderson.js";

const server = Fastify({ logger: true });

// Health check
server.get("/health", async () => {
  return { status: "ok", service: "triageit-worker" };
});

// Manual triage trigger (for testing or re-processing)
// Accepts either { ticket_id } (local UUID) or { halo_id } (Halo ticket number)
server.post<{ Body: { ticket_id?: string; halo_id?: number } }>(
  "/triage",
  async (request, reply) => {
    const parsed = triageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.issues });
    }
    const { ticket_id, halo_id } = parsed.data;

    const supabase = createSupabaseClient();

    // Look up ticket by local ID or Halo ID
    const query = ticket_id
      ? supabase.from("tickets").select("id, halo_id, summary").eq("id", ticket_id).single()
      : supabase.from("tickets").select("id, halo_id, summary").eq("halo_id", halo_id!).single();

    const { data: ticket } = await query;

    if (!ticket) {
      return reply.status(404).send({ error: `Ticket not found: ${ticket_id ?? `halo #${halo_id}`}` });
    }

    const jobId = await enqueueTriageJob({
      ticketId: ticket.id,
      haloId: ticket.halo_id,
      summary: ticket.summary,
    });

    return { status: "queued", job_id: jobId };
  },
);

// Manual SLA breach scan
server.post<{ Body: Record<string, never> }>(
  "/sla-scan",
  async (_request, reply) => {
    try {
      const result = await scanForSlaBreaches();
      return {
        status: "completed",
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Manual daily re-triage trigger
server.post<{ Body: Record<string, never> }>(
  "/retriage",
  async (_request, reply) => {
    try {
      const result = await triggerDailyRetriage();
      return {
        status: "completed",
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Trigger a specific cron job by ID
server.post<{ Body: { job_id: string } }>(
  "/cron/trigger",
  async (request, reply) => {
    const parsed = cronTriggerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.issues });
    }
    const { job_id } = parsed.data;

    try {
      const result = await triggerCronJob(job_id);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Memory eviction — prune stale, low-value memories
server.post<{ Body: { max_age_days?: number; min_confidence?: number } }>(
  "/memory/evict",
  async (request, reply) => {
    try {
      const supabase = createSupabaseClient();
      const memoryManager = new MemoryManager(supabase);
      const body = (request.body ?? {}) as {
        max_age_days?: number;
        min_confidence?: number;
      };

      const evicted = await memoryManager.evictStaleMemories({
        maxAgeDays: body.max_age_days,
        minConfidence: body.min_confidence,
      });

      return { status: "completed", evicted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Toby learning analysis — manual trigger
server.post<{ Body: Record<string, never> }>(
  "/toby/analyze",
  async (_request, reply) => {
    try {
      const supabase = createSupabaseClient();
      const result = await runTobyAnalysis(supabase, "manual");
      return {
        status: "completed",
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Reload cron scheduler after config changes
server.post<{ Body: Record<string, never> }>(
  "/cron/reload",
  async (_request, reply) => {
    try {
      await reloadCronScheduler();
      return { status: "reloaded" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  },
);

// Customer action webhook — detects update requests
server.post<{
  Body: { ticket_id: number; note: string; who?: string; hiddenfromuser?: boolean };
}>(
  "/webhook/action",
  async (request, reply) => {
    const parsed = webhookActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.issues });
    }
    const { ticket_id, note, hiddenfromuser } = parsed.data;

    // Only process customer-visible actions (not internal notes)
    if (hiddenfromuser) {
      return { status: "skipped", reason: "internal note" };
    }

    // Check if the customer is asking for an update
    if (isUpdateRequest(note)) {
      const supabase = createSupabaseClient();

      // Fire and forget — don't block the webhook response
      handleUpdateRequest(ticket_id, note, supabase).catch((err) => {
        console.error(
          `[WEBHOOK] Failed to handle update request for ticket #${ticket_id}:`,
          err,
        );
      });

      return { status: "update_request_detected", ticket_id };
    }

    return { status: "ok", detected: false };
  },
);

/**
 * On startup, fix tickets incorrectly marked as "triaged" without actual
 * triage results (caused by the pull-tickets status bug), then process
 * all tickets stuck in "pending" status.
 */
async function processPendingTickets(): Promise<void> {
  const supabase = createSupabaseClient();

  // ── Step 1: Reset falsely-triaged tickets ──
  // These were inserted with status "triaged" by the old pull-tickets bug
  try {
    const { data: markedTriaged } = await supabase
      .from("tickets")
      .select("id, halo_id, summary, triage_results(id)")
      .eq("status", "triaged");

    const falsyTriaged = (markedTriaged ?? []).filter(
      (t) => !t.triage_results || t.triage_results.length === 0,
    );

    if (falsyTriaged.length > 0) {
      const resetIds = falsyTriaged.map((t) => t.id);
      await supabase
        .from("tickets")
        .update({ status: "pending" as const })
        .in("id", resetIds);

      console.log(
        `[WORKER] Reset ${falsyTriaged.length} tickets from "triaged" to "pending" (no triage results found)`,
      );
    }
  } catch (err) {
    console.error("[WORKER] Failed to reset falsely-triaged tickets:", err);
  }

  // ── Step 2: Process all pending tickets ──
  const { data: pendingTickets, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[WORKER] Failed to scan pending tickets:", error);
    return;
  }

  if (!pendingTickets || pendingTickets.length === 0) {
    console.log("[WORKER] No pending tickets to process");
    return;
  }

  console.log(
    `[WORKER] Found ${pendingTickets.length} pending tickets — enqueuing for triage`,
  );

  for (const ticket of pendingTickets) {
    try {
      const jobId = await enqueueTriageJob({
        ticketId: ticket.id,
        haloId: ticket.halo_id,
        summary: ticket.summary,
      });
      console.log(
        `[WORKER] Enqueued pending ticket #${ticket.halo_id} (job: ${jobId})`,
      );
    } catch (err) {
      console.error(
        `[WORKER] Failed to enqueue ticket #${ticket.halo_id}:`,
        err,
      );
    }
  }
}

async function start() {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  // Start the BullMQ worker
  const worker = startTriageWorker();
  console.log("[WORKER] Triage worker started, waiting for jobs...");

  // Start the cron scheduler for daily re-triage
  await startCronScheduler();

  // Start Fastify
  await server.listen({ port, host });
  console.log(`[WORKER] Server listening on ${host}:${port}`);

  // Process any tickets stuck in pending (missed while worker was down)
  await processPendingTickets();

  // Retroactive SLA scan — catch any breaching tickets on startup
  scanForSlaBreaches().catch((err) => {
    console.error("[WORKER] Startup SLA scan failed:", err);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[WORKER] Shutting down...");
    stopCronScheduler();
    await worker.close();
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("[WORKER] Failed to start:", err);
  process.exit(1);
});
