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
  console.log(`[CRON] Legacy scheduler started — schedule: "${schedule}"`);
}

export function stopCronScheduler(): void {
  for (const { task } of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];
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
