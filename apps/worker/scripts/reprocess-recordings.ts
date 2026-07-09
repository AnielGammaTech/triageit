/**
 * One-off: replay 3CX recordings that fell below the call-analysis cursor
 * without being processed (e.g. rows deleted for a requeue while newer
 * posted rows held the cursor high).
 *
 * Usage: npx tsx scripts/reprocess-recordings.ts <fromCursor> [toId]
 * Processes recordings with id > fromCursor (and <= toId if given) that
 * have no call_analyses row yet. Run with worker env (railway run).
 */
import { createSupabaseClient } from "../src/db/supabase.js";
import { HaloClient } from "../src/integrations/halo/client.js";
import { ThreeCxClient } from "../src/integrations/threecx/client.js";
import { getCachedHaloConfig } from "../src/integrations/get-config.js";
import { processRecording } from "../src/cron/call-analysis.js";
import type { ThreeCxConfig } from "@triageit/shared";

async function main(): Promise<void> {
  const fromCursor = Number(process.argv[2]);
  const toId = process.argv[3] ? Number(process.argv[3]) : Infinity;
  if (!Number.isFinite(fromCursor)) {
    console.error("Usage: npx tsx scripts/reprocess-recordings.ts <fromCursor> [toId]");
    process.exit(1);
  }

  const supabase = createSupabaseClient();
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "threecx")
    .eq("is_active", true)
    .maybeSingle();
  const haloConfig = await getCachedHaloConfig(supabase);
  if (!integration || !haloConfig) throw new Error("3CX or Halo not configured");

  const tcx = new ThreeCxClient(integration.config as ThreeCxConfig);
  const halo = new HaloClient(haloConfig);

  const recordings = await tcx.getRecordingsSince(fromCursor, 60);
  if (!recordings) throw new Error("3CX recordings lookup failed");

  const { data: existing } = await supabase
    .from("call_analyses")
    .select("recording_id")
    .gt("recording_id", fromCursor);
  const seen = new Set((existing ?? []).map((r) => Number(r.recording_id)));

  const targets = recordings.filter((r) => r.Id <= toId && !seen.has(r.Id));
  console.log(`Replaying ${targets.length} recordings: ${targets.map((r) => r.Id).join(", ")}`);

  for (const rec of targets) {
    try {
      const outcome = await processRecording(supabase, halo, rec);
      console.log(`Recording ${rec.Id}: matched=${outcome.matched} posted=${outcome.posted}`);
    } catch (error) {
      console.error(`Recording ${rec.Id} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
