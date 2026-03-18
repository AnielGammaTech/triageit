import Fastify from "fastify";
import { startTriageWorker } from "./queue/consumer.js";
import { createSupabaseClient } from "./db/supabase.js";
import { enqueueTriageJob } from "./queue/producer.js";
import {
  startCronScheduler,
  stopCronScheduler,
  triggerDailyRetriage,
} from "./cron/scheduler.js";
import {
  isUpdateRequest,
  handleUpdateRequest,
} from "./agents/retriage/update-request.js";

const server = Fastify({ logger: true });

// Health check
server.get("/health", async () => {
  return { status: "ok", service: "triageit-worker" };
});

// Manual triage trigger (for testing or re-processing)
server.post<{ Body: { ticket_id: string } }>(
  "/triage",
  async (request, reply) => {
    const { ticket_id } = request.body;

    if (!ticket_id) {
      return reply.status(400).send({ error: "ticket_id is required" });
    }

    const supabase = createSupabaseClient();
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, halo_id, summary")
      .eq("id", ticket_id)
      .single();

    if (!ticket) {
      return reply.status(404).send({ error: "Ticket not found" });
    }

    const jobId = await enqueueTriageJob({
      ticketId: ticket.id,
      haloId: ticket.halo_id,
      summary: ticket.summary,
    });

    return { status: "queued", job_id: jobId };
  },
);

// Manual daily re-triage trigger
server.post("/retriage", async (_request, reply) => {
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
});

// Customer action webhook — detects update requests
server.post<{
  Body: { ticket_id: number; note: string; who?: string; hiddenfromuser?: boolean };
}>(
  "/webhook/action",
  async (request, reply) => {
    const { ticket_id, note, hiddenfromuser } = request.body;

    if (!ticket_id || !note) {
      return reply.status(400).send({ error: "ticket_id and note are required" });
    }

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
 * On startup, scan for any tickets stuck in "pending" status.
 * These are tickets that came in while the worker was down.
 */
async function processPendingTickets(): Promise<void> {
  const supabase = createSupabaseClient();

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
  startCronScheduler();

  // Start Fastify
  await server.listen({ port, host });
  console.log(`[WORKER] Server listening on ${host}:${port}`);

  // Process any tickets stuck in pending (missed while worker was down)
  await processPendingTickets();

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
