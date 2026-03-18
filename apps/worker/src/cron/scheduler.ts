import { createSupabaseClient } from "../db/supabase.js";
import { runDailyScan } from "../agents/retriage/daily-scan.js";
import { TeamsClient } from "../integrations/teams/client.js";
import type { TeamsConfig } from "@triageit/shared";

let cronInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

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

async function runDailyRetriage(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  // Skip if already ran today
  if (lastRunDate === today) {
    return;
  }

  console.log(`[CRON] Starting daily re-triage scan for ${today}`);
  lastRunDate = today;

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

      // Send daily summary
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
    // Reset lastRunDate so it can retry
    lastRunDate = null;
  }
}

export function startCronScheduler(): void {
  // Check every 15 minutes if it's time to run the daily scan
  // The actual scan only runs once per day (6 AM local)
  cronInterval = setInterval(async () => {
    const hour = new Date().getHours();

    // Run at 6 AM
    if (hour === 6) {
      await runDailyRetriage();
    }
  }, 15 * 60 * 1000); // Check every 15 minutes

  console.log("[CRON] Scheduler started — daily re-triage at 6 AM");
}

export function stopCronScheduler(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

// Manual trigger for testing
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
