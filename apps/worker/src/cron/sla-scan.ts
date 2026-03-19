import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";
import { enqueueTriageJob } from "../queue/producer.js";

interface SlaScanResult {
  readonly totalChecked: number;
  readonly breachesFound: number;
  readonly triageEnqueued: number;
  readonly skippedRecentlyTriaged: number;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Scan all open tickets in Halo for SLA breaches.
 * For each breached ticket, enqueue a triage job if it hasn't been
 * triaged in the last 3 hours (cooldown to prevent flooding).
 *
 * This runs:
 * 1. On worker startup (retroactive catch-up)
 * 2. Every cron cycle alongside the daily retriage scan
 */
export async function scanForSlaBreaches(): Promise<SlaScanResult> {
  const supabase = createSupabaseClient();
  const errors: string[] = [];

  // Get Halo config
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    console.log("[SLA SCAN] Halo not configured — skipping SLA scan");
    return {
      totalChecked: 0,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedRecentlyTriaged: 0,
      errors: [],
    };
  }

  const haloConfig = integration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);

  // Fetch all open tickets with SLA info
  let allOpenTickets: ReadonlyArray<{
    readonly id: number;
    readonly summary: string;
    readonly fixtargetmet?: boolean;
    readonly responsetargetmet?: boolean;
    readonly fixbydate?: string;
    readonly agent_name?: string;
    readonly [key: string]: unknown;
  }>;

  try {
    const rawTickets = await halo.getOpenTickets();
    allOpenTickets = rawTickets as unknown as typeof allOpenTickets;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SLA SCAN] Failed to fetch open tickets from Halo:", msg);
    return {
      totalChecked: 0,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedRecentlyTriaged: 0,
      errors: [`Failed to fetch tickets: ${msg}`],
    };
  }

  // Filter to only SLA-breaching tickets (fix target missed)
  const breachers = allOpenTickets.filter((t) => {
    const fixBreached = t.fixtargetmet === false;
    const responseBreached = t.responsetargetmet === false;
    return fixBreached || responseBreached;
  });

  if (breachers.length === 0) {
    console.log(
      `[SLA SCAN] Checked ${allOpenTickets.length} open tickets — no SLA breaches found`,
    );
    return {
      totalChecked: allOpenTickets.length,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedRecentlyTriaged: 0,
      errors: [],
    };
  }

  console.log(
    `[SLA SCAN] Found ${breachers.length} SLA-breaching tickets out of ${allOpenTickets.length} open`,
  );

  // Look up which breaching tickets exist locally and their last triage time
  const breacherHaloIds = breachers.map((t) => t.id);
  const { data: localTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, status, updated_at")
    .in("halo_id", breacherHaloIds);

  const localTicketMap = new Map(
    (localTickets ?? []).map((t) => [t.halo_id, t]),
  );

  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  let triageEnqueued = 0;
  let skippedRecentlyTriaged = 0;

  for (const breacher of breachers) {
    const local = localTicketMap.get(breacher.id);

    // If ticket doesn't exist locally yet, create it first
    if (!local) {
      try {
        const { data: created } = await supabase
          .from("tickets")
          .insert({
            halo_id: breacher.id,
            summary: breacher.summary,
            status: "pending" as const,
            updated_at: new Date().toISOString(),
          })
          .select("id, halo_id, summary")
          .single();

        if (created) {
          const jobId = await enqueueTriageJob({
            ticketId: created.id,
            haloId: created.halo_id,
            summary: created.summary,
          });
          console.log(
            `[SLA SCAN] Created + enqueued SLA-breaching ticket #${breacher.id} (job: ${jobId})`,
          );
          triageEnqueued++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create ticket #${breacher.id}: ${msg}`);
      }
      continue;
    }

    // Skip if recently triaged (within 3 hours)
    const wasRecentlyUpdated = local.updated_at
      ? new Date(local.updated_at).getTime() > threeHoursAgo
      : false;
    const isCurrentlyTriaging =
      local.status === "triaging" || local.status === "pending";

    if (wasRecentlyUpdated || isCurrentlyTriaging) {
      skippedRecentlyTriaged++;
      continue;
    }

    // Enqueue triage for this breaching ticket
    try {
      const jobId = await enqueueTriageJob({
        ticketId: local.id,
        haloId: local.halo_id,
        summary: local.summary,
      });
      console.log(
        `[SLA SCAN] Enqueued SLA-breaching ticket #${breacher.id} for triage (job: ${jobId})`,
      );
      triageEnqueued++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to enqueue ticket #${breacher.id}: ${msg}`);
    }
  }

  console.log(
    `[SLA SCAN] Done: ${breachers.length} breaches, ${triageEnqueued} enqueued, ${skippedRecentlyTriaged} skipped (recently triaged)`,
  );

  return {
    totalChecked: allOpenTickets.length,
    breachesFound: breachers.length,
    triageEnqueued,
    skippedRecentlyTriaged,
    errors,
  };
}
