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
  catchUpMissedJobs,
  getCronStatus,
} from "./cron/scheduler.js";
import {
  isUpdateRequest,
  handleUpdateRequest,
} from "./agents/retriage/update-request.js";
import { scanForSlaBreaches } from "./cron/sla-scan.js";
import { syncTicketsFromHalo } from "./cron/ticket-sync.js";
import {
  triageSchema,
  cronTriggerSchema,
  webhookActionSchema,
} from "./validation/schemas.js";
import { MemoryManager } from "./memory/memory-manager.js";
import { runTobyAnalysis } from "./agents/workers/toby-flenderson.js";
import { investigateWithWorker } from "./agents/investigate.js";
import { generateCloseReview } from "./agents/manager/close-reviewer.js";
import { generateKbIdeas } from "./agents/manager/kb-ideas.js";
import { createAgent } from "./agents/registry.js";
import type { TriageContext } from "./agents/types.js";

const server = Fastify({ logger: true });
const TRIAGE_QUEUE_NAME = "triage";

// ── Teams Bot endpoint ────────────────────────────────────────────────
// Azure Bot Service sends activities here as JSON.
// Security: validate the Bearer token from Azure Bot Framework.
server.post("/api/teams/messages", async (request, reply) => {
  try {
    // Verify the request comes from Azure Bot Service
    const authHeader = (request.headers.authorization ?? "") as string;
    if (!authHeader.startsWith("Bearer ")) {
      console.warn("[TEAMS-BOT] Missing auth header — rejecting");
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const token = authHeader.slice(7);
    const { verifyBotToken, handleBotMessage } = await import("./integrations/teams/bot.js");

    const valid = await verifyBotToken(token);
    if (!valid) {
      console.warn("[TEAMS-BOT] Invalid token — rejecting");
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const activity = request.body as { type: string; text?: string; serviceUrl: string; conversation: { id: string }; id: string; from?: { name?: string } };
    // Fire and forget — respond 200 immediately, process async
    handleBotMessage(activity).catch((err) => {
      console.error("[TEAMS-BOT] Async error:", err);
    });
    return reply.status(200).send();
  } catch (err) {
    console.error("[TEAMS-BOT] Error:", err);
    return reply.status(200).send();
  }
});

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

// Error ticket scan — find tickets stuck in error status
server.post("/error-scan", async (_request, reply) => {
  try {
    const { scanForErrorTickets } = await import("./cron/error-ticket-scan.js");
    const result = await scanForErrorTickets();
    return { status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: message });
  }
});

// Response time alerts — manual trigger
server.post("/response-alerts", async (_request, reply) => {
  try {
    const { scanForResponseAlerts } = await import("./cron/response-alerts.js");
    const result = await scanForResponseAlerts();
    return { status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: message });
  }
});

// Weekly report — manual trigger
server.post("/weekly-report", async (_request, reply) => {
  try {
    const { generateWeeklyReport } = await import("./cron/weekly-report.js");
    const result = await generateWeeklyReport();
    return { status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: message });
  }
});

// Error retry — manual trigger
server.post("/error-retry", async (_request, reply) => {
  try {
    const { retryErroredTickets } = await import("./cron/error-retry.js");
    const result = await retryErroredTickets();
    return { status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: message });
  }
});

// Manual ticket sync from Halo
server.post<{ Body: Record<string, never> }>(
  "/ticket-sync",
  async (_request, reply) => {
    try {
      const result = await syncTicketsFromHalo();
      return { status: "completed", ...result };
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

// Failed jobs — inspect BullMQ queues for failed jobs
server.get("/health/failed-jobs", async () => {
  const { getRedisConnectionOptions } = await import("./queue/connection.js");
  const { Queue } = await import("bullmq");

  const connection = getRedisConnectionOptions();

  const triageQueue = new Queue(TRIAGE_QUEUE_NAME, { connection });
  const cronQueue = new Queue("cron-jobs", { connection });

  const [triageFailed, cronFailed] = await Promise.all([
    triageQueue.getFailed(0, 20),
    cronQueue.getFailed(0, 20),
  ]);

  const result = {
    triage: {
      failedCount: triageFailed.length,
      jobs: triageFailed.map((j) => ({
        id: j.id,
        name: j.name,
        failedReason: j.failedReason,
        timestamp: j.timestamp,
        data: j.data,
      })),
    },
    cron: {
      failedCount: cronFailed.length,
      jobs: cronFailed.map((j) => ({
        id: j.id,
        name: j.name,
        failedReason: j.failedReason,
        timestamp: j.timestamp,
        data: j.data,
      })),
    },
  };

  await triageQueue.close();
  await cronQueue.close();

  return result;
});

// Cron status — check if scheduler is alive and when jobs last ran
server.get("/cron/status", async () => {
  return getCronStatus();
});

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

// ── Worker investigation endpoint ─────────────────────────────────────
// Michael's chat can dispatch specialist workers to investigate things
// for a specific client. Each worker queries their integration directly.
server.post<{
  Body: { worker: string; client_name: string; question: string };
}>(
  "/worker/investigate",
  async (request, reply) => {
    const { worker, client_name, question } = request.body;
    if (!worker || !client_name) {
      return reply.status(400).send({ error: "worker and client_name are required" });
    }

    const supabase = createSupabaseClient();

    try {
      const result = await investigateWithWorker(supabase, worker, client_name, question);
      return { result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[INVESTIGATE] ${worker} failed for "${client_name}":`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── Close review endpoint ─────────────────────────────────────────────
// Generate a close-out review for a resolved ticket
server.post<{ Body: { halo_id: number } }>(
  "/close-review",
  async (request, reply) => {
    const { halo_id } = request.body;
    if (!halo_id) {
      return reply.status(400).send({ error: "halo_id is required" });
    }

    const supabase = createSupabaseClient();

    try {
      const { review } = await generateCloseReview(halo_id, supabase);
      return { status: "completed", review };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CLOSE-REVIEW] Failed for ticket #${halo_id}:`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── Agent invoke endpoint ─────────────────────────────────────────────
// Run a specific agent on a ticket on demand
server.post<{ Body: { halo_id: number; agent_name: string; prompt?: string } }>(
  "/agent/invoke",
  async (request, reply) => {
    const { halo_id, agent_name, prompt } = request.body;
    if (!halo_id || !agent_name) {
      return reply.status(400).send({ error: "halo_id and agent_name are required" });
    }

    const supabase = createSupabaseClient();

    try {
      // Look up ticket
      const { data: ticket } = await supabase
        .from("tickets")
        .select("*")
        .eq("halo_id", halo_id)
        .single();

      if (!ticket) {
        return reply.status(404).send({ error: `Ticket #${halo_id} not found` });
      }

      // Build context
      const context: TriageContext = {
        ticketId: ticket.id,
        haloId: ticket.halo_id,
        summary: prompt ? `${ticket.summary}\n\nAdditional context: ${prompt}` : ticket.summary,
        details: ticket.details,
        clientName: ticket.client_name,
        clientId: ticket.client_id,
        userName: ticket.user_name,
        userEmail: ticket.user_email,
        originalPriority: ticket.original_priority,
      };

      // Create and run the agent
      const agent = createAgent(agent_name, supabase);
      if (!agent) {
        return reply.status(400).send({ error: `Unknown agent: ${agent_name}` });
      }

      console.log(`[AGENT-INVOKE] Running ${agent_name} on ticket #${halo_id}`);
      const result = await agent.execute(context);

      return {
        status: "completed",
        agent_name,
        halo_id,
        summary: result.summary,
        data: result.data,
        confidence: result.confidence,
        memories_used: result.memories_used,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AGENT-INVOKE] ${agent_name} failed for #${halo_id}:`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── KB Ideas endpoint ─────────────────────────────────────────────────
server.post<{ Body: { halo_id: number } }>(
  "/kb-ideas",
  async (request, reply) => {
    const { halo_id } = request.body;
    if (!halo_id) {
      return reply.status(400).send({ error: "halo_id is required" });
    }

    const supabase = createSupabaseClient();

    try {
      const result = await generateKbIdeas(halo_id, supabase);
      return { status: "completed", ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[KB-IDEAS] Failed for ticket #${halo_id}:`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── KB Refine endpoint — takes an idea + tech's answers, returns polished article
server.post<{
  Body: {
    halo_id: number;
    idea: { title: string; category: string; content: string; hudu_section: string; needs_info: string[] };
    answers: Record<string, string>;
  };
}>(
  "/kb-ideas/refine",
  async (request, reply) => {
    const { halo_id, idea, answers } = request.body;
    if (!halo_id || !idea) {
      return reply.status(400).send({ error: "halo_id and idea are required" });
    }

    const supabase = createSupabaseClient();

    try {
      const { refineKbArticle } = await import("./agents/manager/kb-ideas.js");
      const result = await refineKbArticle(halo_id, idea, answers, supabase);
      return { status: "completed", article: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[KB-REFINE] Failed for ticket #${halo_id}:`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── Create Hudu article endpoint ──────────────────────────────────────
server.post<{ Body: { client_name: string; title: string; content: string; company_id?: number } }>(
  "/hudu/create-article",
  async (request, reply) => {
    const { client_name, title, content, company_id } = request.body;
    if (!title || !content) {
      return reply.status(400).send({ error: "title and content are required" });
    }

    const supabase = createSupabaseClient();

    const { data: huduIntegration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "hudu")
      .eq("is_active", true)
      .single();

    if (!huduIntegration) {
      return reply.status(400).send({ error: "Hudu not configured" });
    }

    try {
      const { HuduClient } = await import("./integrations/hudu/client.js");
      const hudu = new HuduClient(huduIntegration.config as import("@triageit/shared").HuduConfig);

      // Find company ID if not provided
      let resolvedCompanyId = company_id;
      if (!resolvedCompanyId && client_name) {
        const companies = await hudu.searchCompanies(client_name);
        resolvedCompanyId = companies[0]?.id;
      }

      const article = await hudu.createArticle({
        name: title,
        content,
        company_id: resolvedCompanyId,
      });

      return { status: "created", article: { id: article.id, name: article.name, url: article.url } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[HUDU] Failed to create article:`, message);
      return reply.status(500).send({ error: message });
    }
  },
);

// ── Triage feedback endpoints ────────────────────────────────────────

// Submit feedback on a triage result
server.post<{
  Body: {
    triage_result_id: string;
    ticket_id: string;
    rating: "helpful" | "not_helpful";
    classification_accurate?: boolean;
    priority_accurate?: boolean;
    recommendations_useful?: boolean;
    comment?: string;
    submitted_by?: string;
  };
}>("/feedback", async (request, reply) => {
  const { triage_result_id, ticket_id, rating, ...rest } = request.body;
  if (!triage_result_id || !ticket_id || !rating) {
    return reply.status(400).send({ error: "triage_result_id, ticket_id, and rating are required" });
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("triage_feedback")
    .insert({
      triage_result_id,
      ticket_id,
      rating,
      ...rest,
    })
    .select("id")
    .single();

  if (error) {
    return reply.status(500).send({ error: error.message });
  }

  return { status: "saved", id: data.id };
});

// Get feedback for a specific ticket
server.get<{ Params: { ticketId: string } }>(
  "/feedback/:ticketId",
  async (request, reply) => {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("triage_feedback")
      .select("*")
      .eq("ticket_id", request.params.ticketId)
      .order("created_at", { ascending: false });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return { feedback: data ?? [] };
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

  // ── Backpressure: skip if queue is already busy ──
  const { Queue } = await import("bullmq");
  const { getRedisConnectionOptions } = await import("./queue/connection.js");
  const triageQueue = new Queue(TRIAGE_QUEUE_NAME, { connection: getRedisConnectionOptions() });
  const waitingCount = await triageQueue.getWaitingCount();
  await triageQueue.close();

  if (waitingCount > 20) {
    console.log(`[WORKER] Queue already has ${waitingCount} waiting jobs — skipping pending ticket reprocessing`);
    return;
  }

  // Cap at remaining capacity
  const maxToEnqueue = Math.max(0, 30 - waitingCount);
  const ticketsToProcess = pendingTickets.slice(0, maxToEnqueue);

  console.log(
    `[WORKER] Found ${pendingTickets.length} pending tickets, enqueuing ${ticketsToProcess.length} (queue has ${waitingCount} waiting)`,
  );

  for (const ticket of ticketsToProcess) {
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

async function testRedisConnection(): Promise<boolean> {
  const { getRedisConnectionOptions } = await import("./queue/connection.js");
  const { default: Redis } = await import("ioredis");

  const opts = getRedisConnectionOptions();
  console.log(`[WORKER] Testing Redis connection: ${opts.host}:${opts.port}`);

  const redis = new Redis({
    host: opts.host,
    port: opts.port,
    username: opts.username,
    password: opts.password,
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log(`[WORKER] Redis connected — PING: ${pong}`);
    await redis.quit();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] Redis connection FAILED: ${message}`);
    await redis.quit().catch(() => {});
    return false;
  }
}

async function start() {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  // ── Step 1: Test Redis before anything else ──
  const redisOk = await testRedisConnection();
  if (!redisOk) {
    console.error("[WORKER] Cannot start without Redis — check REDIS_URL env var");
    process.exit(1);
  }

  // ── Step 2: Start BullMQ triage worker ──
  const worker = startTriageWorker();
  console.log("[WORKER] Triage worker started, waiting for jobs...");

  // ── Step 3: Start Fastify FIRST (so health checks pass on Railway) ──
  await server.listen({ port, host });
  console.log(`[WORKER] Server listening on ${host}:${port}`);

  // ── Step 4: Start cron scheduler (non-blocking — don't hang startup) ──
  try {
    await startCronScheduler();
    const status = await getCronStatus();
    console.log(`[WORKER] Cron scheduler initialized — ${status.jobCount} repeatable jobs in Redis`);
    for (const job of status.jobs) {
      console.log(`[WORKER]   → ${job.name}: ${job.schedule} (last: ${job.lastRun ?? "never"}, status: ${job.lastStatus ?? "none"})`);
    }
    if (status.jobCount === 0) {
      console.warn("[WORKER] WARNING: No cron jobs registered in Redis! Check cron_jobs table or defaults.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] Cron scheduler failed to start: ${message}`);
    // Continue running — manual triggers still work via API
  }

  // ── Step 5: Background tasks — don't block server ──
  processPendingTickets().catch((err) => {
    console.error("[WORKER] Pending ticket processing failed:", err);
  });

  catchUpMissedJobs().catch((err) => {
    console.error("[WORKER] Cron catch-up failed:", err);
  });

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
