import { Queue, Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "../queue/connection.js";
import { createSupabaseClient } from "../db/supabase.js";
import { runDailyScan } from "../agents/retriage/daily-scan.js";
import { scanForSlaBreaches } from "./sla-scan.js";
import { syncTicketsFromHalo } from "./ticket-sync.js";
import { runTobyAnalysis } from "../agents/workers/toby-flenderson.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

// ── BullMQ-based cron scheduler ─────────────────────────────────────
// Uses BullMQ repeatable jobs instead of node-cron.
// Repeat configs are stored in Redis, so they survive container restarts
// on Railway (unlike node-cron which dies with the process).

const CRON_QUEUE_NAME = "cron-jobs";

interface CronJobData {
  readonly endpoint: string;
  readonly name: string;
}

interface CronJobRecord {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly endpoint: string;
  readonly is_active: boolean;
  readonly last_run_at?: string | null;
}

/**
 * Estimate interval in ms from a cron pattern. Handles common patterns.
 */
function cronIntervalMs(pattern: string): number {
  // "0 */3 * * *" -> every 3 hours
  const hourlyMatch = /^\d+\s\*\/(\d+)\s/.exec(pattern);
  if (hourlyMatch) return parseInt(hourlyMatch[1], 10) * 60 * 60 * 1000;
  // "*/30 * * * *" -> every 30 minutes
  const minuteMatch = /^\*\/(\d+)\s/.exec(pattern);
  if (minuteMatch) return parseInt(minuteMatch[1], 10) * 60 * 1000;
  // "0 7 * * *" -> daily
  if (/^\d+\s\d+\s\*\s\*\s\*$/.test(pattern)) return 24 * 60 * 60 * 1000;
  // Default: 3 hours
  return 3 * 60 * 60 * 1000;
}

let cronQueue: Queue<CronJobData> | null = null;
let cronWorker: Worker<CronJobData> | null = null;

// Map of endpoint -> handler function
const ENDPOINT_HANDLERS: Record<string, () => Promise<void>> = {
  "/retriage": runDailyRetriage,
  "/sla-scan": runSlaScan,
  "/toby/analyze": runTobyAnalysisCron,
  "/ticket-sync": runTicketSync,
};

async function getTeamsConfig(): Promise<TeamsConfig | null> {
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  return data ? (data.config as TeamsConfig) : null;
}

async function updateJobStatus(
  jobId: string,
  status: "success" | "error",
  error?: string,
): Promise<void> {
  const supabase = createSupabaseClient();
  await supabase
    .from("cron_jobs")
    .update({
      last_run_at: new Date().toISOString(),
      last_status: status,
      last_error: error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function runTobyAnalysisCron(): Promise<void> {
  console.log("[CRON] Starting Toby's learning analysis");
  const supabase = createSupabaseClient();

  try {
    const result = await runTobyAnalysis(supabase, "daily");
    console.log(`[CRON] Toby analysis complete: ${result.summary}`);

    // Send Teams notification with Toby's findings
    const teamsConfig = await getTeamsConfig();
    if (teamsConfig && (result.trendsDetected > 0 || result.techProfilesUpdated > 0)) {
      const teams = new TeamsClient(teamsConfig);
      await teams.sendTobyReport(result);
    }
  } catch (err) {
    console.error("[CRON] Toby analysis failed:", err);
    throw err;
  }
}

async function runTicketSync(): Promise<void> {
  console.log("[CRON] Starting periodic ticket sync from Halo");
  const result = await syncTicketsFromHalo();
  console.log(
    `[CRON] Ticket sync complete: ${result.pulled} pulled, ${result.created} new, ${result.updated} updated`,
  );
}

async function runSlaScan(): Promise<void> {
  console.log(`[CRON] Starting SLA breach scan`);
  await scanForSlaBreaches();
  console.log(`[CRON] SLA breach scan complete`);
}

async function runDailyRetriage(): Promise<void> {
  console.log(`[CRON] Starting daily re-triage scan`);

  const supabase = createSupabaseClient();

  try {
    const result = await runDailyScan(supabase);

    console.log(
      `[CRON] Daily scan complete: ${result.totalOpen} open tickets, ` +
        `${result.critical.length} critical, ${result.warnings.length} warnings, ` +
        `${result.tokensUsed} tokens in ${result.processingTimeMs}ms`,
    );

    // Send Teams summary if configured
    const teamsConfig = await getTeamsConfig();
    if (teamsConfig) {
      const teams = new TeamsClient(teamsConfig);

      await teams.sendDailySummary({
        totalOpen: result.totalOpen,
        scanned: result.scanned,
        critical: result.critical,
        warnings: result.warnings,
        processingTimeMs: result.processingTimeMs,
      });

      // Send immediate alerts for critical customer-waiting tickets
      for (const ticket of result.critical) {
        if (ticket.flags.includes("customer_waiting")) {
          await teams.sendImmediateAlert(
            ticket,
            "Customer Reply > 24hrs — No Tech Response",
          );
        }
      }

      // Include recent tech performance concerns in Teams
      try {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        const { data: recentReviews } = await supabase
          .from("tech_reviews")
          .select("tech_name, halo_id, rating, response_time, max_gap_hours, improvement_areas, summary, tickets!inner(summary, client_name)")
          .in("rating", ["poor", "needs_improvement"])
          .gte("created_at", threeHoursAgo);

        if (recentReviews && recentReviews.length > 0) {
          await teams.sendTechPerformanceSummary(
            recentReviews.map((r) => ({
              techName: r.tech_name ?? "Unknown",
              haloId: r.halo_id,
              summary: ((r.tickets as unknown) as { summary: string })?.summary ?? "",
              clientName: ((r.tickets as unknown) as { client_name: string | null })?.client_name ?? null,
              rating: r.rating,
              responseTime: r.response_time ?? "unknown",
              maxGapHours: r.max_gap_hours ?? 0,
              improvementAreas: r.improvement_areas,
            })),
          );
          console.log(`[CRON] Sent ${recentReviews.length} tech performance concerns to Teams`);
        }
      } catch (err) {
        console.error("[CRON] Failed to send tech performance to Teams:", err);
      }

      console.log("[CRON] Teams notifications sent");
    } else {
      console.log("[CRON] Teams not configured — skipping notifications");
    }
  } catch (err) {
    console.error("[CRON] Daily re-triage failed:", err);
    throw err;
  }
}

/**
 * Process a cron job from the BullMQ queue.
 */
async function processCronJob(job: Job<CronJobData>): Promise<void> {
  const { endpoint, name } = job.data;

  console.log(`[CRON] Running "${name}" (${endpoint})`);

  const handler = ENDPOINT_HANDLERS[endpoint];
  if (!handler) {
    console.error(`[CRON] No handler for endpoint: ${endpoint}`);
    return;
  }

  // Find the DB record to update status
  const supabase = createSupabaseClient();
  const { data: dbJob } = await supabase
    .from("cron_jobs")
    .select("id")
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();

  try {
    await handler();
    if (dbJob) await updateJobStatus(dbJob.id, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CRON] Job "${name}" failed:`, message);
    if (dbJob) await updateJobStatus(dbJob.id, "error", message);
  }
}

/**
 * Start the BullMQ-based cron scheduler.
 * Reads job definitions from the cron_jobs table and registers them
 * as BullMQ repeatable jobs backed by Redis.
 */
export async function startCronScheduler(): Promise<void> {
  const connection = getRedisConnectionOptions();

  // Create the cron queue
  cronQueue = new Queue<CronJobData>(CRON_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });

  // Create the worker that processes cron jobs
  cronWorker = new Worker<CronJobData>(CRON_QUEUE_NAME, processCronJob, {
    connection,
    concurrency: 1, // Run one cron job at a time
  });

  cronWorker.on("ready", () => {
    console.log("[CRON] Worker connected to Redis and ready to process jobs");
  });

  cronWorker.on("completed", (job) => {
    console.log(`[CRON] Completed: ${job.data.name}`);
  });

  cronWorker.on("failed", (job, error) => {
    console.error(`[CRON] Failed: ${job?.data.name}:`, error.message);
  });

  cronWorker.on("error", (error) => {
    console.error("[CRON] Worker error:", error.message);
  });

  // Read job definitions from DB
  const supabase = createSupabaseClient();
  const { data: jobs, error } = await supabase
    .from("cron_jobs")
    .select("id, name, schedule, endpoint, is_active, last_run_at");

  if (error || !jobs || jobs.length === 0) {
    console.log(`[CRON] No cron_jobs found (error: ${error?.message ?? "none"}, rows: ${jobs?.length ?? 0}) — using default schedules`);
    await registerDefaultJobs(cronQueue);
    const defaults = await cronQueue.getRepeatableJobs();
    for (const rep of defaults) {
      const next = rep.next ? new Date(rep.next).toISOString() : "unknown";
      console.log(`[CRON] Verified default repeatable: "${rep.name}" pattern="${rep.pattern}" next=${next}`);
    }
    startHeartbeat();
    return;
  }

  const activeJobs = jobs.filter((j: CronJobRecord) => j.is_active);

  // Build a map of what SHOULD be registered
  const desiredRepeatables = new Map(
    activeJobs.map((j) => [`cron-${j.endpoint}`, { schedule: j.schedule, endpoint: j.endpoint, name: j.name }]),
  );

  // Check what's ALREADY registered in Redis
  const existingRepeatables = await cronQueue.getRepeatableJobs();
  const existingByName = new Map(existingRepeatables.map((r) => [r.name, r]));

  // Only remove/re-add repeatables that changed (schedule mismatch or removed)
  let removedCount = 0;
  for (const rep of existingRepeatables) {
    const desired = desiredRepeatables.get(rep.name);
    if (!desired || desired.schedule !== rep.pattern) {
      await cronQueue.removeRepeatableByKey(rep.key);
      removedCount++;
    }
  }

  let addedCount = 0;
  for (const [name, job] of desiredRepeatables) {
    const existing = existingByName.get(name);
    if (!existing || existing.pattern !== job.schedule) {
      await cronQueue.add(
        name,
        { endpoint: job.endpoint, name: job.name },
        { repeat: { pattern: job.schedule } },
      );
      addedCount++;
      console.log(`[CRON] Registered "${job.name}" — "${job.schedule}" -> ${job.endpoint} (BullMQ repeatable)`);
    } else {
      console.log(`[CRON] Kept existing "${job.name}" — "${job.schedule}" (unchanged)`);
    }
  }

  if (removedCount > 0) console.log(`[CRON] Removed ${removedCount} stale repeatables`);
  if (addedCount > 0) console.log(`[CRON] Added ${addedCount} new repeatables`);

  // Verify
  const registered = await cronQueue.getRepeatableJobs();
  for (const rep of registered) {
    const next = rep.next ? new Date(rep.next).toISOString() : "unknown";
    console.log(`[CRON] Verified repeatable: "${rep.name}" pattern="${rep.pattern}" next=${next}`);
  }

  // ── Catch-up: fire immediately if overdue ──
  // If a job's last_run_at is older than its interval, run it now.
  for (const job of activeJobs) {
    const lastRun = (job as CronJobRecord & { last_run_at?: string }).last_run_at;
    const intervalMs = cronIntervalMs(job.schedule);
    const overdueMs = intervalMs + 10 * 60 * 1000; // interval + 10 min grace

    if (!lastRun || Date.now() - new Date(lastRun).getTime() > overdueMs) {
      console.log(`[CRON] Catch-up: "${job.name}" overdue (last run: ${lastRun ?? "never"}) — firing immediately`);
      const handler = ENDPOINT_HANDLERS[job.endpoint];
      if (handler) {
        handler().then(() => {
          console.log(`[CRON] Catch-up complete: "${job.name}"`);
          updateJobStatus(job.id, "success");
        }).catch((err) => {
          console.error(`[CRON] Catch-up failed for "${job.name}":`, err);
          updateJobStatus(job.id, "error", (err as Error).message);
        });
      }
    }
  }

  startHeartbeat();
  console.log(`[CRON] BullMQ scheduler started with ${activeJobs.length} active jobs, ${registered.length} repeatables in Redis`);
}

/**
 * Register default cron jobs when the DB table is empty.
 */
async function registerDefaultJobs(queue: Queue<CronJobData>): Promise<void> {
  const defaults = [
    { endpoint: "/ticket-sync", name: "Halo Ticket Sync", schedule: "*/30 * * * *" }, // Every 30 minutes
    { endpoint: "/retriage", name: "Daily Re-Triage Scan", schedule: "0 */3 * * *" },
    { endpoint: "/sla-scan", name: "SLA Breach Scan", schedule: "0 */3 * * *" },
    { endpoint: "/toby/analyze", name: "Toby Learning Analysis", schedule: "0 7 * * *" }, // 2 AM ET = 7 AM UTC
  ];

  // Clear any stale state before registering defaults
  const stale = await queue.getRepeatableJobs();
  for (const rep of stale) {
    await queue.removeRepeatableByKey(rep.key);
  }
  await queue.drain();

  for (const job of defaults) {
    await queue.add(
      `cron-${job.endpoint}`,
      { endpoint: job.endpoint, name: job.name },
      { repeat: { pattern: job.schedule } },
    );
    console.log(`[CRON] Registered default "${job.name}" — "${job.schedule}" (BullMQ repeatable)`);
  }
}

export function stopCronScheduler(): void {
  if (cronWorker) {
    cronWorker.close();
    cronWorker = null;
  }
  if (cronQueue) {
    cronQueue.close();
    cronQueue = null;
  }

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Reload cron jobs from the database (e.g. after a config change from the UI).
 */
export async function reloadCronScheduler(): Promise<void> {
  stopCronScheduler();
  await startCronScheduler();
}

/**
 * Trigger a specific cron job by ID immediately (manual run from UI).
 */
export async function triggerCronJob(jobId: string): Promise<{ status: string; error?: string }> {
  const supabase = createSupabaseClient();

  const { data: job, error } = await supabase
    .from("cron_jobs")
    .select("id, name, schedule, endpoint, is_active")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return { status: "error", error: `Job not found: ${jobId}` };
  }

  const handler = ENDPOINT_HANDLERS[job.endpoint];
  if (!handler) {
    return { status: "error", error: `No handler for endpoint: ${job.endpoint}` };
  }

  try {
    await handler();
    await updateJobStatus(job.id, "success");
    return { status: "triggered" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJobStatus(job.id, "error", message);
    return { status: "error", error: message };
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function startHeartbeat(): void {
  if (heartbeatInterval) return;

  const beat = async () => {
    try {
      const supabase = createSupabaseClient();
      const repeatableCount = cronQueue ? (await cronQueue.getRepeatableJobs()).length : 0;
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            id: "worker-cron",
            last_heartbeat: new Date().toISOString(),
            active_jobs: repeatableCount,
          },
          { onConflict: "id" },
        );
    } catch {
      // Non-critical
    }
  };

  beat();
  heartbeatInterval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  console.log("[CRON] Heartbeat started (every 5m)");
}

// ── Missed Job Catch-up ──────────────────────────────────────────────

/**
 * With BullMQ repeatables, missed jobs are handled automatically by Redis.
 * This function is kept for compatibility but is mostly a no-op now.
 * BullMQ will fire the next scheduled run immediately if the previous was missed.
 */
export async function catchUpMissedJobs(): Promise<void> {
  console.log("[CRON] BullMQ handles missed job catch-up via Redis — no manual catch-up needed");
}

/**
 * Get cron scheduler health status for the /cron/status endpoint.
 */
export async function getCronStatus(): Promise<{
  readonly active: boolean;
  readonly jobCount: number;
  readonly heartbeat: string | null;
  readonly jobs: ReadonlyArray<{
    readonly name: string;
    readonly schedule: string;
    readonly lastRun: string | null;
    readonly lastStatus: string | null;
  }>;
}> {
  const supabase = createSupabaseClient();

  const [{ data: heartbeat }, { data: jobs }] = await Promise.all([
    supabase
      .from("cron_heartbeat")
      .select("last_heartbeat")
      .eq("id", "worker-cron")
      .maybeSingle(),
    supabase
      .from("cron_jobs")
      .select("name, schedule, last_run_at, last_status, is_active")
      .eq("is_active", true),
  ]);

  const repeatableCount = cronQueue ? (await cronQueue.getRepeatableJobs()).length : 0;

  return {
    active: repeatableCount > 0,
    jobCount: repeatableCount,
    heartbeat: heartbeat?.last_heartbeat ?? null,
    jobs: (jobs ?? []).map((j) => ({
      name: j.name,
      schedule: j.schedule,
      lastRun: j.last_run_at,
      lastStatus: j.last_status,
    })),
  };
}

// Manual trigger (from the /retriage endpoint)
export async function triggerDailyRetriage(): Promise<{
  totalOpen: number;
  critical: number;
  warnings: number;
  tokensUsed: number;
  processingTimeMs: number;
}> {
  const supabase = createSupabaseClient();
  const result = await runDailyScan(supabase);

  // Send Teams if configured
  const teamsConfig = await getTeamsConfig();
  if (teamsConfig) {
    const teams = new TeamsClient(teamsConfig);
    await teams.sendDailySummary({
      totalOpen: result.totalOpen,
      scanned: result.scanned,
      critical: result.critical,
      warnings: result.warnings,
      processingTimeMs: result.processingTimeMs,
    });

    for (const ticket of result.critical) {
      if (ticket.flags.includes("customer_waiting")) {
        await teams.sendImmediateAlert(
          ticket,
          "Customer Reply > 24hrs — No Tech Response",
        );
      }
    }
  }

  return {
    totalOpen: result.totalOpen,
    critical: result.critical.length,
    warnings: result.warnings.length,
    tokensUsed: result.tokensUsed,
    processingTimeMs: result.processingTimeMs,
  };
}
