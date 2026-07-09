/**
 * One-off: turn every historical close review into a resolution memory for
 * Michael, so similarity recall can surface "we solved this before by X"
 * from day one instead of only learning from closes going forward.
 *
 * Idempotent: skips reviews whose halo_id already has a close_review-sourced
 * memory. Usage: railway run -s worker -- npx tsx scripts/backfill-resolution-memories.ts
 */
import { createSupabaseClient } from "../src/db/supabase.js";
import { MemoryManager } from "../src/memory/memory-manager.js";

interface ReviewRow {
  readonly halo_id: number;
  readonly ticket_id: string | null;
  readonly tech_name: string | null;
  readonly review_data: {
    readonly resolution_summary?: string;
    readonly onsite_visits?: ReadonlyArray<string>;
    readonly ticket_lifecycle?: { readonly total_time?: string; readonly resolution_method?: string };
  } | null;
  readonly tickets: { readonly summary: string | null; readonly client_name: string | null } | null;
}

const CONCURRENCY = 5;

async function main(): Promise<void> {
  const supabase = createSupabaseClient();
  const memoryManager = new MemoryManager(supabase);

  const { data: existing } = await supabase
    .from("agent_memories")
    .select("metadata")
    .eq("agent_name", "michael_scott")
    .eq("memory_type", "resolution")
    .limit(10_000);
  const done = new Set(
    (existing ?? [])
      .map((m) => (m.metadata as Record<string, unknown> | null)?.halo_id)
      .filter((v): v is number => typeof v === "number"),
  );

  const rows: ReviewRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("close_reviews")
      .select("halo_id, ticket_id, tech_name, review_data, tickets(summary, client_name)")
      .order("halo_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as ReviewRow[]));
    if (!data || data.length < 1000) break;
  }

  const targets = rows.filter((r) => r.review_data?.resolution_summary && !done.has(r.halo_id));
  console.log(`Backfilling ${targets.length} of ${rows.length} close reviews (${done.size} already stored)`);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const review = row.review_data!;
        const summary = String(row.tickets?.summary ?? "").slice(0, 150);
        const client = row.tickets?.client_name ?? null;
        const contentLines = [
          `RESOLVED ticket #${row.halo_id} — "${summary}" (${client ?? "unknown client"}).`,
          `Issue & fix: ${review.resolution_summary}`,
          `Resolution method: ${review.ticket_lifecycle?.resolution_method ?? "unknown"} | total time: ${review.ticket_lifecycle?.total_time ?? "?"} | tech: ${row.tech_name ?? "unassigned"}.`,
          (review.onsite_visits?.length ?? 0) > 0 ? `Required onsite: ${review.onsite_visits!.join("; ")}` : "",
        ].filter(Boolean);
        try {
          await memoryManager.createMemory({
            agent_name: "michael_scott",
            ticket_id: row.ticket_id,
            content: contentLines.join("\n"),
            summary: `How #${row.halo_id} (${summary.slice(0, 60)}) was resolved`,
            memory_type: "resolution",
            confidence: 0.9,
            metadata: {
              client_name: client,
              halo_id: row.halo_id,
              resolution_method: review.ticket_lifecycle?.resolution_method ?? null,
              tech: row.tech_name,
              source: "close_review",
            },
          });
          ok++;
        } catch (error) {
          failed++;
          console.error(`#${row.halo_id} failed:`, error instanceof Error ? error.message : error);
        }
      }),
    );
    if ((i / CONCURRENCY) % 20 === 0) console.log(`Progress: ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}`);
  }
  console.log(`Done: ${ok} stored, ${failed} failed`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
