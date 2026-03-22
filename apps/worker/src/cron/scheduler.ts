import cron from "node-cron";
import { createSupabaseClient } from "../db/supabase.js";
import { runDailyScan } from "../agents/retriage/daily-scan.js";
import { scanForSlaBreaches } from "./sla-scan.js";
import { runTobyAnalysis } from "../agents/workers/toby-flenderson.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

interface CronJobRecord {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly endpoint: string;
  readonly is_active: boolean;
}

interface ScheduledTask {
  readonly jobId: string;
  readonly task: ReturnType<typeof cron.schedule>;
}

let scheduledTasks: ReadonlyArray<ScheduledTask> = [];
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Map of endpoint -> handler function
const ENDPOINT_HANDLERS: Record<string, () => Promise<void>> = {
  "/retriage": runDailyRetriage,
  "/sla-scan": runSlaScan,
  "/toby/analyze": runTobyAnalysisCron,
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
 * Run a single cron job by its database record, updating status in Supabase.
 */
async function executeJob(job: CronJobRecord): Promise<void> {
  const handler = ENDPOINT_HANDLERS[job.endpoint];
  if (!handler) {
    console.error(`[CRON] No handler for endpoint: ${job.endpoint}`);
    await updateJobStatus(job.id, "error", `No handler for endpoint: ${job.endpoint}`);
    return;
  }

  try {
    await handler();
    await updateJobStatus(job.id, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CRON] Job "${job.name}" failed:`, message);
    await updateJobStatus(job.id, "error", message);
  }
}

/**
 * Start the cron scheduler.
 * Reads job definitions from the cron_jobs table in Supabase.
 * Falls back to default schedule if the table is empty or unavailable.
 */
export async function startCronScheduler(): Promise<void> {
  const supabase = createSupabaseClient();

  const { data: jobs, error } = await supabase
    .from("cron_jobs")
    .select("id, name, schedule, endpoint, is_active");

  if (error || !jobs || jobs.length === 0) {
    // Fallback to legacy behavior if table doesn't exist yet
    console.log("[CRON] No cron_jobs table or no jobs found — using legacy scheduler");
    startLegacyScheduler();
    return;
  }

  const activeJobs = jobs.filter((j: CronJobRecord) => j.is_active);

  const newTasks: ScheduledTask[] = [];

  for (const job of activeJobs) {
    if (!cron.validate(job.schedule)) {
      console.error(`[CRON] Invalid cron expression for "${job.name}": "${job.schedule}" — skipping`);
      continue;
    }

    const task = cron.schedule(job.schedule, () => {
      executeJob(job).catch((err) =>
        console.error(`[CRON] Unhandled error in job "${job.name}":`, err),
      );
    });

    newTasks.push({ jobId: job.id, task });
    console.log(`[CRON] Scheduled "${job.name}" — "${job.schedule}" -> ${job.endpoint}`);
  }

  scheduledTasks = newTasks;
  startHeartbeat();
  console.log(`[CRON] Scheduler started with ${newTasks.length} active jobs`);
}

/**
 * Legacy scheduler for backwards compatibility when cron_jobs table doesn't exist.
 */
function startLegacyScheduler(): void {
  const schedule = process.env.RETRIAGE_CRON ?? "0 */3 * * *";

  if (!cron.validate(schedule)) {
    console.error(`[CRON] Invalid cron expression: "${schedule}" — scheduler not started`);
    return;
  }

  const task = cron.schedule(schedule, () => {
    Promise.all([
      runDailyRetriage().catch((err) =>
        console.error("[CRON] Unhandled error in daily retriage:", err),
      ),
      scanForSlaBreaches().catch((err) =>
        console.error("[CRON] Unhandled error in SLA scan:", err),
      ),
    ]).catch(() => {
      // Individual errors already logged above
    });
  });

  scheduledTasks = [{ jobId: "legacy", task }];
  startHeartbeat();
  console.log(`[CRON] Legacy scheduler started — schedule: "${schedule}"`);
}

export function stopCronScheduler(): void {
  for (const { task } of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];

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

  await executeJob(job);
  return { status: "triggered" };
}

// ── Heartbeat ────────────────────────────────────────────────────────

/**
 * Write a heartbeat to Supabase every 5 minutes.
 * This lets us detect when the cron scheduler stops running.
 */
function startHeartbeat(): void {
  if (heartbeatInterval) return;

  const beat = async () => {
    try {
      const supabase = createSupabaseClient();
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            id: "worker-cron",
            last_heartbeat: new Date().toISOString(),
            active_jobs: scheduledTasks.length,
          },
          { onConflict: "id" },
        );
    } catch {
      // Non-critical — don't crash the worker over a heartbeat failure
    }
  };

  // Immediate first beat
  beat();
  heartbeatInterval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  console.log("[CRON] Heartbeat started (every 5m)");
}

// ── Missed Job Catch-up ──────────────────────────────────────────────

/**
 * On startup, check which cron jobs should have run while the worker was down
 * and execute them immediately. Prevents gaps when Railway restarts the service.
 */
export async function catchUpMissedJobs(): Promise<void> {
  const supabase = createSupabaseClient();

  const { data: jobs, error } = await supabase
    .from("cron_jobs")
    .select("id, name, schedule, endpoint, is_active, last_run_at")
    .eq("is_active", true);

  if (error || !jobs || jobs.length === 0) return;

  const now = Date.now();

  for (const job of jobs) {
    try {
      const lastRun = job.last_run_at ? new Date(job.last_run_at).getTime() : 0;
      const intervalMs = estimateIntervalMs(job.schedule);

      if (intervalMs <= 0) continue;

      // If the last run was more than 1.5x the interval ago, it was missed
      const missedThreshold = intervalMs * 1.5;
      const timeSinceLastRun = now - lastRun;

      if (timeSinceLastRun > missedThreshold) {
        const hoursAgo = (timeSinceLastRun / (1000 * 60 * 60)).toFixed(1);
        console.log(
          `[CRON] Catch-up: "${job.name}" last ran ${hoursAgo}h ago (interval: ${(intervalMs / (1000 * 60 * 60)).toFixed(1)}h) — running now`,
        );
        await executeJob(job);
      }
    } catch (err) {
      console.error(`[CRON] Catch-up failed for "${job.name}":`, err);
    }
  }
}

/**
 * Estimate the rough interval in ms from a cron expression.
 * Used only for catch-up detection — doesn't need to be exact.
 */
function estimateIntervalMs(schedule: string): number {
  const parts = schedule.split(/\s+/);
  if (parts.length < 5) return 0;

  const [minute, hour] = parts;

  // Every N hours: "0 */N * * *"
  const hourlyMatch = hour?.match(/^\*\/(\d+)$/);
  if (hourlyMatch) {
    return parseInt(hourlyMatch[1], 10) * 60 * 60 * 1000;
  }

  // Every N minutes: "*/N * * * *"
  const minuteMatch = minute?.match(/^\*\/(\d+)$/);
  if (minuteMatch) {
    return parseInt(minuteMatch[1], 10) * 60 * 1000;
  }

  // Specific hour (daily job): "M H * * *"
  if (hour !== "*" && !hour?.includes("/") && !hour?.includes(",")) {
    return 24 * 60 * 60 * 1000; // daily
  }

  // Default: assume hourly
  return 60 * 60 * 1000;
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

  return {
    active: scheduledTasks.length > 0,
    jobCount: scheduledTasks.length,
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
