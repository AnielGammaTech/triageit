import Fastify from "fastify";
import { startTriageWorker } from "./queue/consumer.js";
import { createSupabaseClient } from "./db/supabase.js";
import { enqueueTriageJob } from "./queue/producer.js";

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

async function start() {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  // Start the BullMQ worker
  const worker = startTriageWorker();
  console.log("[WORKER] Triage worker started, waiting for jobs...");

  // Start Fastify
  await server.listen({ port, host });
  console.log(`[WORKER] Server listening on ${host}:${port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[WORKER] Shutting down...");
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
