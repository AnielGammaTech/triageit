import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";
import { enqueueTriageJob } from "../queue/producer.js";

interface SlaScanResult {
  readonly totalChecked: number;
  readonly breachesFound: number;
  readonly triageEnqueued: number;
  readonly skippedCurrentlyTriaging: number;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Scan all open tickets in Halo for SLA breaches.
 * For each breached ticket, enqueue a triage job.
 *
 * Cooldown: based on the most recent triage_results entry for the ticket,
 * NOT on updated_at (which gets refreshed by every Halo sync).
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
      skippedCurrentlyTriaging: 0,
      errors: [],
    };
  }

  const haloConfig = integration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);

  // Fetch all open tickets with SLA info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allOpenTickets: ReadonlyArray<Record<string, any>>;

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
      skippedCurrentlyTriaging: 0,
      errors: [`Failed to fetch tickets: ${msg}`],
    };
  }

  // Log first ticket's SLA fields for debugging
  if (allOpenTickets.length > 0) {
    const sample = allOpenTickets[0];
    console.log("[SLA SCAN] Sample ticket SLA fields:", JSON.stringify({
      id: sample.id,
      fixtargetmet: sample.fixtargetmet,
      responsetargetmet: sample.responsetargetmet,
      fixbydate: sample.fixbydate,
      respondbydate: sample.respondbydate,
      sla_timer_text: sample.sla_timer_text,
      sla: sample.sla,
      sladetails: sample.sladetails,
    }));
  }

  // Filter to only SLA-breaching tickets
  // Check both top-level and nested SLA data
  const breachers = allOpenTickets.filter((t) => {
    const slaSource = t.sla ?? t.sladetails ?? t;
    const fixBreached = slaSource.fixtargetmet === false || t.fixtargetmet === false;
    const responseBreached = slaSource.responsetargetmet === false || t.responsetargetmet === false;
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
      skippedCurrentlyTriaging: 0,
      errors: [],
    };
  }

  console.log(
    `[SLA SCAN] Found ${breachers.length} SLA-breaching tickets out of ${allOpenTickets.length} open`,
  );

  // Look up which breaching tickets exist locally
  const breacherHaloIds = breachers.map((t) => t.id as number);
  const { data: localTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, status")
    .in("halo_id", breacherHaloIds);

  const localTicketMap = new Map(
    (localTickets ?? []).map((t) => [t.halo_id, t]),
  );

  // Get actual last triage time from triage_results (NOT updated_at)
  const localIds = (localTickets ?? []).map((t) => t.id);
  const { data: recentTriageResults } = localIds.length > 0
    ? await supabase
        .from("triage_results")
        .select("ticket_id, created_at")
        .in("ticket_id", localIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Build a map of ticket_id → most recent triage time
  const lastTriageMap = new Map<string, number>();
  for (const result of recentTriageResults ?? []) {
    if (!lastTriageMap.has(result.ticket_id)) {
      lastTriageMap.set(result.ticket_id, new Date(result.created_at).getTime());
    }
  }

  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  let triageEnqueued = 0;
  let skippedCurrentlyTriaging = 0;

  for (const breacher of breachers) {
    const haloId = breacher.id as number;
    const local = localTicketMap.get(haloId);

    // If ticket doesn't exist locally yet, create it first
    if (!local) {
      try {
        const { data: created } = await supabase
          .from("tickets")
          .insert({
            halo_id: haloId,
            summary: breacher.summary as string,
            status: "pending" as const,
            created_at: (breacher as Record<string, unknown>).datecreated as string ?? new Date().toISOString(),
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
            `[SLA SCAN] Created + enqueued SLA-breaching ticket #${haloId} (job: ${jobId})`,
          );
          triageEnqueued++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create ticket #${haloId}: ${msg}`);
      }
      continue;
    }

    // Skip if currently being triaged
    if (local.status === "triaging" || local.status === "pending") {
      skippedCurrentlyTriaging++;
      continue;
    }

    // Cooldown: skip only if there's an ACTUAL triage result within the last 3 hours
    const lastTriageTime = lastTriageMap.get(local.id);
    if (lastTriageTime && lastTriageTime > threeHoursAgo) {
      console.log(
        `[SLA SCAN] Ticket #${haloId} was triaged ${Math.round((Date.now() - lastTriageTime) / 60000)}min ago — skipping`,
      );
      skippedCurrentlyTriaging++;
      continue;
    }

    // Mark as pending and enqueue triage
    try {
      await supabase
        .from("tickets")
        .update({ status: "pending" as const })
        .eq("id", local.id);

      const jobId = await enqueueTriageJob({
        ticketId: local.id,
        haloId: local.halo_id,
        summary: local.summary,
      });
      console.log(
        `[SLA SCAN] Enqueued SLA-breaching ticket #${haloId} for triage (job: ${jobId})`,
      );
      triageEnqueued++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to enqueue ticket #${haloId}: ${msg}`);
    }
  }

  console.log(
    `[SLA SCAN] Done: ${breachers.length} breaches, ${triageEnqueued} enqueued, ${skippedCurrentlyTriaging} skipped`,
  );

  return {
    totalChecked: allOpenTickets.length,
    breachesFound: breachers.length,
    triageEnqueued,
    skippedCurrentlyTriaging,
    errors,
  };
}
