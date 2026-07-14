import { Queue, Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { getRedisConnectionOptions } from "../queue/connection.js";
import { createSupabaseClient } from "../db/supabase.js";
import { runDailyScan } from "../agents/retriage/daily-scan.js";
import { scanForSlaBreaches } from "./sla-scan.js";
import { runSlaCallRequests } from "./sla-call.js";
import { syncTicketsFromHalo } from "./ticket-sync.js";
import { scanWorkflowState } from "./workflow-scan.js";
import { scanForErrorTickets } from "./error-ticket-scan.js";
import { scanForResponseAlerts } from "./response-alerts.js";
import { generateWeeklyReport } from "./weekly-report.js";
import { retryErroredTickets } from "./error-retry.js";
import { runCallAnalysis } from "./call-analysis.js";
import { runIntegrationHeartbeat } from "./integration-heartbeat.js";
import { runScheduleSync } from "../dispatch/schedule-sync.js";
import { scanTicketResponseCompliance } from "./ticket-response-compliance.js";
import { runTobyAnalysis } from "../agents/workers/toby-flenderson.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

// ── BullMQ-based cron scheduler ─────────────────────────────────────
// Uses BullMQ repeatable jobs instead of node-cron.
// Repeat configs are stored in Redis, so they survive container restarts
// on Railway (unlike node-cron which dies with the process).
//
// Default schedules (configured in cron_jobs DB table):
// - /retriage: */30 * * * * (every 30 min — urgency-based timer decides which tickets to process)
// - /sla-scan: */3 * * * * (tight tick = fast breach detection for the Command board; alerts stay time-gated inside the scan)
// - /toby/analyze: 0 2 * * * (daily at 2 AM ET — worker runs with TZ=America/New_York, so patterns are ET-local)
// - /ticket-sync: * * * * * (every minute)
// - /workflow-scan: */15 * * * * (every 15 minutes)
// - /integration-heartbeat: */5 * * * * (every 5 minutes)

const CRON_QUEUE_NAME = "cron-jobs";

interface CronJobData {
  readonly endpoint: string;
  readonly name: string;
  readonly source?: "scheduled" | "catch_up";
}

interface CronJobRecord {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly endpoint: string;
  readonly is_active: boolean;
  readonly last_run_at?: string | null;
}

type WorkerRunSource = "scheduled" | "manual" | "catch_up";

interface TrackedCronJob {
  readonly id: string | null;
  readonly name: string;
  readonly endpoint: string;
}

interface WorkerRunRecord {
  readonly id: string;
  readonly job_name: string;
  readonly endpoint: string;
  readonly source: WorkerRunSource;
  readonly status: "running" | "success" | "error" | "skipped";
  readonly worker_instance: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly duration_ms: number | null;
  readonly error: string | null;
}

interface RequiredCronJob {
  readonly name: string;
  readonly description: string;
  readonly schedule: string;
  readonly endpoint: string;
}

const REQUIRED_SYSTEM_CRON_JOBS: RequiredCronJob[] = [
  {
    name: "Halo Ticket Sync",
    description: "Syncs open tickets from Halo every minute so new customer work enters triage quickly.",
    schedule: "* * * * *",
    endpoint: "/ticket-sync",
  },
  {
    name: "Ticket Response Compliance",
    description: "Tracks the 30-minute customer acknowledgment and one-business-hour assigned-tech email clocks.",
    schedule: "* * * * *",
    endpoint: "/ticket-response-compliance",
  },
  {
    name: "SLA Breach Scan",
    description: "Confirms live SLA breaches against Halo and maintains sla_currently_breached for the Command board. Alert cadence is time-gated inside the scan (10-min grace, hourly re-alerts), so the tight tick only speeds up detection.",
    schedule: "*/3 * * * *",
    endpoint: "/sla-scan",
  },
  {
    name: "Integration Heartbeat",
    description: "Checks configured integrations and stores health status for Adminland and worker routing.",
    schedule: "*/5 * * * *",
    endpoint: "/integration-heartbeat",
  },
  {
    name: "Error Ticket Retry",
    description: "Re-enqueues open tickets stuck in error status (3 attempts, then permanent-failure escalation).",
    schedule: "*/30 * * * *",
    endpoint: "/error-retry",
  },
  {
    name: "Call Analysis",
    description: "Matches new 3CX call recordings to open tickets and posts a private Call Summary note from the transcript.",
    schedule: "* * * * *",
    endpoint: "/call-analysis",
  },
  {
    name: "Response Time Alerts",
    description: "Scans open tickets for customer replies awaiting a tech response and escalates via Teams.",
    schedule: "*/15 * * * *",
    endpoint: "/response-alerts",
  },
  {
    name: "Error Ticket Scan",
    description: "Hourly sweep for tickets stuck in triaging or error states so nothing silently stalls.",
    schedule: "0 */1 * * *",
    endpoint: "/error-scan",
  },
  {
    name: "Weekly Team Report",
    description: "Monday 8 AM ET team report card posted to Teams.",
    schedule: "0 8 * * 1",
    endpoint: "/weekly-report",
  },
  {
    name: "Memory Eviction",
    description: "Nightly cleanup of stale agent memories to keep recall sharp.",
    schedule: "0 3 * * *",
    endpoint: "/memory/evict",
  },
  {
    name: "Schedule Sync (Halo -> Outlook)",
    description: "Mirrors Halo scheduled appointments onto each tech's Outlook calendar (create-only, TriageIT-tagged) so techs always see their schedule in Outlook.",
    schedule: "*/30 7-17 * * 1-5", // every 30 min, 7:00-17:30 ET weekdays (worker TZ is America/New_York)
    endpoint: "/schedule-sync",
  },
];

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
  // "* * * * *" -> every minute
  if (/^\*\s/.test(pattern)) return 60 * 1000;
  // "0 7 * * *" -> daily
  if (/^\d+\s\d+\s\*\s\*\s\*$/.test(pattern)) return 24 * 60 * 60 * 1000;
  // "0 8 * * 1" -> weekly (specific day-of-week). Falling through to the
  // 3-hour default made the startup catch-up treat the weekly report as
  // 3-hourly — a full weekly Teams report posted on every deploy from
  // Monday 11 AM onward, while the redundant-run guard could skip the
  // real Monday run.
  if (/^\d+\s\d+\s\*\s\*\s[\d,-]+$/.test(pattern)) return 7 * 24 * 60 * 60 * 1000;
  // Default: 3 hours
  return 3 * 60 * 60 * 1000;
}

let cronQueue: Queue<CronJobData> | null = null;
let cronWorker: Worker<CronJobData> | null = null;
const activeEndpoints = new Set<string>();
const WORKER_INSTANCE =
  process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local";
const ENDPOINT_LOCK_TTL_MS = 30 * 60 * 1000;
const ENDPOINT_LOCK_RENEW_MS = 60 * 1000;

interface EndpointLock {
  readonly acquired: boolean;
  readonly release: () => Promise<void>;
}

async function acquireEndpointLock(endpoint: string): Promise<EndpointLock> {
  if (!cronQueue) return { acquired: true, release: async () => undefined };

  const key = `triageit:cron-lock:${endpoint}`;
  const token = `${WORKER_INSTANCE}:${randomUUID()}`;
  try {
    // BullMQ exposes a deliberately narrow client interface, but the backing
    // client is IORedis and supports the atomic lease commands used here.
    const redis = await cronQueue.client as unknown as Redis;
    const acquired = await redis.set(key, token, "PX", ENDPOINT_LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
      return { acquired: false, release: async () => undefined };
    }

    const renew = setInterval(() => {
      void redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        token,
        String(ENDPOINT_LOCK_TTL_MS),
      ).catch((error: unknown) => {
        console.warn(`[CRON] Failed to renew distributed lock for ${endpoint}:`, error);
      });
    }, ENDPOINT_LOCK_RENEW_MS);
    renew.unref();

    return {
      acquired: true,
      release: async () => {
        clearInterval(renew);
        try {
          await redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            key,
            token,
          );
        } catch (error) {
          console.warn(`[CRON] Failed to release distributed lock for ${endpoint}:`, error);
        }
      },
    };
  } catch (error) {
    // BullMQ already depends on Redis; a temporary lock call failure should be
    // visible but local endpoint locking can still prevent same-process overlap.
    console.warn(`[CRON] Distributed lock unavailable for ${endpoint}; using local lock:`, error);
    return { acquired: true, release: async () => undefined };
  }
}

// Map of endpoint -> handler function
const ENDPOINT_HANDLERS: Record<string, () => Promise<void>> = {
  "/retriage": runDailyRetriage,
  "/sla-scan": runSlaScan,
  "/sla-call-requests": async () => {
    await runSlaCallRequests();
  },
  "/toby/analyze": runTobyAnalysisCron,
  "/ticket-sync": runTicketSync,
  "/ticket-response-compliance": runTicketResponseCompliance,
  "/integration-heartbeat": runIntegrationHeartbeatCron,
  "/workflow-scan": runWorkflowScan,
  "/memory/evict": runMemoryEviction,
  "/error-scan": runErrorScan,
  "/response-alerts": runResponseAlerts,
  "/weekly-report": runWeeklyReport,
  "/error-retry": runErrorRetry,
  "/call-analysis": runCallAnalysisCron,
  "/schedule-sync": runScheduleSyncCron,
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
      // Only update last_run_at on success — errors should NOT reset the clock
      // so catch-up logic can detect missed runs after restart
      ...(status === "success" ? { last_run_at: new Date().toISOString() } : {}),
      last_status: status,
      last_error: error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function createWorkerRun(
  job: TrackedCronJob,
  source: WorkerRunSource,
  status: "running" | "skipped",
  bullmqJobId?: string,
  error?: string,
): Promise<string | null> {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const { data, error: insertError } = await supabase
    .from("worker_runs")
    .insert({
      job_id: job.id,
      job_name: job.name,
      endpoint: job.endpoint,
      source,
      status,
      bullmq_job_id: bullmqJobId ?? null,
      worker_instance: WORKER_INSTANCE,
      started_at: now,
      ...(status === "skipped"
        ? { finished_at: now, duration_ms: 0, error: error ?? "Skipped" }
        : {}),
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(`[CRON] Failed to create run record for "${job.name}": ${insertError.message}`);
    return null;
  }
  return data.id as string;
}

async function finishWorkerRun(
  runId: string | null,
  status: "success" | "error",
  startedAtMs: number,
  error?: string,
): Promise<void> {
  if (!runId) return;
  const supabase = createSupabaseClient();
  const { error: updateError } = await supabase
    .from("worker_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      error: error ?? null,
    })
    .eq("id", runId);

  if (updateError) {
    console.error(`[CRON] Failed to finish run record ${runId}: ${updateError.message}`);
  }
}

async function runTrackedCronJob(
  job: TrackedCronJob,
  handler: () => Promise<void>,
  source: WorkerRunSource,
  bullmqJobId?: string,
): Promise<"success" | "skipped"> {
  if (activeEndpoints.has(job.endpoint)) {
    console.warn(`[CRON] Skipping overlapping "${job.name}" — ${job.endpoint} is already running`);
    await createWorkerRun(job, source, "skipped", bullmqJobId, "Endpoint already running");
    return "skipped";
  }

  activeEndpoints.add(job.endpoint);
  const endpointLock = await acquireEndpointLock(job.endpoint);
  if (!endpointLock.acquired) {
    activeEndpoints.delete(job.endpoint);
    console.warn(`[CRON] Skipping overlapping "${job.name}" — another worker owns ${job.endpoint}`);
    await createWorkerRun(job, source, "skipped", bullmqJobId, "Endpoint is running on another worker instance");
    return "skipped";
  }
  const startedAtMs = Date.now();
  const runId = await createWorkerRun(job, source, "running", bullmqJobId);

  try {
    await handler();
    if (job.id) await updateJobStatus(job.id, "success");
    await finishWorkerRun(runId, "success", startedAtMs);
    return "success";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.id) await updateJobStatus(job.id, "error", message);
    await finishWorkerRun(runId, "error", startedAtMs, message);
    throw err;
  } finally {
    await endpointLock.release();
    activeEndpoints.delete(job.endpoint);
  }
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

async function runTicketResponseCompliance(): Promise<void> {
  const result = await scanTicketResponseCompliance();
  console.log(
    `[CRON] Response compliance: ${result.tracked} tracked, ${result.dispatcherMisses} dispatcher misses, ${result.ptoExemptions} PTO exemptions, ${result.technicianMisses} technician misses, ${result.approvalsStaged} approvals staged`,
  );
}

async function runIntegrationHeartbeatCron(): Promise<void> {
  console.log("[CRON] Starting integration heartbeat");
  const result = await runIntegrationHeartbeat();
  console.log(
    `[CRON] Integration heartbeat complete: ${result.checked} checked, ${result.healthy} healthy, ${result.degraded} degraded, ${result.down} down`,
  );
}

async function runWorkflowScan(): Promise<void> {
  console.log("[CRON] Starting workflow consistency scan");
  const result = await scanWorkflowState();
  console.log(
    `[CRON] Workflow scan complete: ${result.checked} checked, ${result.issues} issues, ${result.eventsLogged} events logged, ${result.haloPrivateNotesPosted} private Halo notes`,
  );
}

async function runMemoryEviction(): Promise<void> {
  console.log("[CRON] Starting memory eviction");
  const supabase = createSupabaseClient();
  const { MemoryManager } = await import("../memory/memory-manager.js");
  const memoryManager = new MemoryManager(supabase);
  const evicted = await memoryManager.evictStaleMemories({});
  console.log(`[CRON] Memory eviction complete: ${evicted} memories pruned`);
}

async function runErrorScan(): Promise<void> {
  const result = await scanForErrorTickets();
  console.log(`[CRON] Error scan: ${result.found} found, ${result.alerted} alerted`);
}

async function runResponseAlerts(): Promise<void> {
  const result = await scanForResponseAlerts();
  console.log(`[CRON] Response alerts: ${result.warnings} warnings, ${result.escalations} escalations`);
}

async function runWeeklyReport(): Promise<void> {
  console.log("[CRON] Generating weekly team report card");
  const result = await generateWeeklyReport();
  console.log(`[CRON] Weekly report: ${result.totalTickets} opened, ${result.closedTickets} closed, ${result.techScores.length} techs scored`);
}

async function runErrorRetry(): Promise<void> {
  const result = await retryErroredTickets();
  console.log(`[CRON] Error retry: ${result.retried} retried, ${result.escalated} escalated`);
}

async function runCallAnalysisCron(): Promise<void> {
  const result = await runCallAnalysis();
  console.log(`[CRON] Call analysis: ${result.checked} recordings, ${result.matched} matched, ${result.notesPosted} notes posted`);
}

async function runScheduleSyncCron(): Promise<void> {
  console.log("[CRON] Starting Halo -> Outlook schedule sync");
  const result = await runScheduleSync();
  console.log(
    `[CRON] Schedule sync complete: ${result.checked} checked, ${result.created} created, ${result.failures} failures`,
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

async function reconcileRequiredSystemCronJobs(
  jobs: CronJobRecord[],
): Promise<CronJobRecord[]> {
  const supabase = createSupabaseClient();
  const reconciled = [...jobs];

  for (const required of REQUIRED_SYSTEM_CRON_JOBS) {
    const index = reconciled.findIndex((job) => job.endpoint === required.endpoint);
    const existing = index >= 0 ? reconciled[index] : null;

    if (existing) {
      const changed =
        existing.name !== required.name ||
        existing.schedule !== required.schedule ||
        existing.endpoint !== required.endpoint ||
        !existing.is_active;

      if (changed) {
        const { error } = await supabase
          .from("cron_jobs")
          .update({
            name: required.name,
            description: required.description,
            schedule: required.schedule,
            endpoint: required.endpoint,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) {
          console.error(`[CRON] Failed to reconcile "${required.name}": ${error.message}`);
        } else {
          console.log(`[CRON] Reconciled required "${required.name}" — "${required.schedule}"`);
        }

        reconciled[index] = {
          ...existing,
          name: required.name,
          schedule: required.schedule,
          endpoint: required.endpoint,
          is_active: true,
        };
      }
      continue;
    }

    const { data, error } = await supabase
      .from("cron_jobs")
      .insert({
        name: required.name,
        description: required.description,
        schedule: required.schedule,
        endpoint: required.endpoint,
        is_active: true,
      })
      .select("id, name, schedule, endpoint, is_active, last_run_at")
      .single();

    if (error || !data) {
      console.error(`[CRON] Failed to create required "${required.name}": ${error?.message ?? "no row returned"}`);
      reconciled.push({
        id: `required:${required.endpoint}`,
        name: required.name,
        schedule: required.schedule,
        endpoint: required.endpoint,
        is_active: true,
        last_run_at: null,
      });
      continue;
    }

    console.log(`[CRON] Created required "${required.name}" — "${required.schedule}"`);
    reconciled.push(data as CronJobRecord);
  }

  return reconciled;
}

/**
 * Process a cron job from the BullMQ queue.
 */
async function processCronJob(job: Job<CronJobData>): Promise<void> {
  const { endpoint, name } = job.data;
  const source = job.data.source ?? "scheduled";

  const handler = ENDPOINT_HANDLERS[endpoint];
  if (!handler) {
    console.error(`[CRON] No handler for endpoint: ${endpoint}`);
    return;
  }

  // Find the DB record to update status
  const supabase = createSupabaseClient();
  const { data: dbJob } = await supabase
    .from("cron_jobs")
    .select("id, schedule, last_run_at")
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();

  // Redundant-run guard: deploy catch-ups and backlog can stack several
  // copies of the same endpoint in the queue. If this endpoint already ran
  // successfully within 60% of its interval, this copy adds nothing — skip.
  if (dbJob?.last_run_at && dbJob.schedule) {
    const sinceLastRun = Date.now() - new Date(dbJob.last_run_at).getTime();
    if (sinceLastRun < cronIntervalMs(dbJob.schedule) * 0.6) {
      console.log(`[CRON] Skipping redundant "${name}" — ran ${Math.round(sinceLastRun / 1000)}s ago`);
      await createWorkerRun(
        { id: dbJob.id, name, endpoint },
        source,
        "skipped",
        String(job.id ?? ""),
        "Recent successful run made this queue item redundant",
      );
      return;
    }
  }

  console.log(`[CRON] Running "${name}" (${endpoint})`);

  try {
    await runTrackedCronJob(
      { id: dbJob?.id ?? null, name, endpoint },
      handler,
      source,
      String(job.id ?? ""),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CRON] Job "${name}" failed:`, message);
    throw err; // Re-throw so BullMQ sees the failure and retries
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
    // Cron handlers are I/O-bound (Halo/Datto/AI API calls) and some run for
    // minutes. Separate endpoint locking prevents duplicate work while eight
    // slots keep slow jobs from starving the every-minute ticket sync.
    concurrency: 8,
    // Handlers legitimately run for minutes (daily scan ~100s+). The default
    // 30s lock meant any Redis hiccup or event-loop stall marked running jobs
    // stalled — they were killed mid-run ("could not renew lock" /
    // "failed: terminated") and re-fired. One worker process owns this queue,
    // so a long lock costs nothing.
    lockDuration: 300_000,
    maxStalledCount: 2,
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

  const reconciledJobs = await reconcileRequiredSystemCronJobs(jobs as CronJobRecord[]);
  const activeJobs = reconciledJobs.filter((j: CronJobRecord) => j.is_active);

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

    // A repeatable whose next fire time is in the past has a BROKEN repeat
    // chain: BullMQ schedules the next iteration when the current one is
    // processed, so a worker killed mid-job (e.g. a deploy) leaves the
    // repeatable metadata in Redis with no delayed job behind it — it never
    // fires again even though it "exists". Re-seed it.
    const chainBroken =
      existing !== undefined &&
      (!existing.next || existing.next < Date.now() - 60_000);

    if (!existing || existing.pattern !== job.schedule || chainBroken) {
      if (existing && chainBroken) {
        await cronQueue.removeRepeatableByKey(existing.key);
        console.log(`[CRON] Re-seeding "${job.name}" — repeat chain broken (next was ${existing.next ? new Date(existing.next).toISOString() : "missing"})`);
      }
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
      console.log(`[CRON] Catch-up: "${job.name}" overdue (last run: ${lastRun ?? "never"}) — queueing now`);
      if (Object.hasOwn(ENDPOINT_HANDLERS, job.endpoint)) {
        await cronQueue.add(
          `catchup-${job.endpoint}`,
          { endpoint: job.endpoint, name: job.name, source: "catch_up" },
          { jobId: `catchup-${job.endpoint.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}` },
        );
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
    { endpoint: "/ticket-sync", name: "Halo Ticket Sync", schedule: "* * * * *" }, // Every minute
    { endpoint: "/ticket-response-compliance", name: "Ticket Response Compliance", schedule: "* * * * *" },
    { endpoint: "/integration-heartbeat", name: "Integration Heartbeat", schedule: "*/5 * * * *" }, // Every 5 minutes
    { endpoint: "/workflow-scan", name: "Workflow Guardrail Scan", schedule: "*/15 * * * *" }, // Every 15 minutes
    { endpoint: "/retriage", name: "Daily Re-Triage Scan", schedule: "*/30 * * * *" }, // Every 30 min (urgency timers decide which tickets to process)
    { endpoint: "/sla-scan", name: "SLA Breach Scan", schedule: "*/3 * * * *" },
    { endpoint: "/toby/analyze", name: "Toby Learning Analysis", schedule: "0 2 * * *" }, // 2 AM ET (worker TZ is America/New_York)
    { endpoint: "/memory/evict", name: "Memory Eviction", schedule: "0 3 * * *" }, // 3 AM ET
    { endpoint: "/error-scan", name: "Error Ticket Scan", schedule: "0 */1 * * *" }, // Every hour
    { endpoint: "/response-alerts", name: "Response Time Alerts", schedule: "*/15 * * * *" }, // Every 15 minutes
    { endpoint: "/weekly-report", name: "Weekly Team Report", schedule: "0 8 * * 1" }, // Monday 8 AM ET
    { endpoint: "/error-retry", name: "Error Ticket Retry", schedule: "*/30 * * * *" }, // Every 30 minutes
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
    const result = await runTrackedCronJob(
      { id: job.id, name: job.name, endpoint: job.endpoint },
      handler,
      "manual",
    );
    return { status: result === "skipped" ? "already_running" : "triggered" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", error: message };
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WORKER_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WORKER_RUN_MAINTENANCE_MS = 6 * 60 * 60 * 1000;
let lastWorkerRunMaintenanceAt = 0;

async function maintainWorkerRunHistory(): Promise<void> {
  if (!cronQueue || Date.now() - lastWorkerRunMaintenanceAt < WORKER_RUN_MAINTENANCE_MS) return;

  const supabase = createSupabaseClient();
  const redis = await cronQueue.client as unknown as Redis;
  const staleBefore = new Date(Date.now() - ENDPOINT_LOCK_TTL_MS).toISOString();
  const { data: staleRuns, error: staleError } = await supabase
    .from("worker_runs")
    .select("id, endpoint, started_at")
    .eq("status", "running")
    .lt("started_at", staleBefore)
    .limit(100);

  if (staleError) {
    console.warn(`[CRON] Could not inspect stale worker runs: ${staleError.message}`);
  } else {
    for (const run of staleRuns ?? []) {
      const hasLease = await redis.exists(`triageit:cron-lock:${run.endpoint}`);
      if (hasLease) continue;
      const finishedAt = new Date();
      await supabase
        .from("worker_runs")
        .update({
          status: "error",
          finished_at: finishedAt.toISOString(),
          duration_ms: Math.max(0, finishedAt.getTime() - new Date(run.started_at).getTime()),
          error: "Worker stopped before recording completion",
        })
        .eq("id", run.id)
        .eq("status", "running");
    }
  }

  const retentionCutoff = new Date(Date.now() - WORKER_RUN_RETENTION_MS).toISOString();
  const { error: retentionError } = await supabase
    .from("worker_runs")
    .delete()
    .lt("started_at", retentionCutoff);
  if (retentionError) {
    console.warn(`[CRON] Could not prune worker run history: ${retentionError.message}`);
  }
  lastWorkerRunMaintenanceAt = Date.now();
}

function startHeartbeat(): void {
  if (heartbeatInterval) return;

  const beat = async () => {
    try {
      const supabase = createSupabaseClient();
      const repeatables = cronQueue ? await cronQueue.getRepeatableJobs() : [];

      // Runtime chain repair: a repeatable whose next fire time slipped into
      // the past has lost its delayed job (worker killed mid-iteration) and
      // will never fire again on its own — remove and re-add to re-seed
      if (cronQueue) {
        for (const rep of repeatables) {
          if (!rep.next || rep.next >= Date.now() - 60_000) continue;
          try {
            const endpoint = rep.name.replace(/^cron-/, "");
            const { data: dbJob } = await supabase
              .from("cron_jobs")
              .select("name")
              .eq("endpoint", endpoint)
              .maybeSingle();
            await cronQueue.removeRepeatableByKey(rep.key);
            await cronQueue.add(
              rep.name,
              { endpoint, name: dbJob?.name ?? endpoint },
              { repeat: { pattern: rep.pattern ?? "*/30 * * * *" } },
            );
            console.log(`[CRON] Heartbeat re-seeded broken repeat chain: "${rep.name}" (next was ${new Date(rep.next ?? 0).toISOString()})`);
          } catch (err) {
            console.error(`[CRON] Failed to re-seed "${rep.name}":`, err);
          }
        }
      }

      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            id: "worker-cron",
            last_heartbeat: new Date().toISOString(),
            active_jobs: repeatables.length,
          },
          { onConflict: "id" },
        );

      await maintainWorkerRunHistory();
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
  readonly queue: Readonly<Record<string, number>>;
  readonly runningCount: number;
  readonly failedLast24Hours: number;
  readonly recentRuns: ReadonlyArray<WorkerRunRecord>;
  readonly jobs: ReadonlyArray<{
    readonly name: string;
    readonly schedule: string;
    readonly lastRun: string | null;
    readonly lastStatus: string | null;
  }>;
}> {
  const supabase = createSupabaseClient();

  const sinceYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: heartbeat }, { data: jobs }, { data: recentRuns }, runningResult, failedResult] = await Promise.all([
    supabase
      .from("cron_heartbeat")
      .select("last_heartbeat")
      .eq("id", "worker-cron")
      .maybeSingle(),
    supabase
      .from("cron_jobs")
      .select("name, schedule, last_run_at, last_status, is_active")
      .eq("is_active", true),
    supabase
      .from("worker_runs")
      .select("id, job_name, endpoint, source, status, worker_instance, started_at, finished_at, duration_ms, error")
      .order("started_at", { ascending: false })
      .limit(25),
    supabase
      .from("worker_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running"),
    supabase
      .from("worker_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("started_at", sinceYesterday),
  ]);

  const repeatableCount = cronQueue ? (await cronQueue.getRepeatableJobs()).length : 0;
  const queue = cronQueue
    ? await cronQueue.getJobCounts("waiting", "active", "delayed", "failed")
    : { waiting: 0, active: 0, delayed: 0, failed: 0 };

  return {
    active: repeatableCount > 0,
    jobCount: repeatableCount,
    heartbeat: heartbeat?.last_heartbeat ?? null,
    queue,
    runningCount: runningResult.count ?? 0,
    failedLast24Hours: failedResult.count ?? 0,
    recentRuns: (recentRuns ?? []) as ReadonlyArray<WorkerRunRecord>,
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
