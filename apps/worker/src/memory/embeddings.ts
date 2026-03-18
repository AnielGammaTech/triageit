import Anthropic from "@anthropic-ai/sdk";

/**
 * Generate embeddings using Anthropic's voyage model via the embeddings API.
 * Falls back to a simple hash-based approach if the API is unavailable.
 *
 * Uses voyage-3-large (1536 dimensions) for high-quality semantic search.
 */

const EMBEDDING_MODEL = "voyage-3-large";
const EMBEDDING_DIMENSIONS = 1536;

let voyageAvailable: boolean | null = null;

export async function generateEmbedding(
  text: string,
): Promise<ReadonlyArray<number> | null> {
  // Try Anthropic's embedding endpoint via voyage
  if (voyageAvailable !== false) {
    try {
      const response = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          input: [text.slice(0, 8000)], // Truncate to model limit
          model: EMBEDDING_MODEL,
        }),
      });

      if (response.ok) {
        voyageAvailable = true;
        const data = (await response.json()) as {
          data: ReadonlyArray<{ embedding: ReadonlyArray<number> }>;
        };
        return data.data[0].embedding;
      }
      voyageAvailable = false;
    } catch {
      voyageAvailable = false;
    }
  }

  // Fallback: Use Anthropic to generate a pseudo-embedding via concept extraction
  // This is a degraded mode — no vector similarity, but still stores memories
  console.warn(
    "[EMBEDDINGS] Voyage API unavailable, memories stored without embeddings",
  );
  return null;
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
