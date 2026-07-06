/**
 * One-off backfill: generate OpenAI embeddings for rows that were stored
 * without them (the previous Voyage integration never had an API key, so
 * every agent_memories row and most ticket_embeddings rows have NULL
 * embeddings).
 *
 * Usage (from apps/worker):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-embeddings.ts
 *
 * The OpenAI key is read from OPENAI_API_KEY or the ai-provider integration
 * config in the DB. Safe to re-run — it only touches rows with NULL
 * embeddings and upserts ticket embeddings by ticket_id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;
const MAX_INPUT_CHARS = 8000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

async function getOpenAiKey(supabase: SupabaseClient): Promise<string> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  const { data, error } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "ai-provider")
    .eq("is_active", true)
    .single();
  if (error) throw new Error(`Failed to load ai-provider config: ${error.message}`);

  const config = (data?.config ?? {}) as Record<string, unknown>;
  const key = config.openai_api_key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("No openai_api_key in ai-provider integration config");
  }
  return key;
}

async function embedBatch(
  apiKey: string,
  texts: ReadonlyArray<string>,
): Promise<ReadonlyArray<ReadonlyArray<number>>> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts.map((t) => t.slice(0, MAX_INPUT_CHARS) || " "),
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    data: ReadonlyArray<{ index: number; embedding: ReadonlyArray<number> }>;
  };
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function backfillMemories(supabase: SupabaseClient, apiKey: string): Promise<void> {
  let updated = 0;
  let failed = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("agent_memories")
      .select("id, content")
      .is("embedding", null)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw new Error(`Fetch memories failed: ${error.message}`);
    if (!data || data.length === 0) break;

    const embeddings = await embedBatch(apiKey, data.map((row) => row.content ?? ""));

    const results = await Promise.all(
      data.map((row, i) =>
        supabase
          .from("agent_memories")
          .update({ embedding: JSON.stringify(embeddings[i]) })
          .eq("id", row.id),
      ),
    );
    for (const result of results) {
      if (result.error) {
        failed += 1;
        console.error(`[MEMORIES] Update failed: ${result.error.message}`);
      } else {
        updated += 1;
      }
    }
    console.log(`[MEMORIES] ${updated} embedded so far...`);
    if (failed > 20) throw new Error("Too many update failures — aborting");
  }

  console.log(`[MEMORIES] Done: ${updated} updated, ${failed} failed`);
}

async function backfillTickets(supabase: SupabaseClient, apiKey: string): Promise<void> {
  let upserted = 0;
  let offset = 0;

  for (;;) {
    // classification lives on triage_results, not tickets — leave it null here;
    // the live pipeline fills it on the next triage of each ticket
    const { data, error } = await supabase
      .from("tickets")
      .select("id, halo_id, summary, details, client_name")
      .order("created_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(`Fetch tickets failed: ${error.message}`);
    if (!data || data.length === 0) break;
    offset += data.length;

    // Skip tickets that already have an embedding row with a vector
    const ids = data.map((t) => t.id);
    const { data: existing } = await supabase
      .from("ticket_embeddings")
      .select("ticket_id")
      .in("ticket_id", ids)
      .not("embedding", "is", null);
    const done = new Set((existing ?? []).map((e) => e.ticket_id));
    const todo = data.filter((t) => !done.has(t.id) && (t.summary ?? "").trim().length > 0);
    if (todo.length === 0) continue;

    const embeddings = await embedBatch(
      apiKey,
      todo.map((t) => `${t.summary} ${t.details ?? ""}`.trim()),
    );

    const rows = todo.map((t, i) => ({
      ticket_id: t.id,
      halo_id: t.halo_id,
      summary: t.summary,
      classification: null,
      client_name: t.client_name,
      embedding: JSON.stringify(embeddings[i]),
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabase
      .from("ticket_embeddings")
      .upsert(rows, { onConflict: "ticket_id" });
    if (upsertError) throw new Error(`Upsert ticket_embeddings failed: ${upsertError.message}`);

    upserted += rows.length;
    console.log(`[TICKETS] ${upserted} embedded so far (scanned ${offset})...`);
  }

  console.log(`[TICKETS] Done: ${upserted} upserted`);
}

async function main(): Promise<void> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const apiKey = await getOpenAiKey(supabase);

  console.log("Backfilling agent_memories...");
  await backfillMemories(supabase, apiKey);

  console.log("Backfilling ticket_embeddings...");
  await backfillTickets(supabase, apiKey);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
