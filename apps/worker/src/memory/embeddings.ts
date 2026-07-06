import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseClient } from "../db/supabase.js";

/**
 * Generate embeddings using OpenAI's text-embedding-3-small (1536 dimensions,
 * matching the pgvector columns on agent_memories and ticket_embeddings).
 *
 * The API key is read from the OPENAI_API_KEY env var when set, otherwise
 * from the ai-provider integration config in the DB (Adminland-managed).
 * Failures back off for a cooldown window instead of disabling embeddings
 * until the next restart.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const KEY_CACHE_MS = 10 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

let cachedKey: { key: string | null; fetchedAt: number } | null = null;
let lastFailureAt: number | null = null;

async function getOpenAiKey(): Promise<string | null> {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;

  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_CACHE_MS) {
    return cachedKey.key;
  }

  try {
    const supabase = createSupabaseClient();
    const { data } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "ai-provider")
      .eq("is_active", true)
      .single();

    const config = (data?.config ?? {}) as Record<string, unknown>;
    const key =
      typeof config.openai_api_key === "string" && config.openai_api_key.length > 0
        ? config.openai_api_key
        : null;
    cachedKey = { key, fetchedAt: Date.now() };
    return key;
  } catch (error) {
    console.warn("[EMBEDDINGS] Failed to load OpenAI key from ai-provider config:", error);
    cachedKey = { key: null, fetchedAt: Date.now() };
    return null;
  }
}

export async function generateEmbedding(
  text: string,
): Promise<ReadonlyArray<number> | null> {
  if (lastFailureAt && Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    return null;
  }

  const apiKey = await getOpenAiKey();
  if (!apiKey) {
    console.warn(
      "[EMBEDDINGS] No OpenAI API key available (env OPENAI_API_KEY or ai-provider config) — memories stored without embeddings",
    );
    lastFailureAt = Date.now();
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000), // Stay well under the model's token limit
        model: EMBEDDING_MODEL,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[EMBEDDINGS] OpenAI embeddings request failed (${response.status}): ${body.slice(0, 200)}`,
      );
      lastFailureAt = Date.now();
      return null;
    }

    const data = (await response.json()) as {
      data: ReadonlyArray<{ embedding: ReadonlyArray<number> }>;
    };
    lastFailureAt = null;
    return data.data[0].embedding;
  } catch (error) {
    console.warn("[EMBEDDINGS] OpenAI embeddings request errored:", error);
    lastFailureAt = Date.now();
    return null;
  }
}

/**
 * Extract key concepts from text using Claude Haiku for concept graph building.
 * Returns an array of concept strings for tagging memories.
 */
export async function extractConcepts(
  text: string,
): Promise<ReadonlyArray<string>> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: `Extract 3-8 key technical concepts from this IT support text. Return ONLY a JSON array of lowercase concept strings. Examples: ["password reset", "mfa", "azure ad", "account lockout", "vpn"]. No explanation.`,
    messages: [{ role: "user", content: text.slice(0, 2000) }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "[]";

  try {
    const concepts = JSON.parse(raw) as ReadonlyArray<string>;
    return concepts.filter(
      (c): c is string => typeof c === "string" && c.length > 0,
    );
  } catch {
    return [];
  }
}

export { EMBEDDING_DIMENSIONS };
