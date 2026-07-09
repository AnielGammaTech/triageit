/**
 * Backfill the site-visit ledger from Halo's status-change history:
 * any ticket whose action trail shows a transition to Scheduled gets
 * onsite_visit_alerted_at set to the REAL transition date (earliest).
 * Usage: railway run -s worker -- npx tsx scripts/backfill-site-visits.ts [sinceISO]
 */
import { createSupabaseClient } from "../src/db/supabase.js";
import { HaloClient } from "../src/integrations/halo/client.js";
import { getCachedHaloConfig } from "../src/integrations/get-config.js";

const since = process.argv[2] ?? "2026-06-01";
const supabase = createSupabaseClient();
const haloConfig = await getCachedHaloConfig(supabase);
if (!haloConfig) throw new Error("halo not configured");
const halo = new HaloClient(haloConfig);

const rows: Array<{ id: string; halo_id: number }> = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("tickets")
    .select("id, halo_id")
    .eq("tickettype_id", 31)
    .gte("created_at", since)
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...((data ?? []) as typeof rows));
  if (!data || data.length < 1000) break;
}
console.log(`Scanning ${rows.length} tickets since ${since} for Scheduled transitions`);

let found = 0, done = 0;
const CONC = 6;
for (let i = 0; i < rows.length; i += CONC) {
  await Promise.all(rows.slice(i, i + CONC).map(async (t) => {
    try {
      const actions = await halo.getTicketActions(t.halo_id, true);
      const sched = actions
        .filter((a) => /to\s+"?Sched/i.test(String(a.note ?? "")))
        .map((a) => a.actiondatecreated ?? a.datetime ?? a.datecreated)
        .filter((d): d is string => Boolean(d))
        .sort();
      if (sched[0]) {
        await supabase.from("tickets").update({ onsite_visit_alerted_at: new Date(sched[0]).toISOString() }).eq("id", t.id);
        found++;
      }
    } catch { /* skip */ }
    done++;
    if (done % 200 === 0) console.log(`${done}/${rows.length} scanned, ${found} visits found`);
  }));
}
console.log(`DONE: ${found} site visits backfilled across ${rows.length} tickets`);
process.exit(0);
