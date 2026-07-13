import Anthropic from "@anthropic-ai/sdk";
import { extractResponseText } from "../agents/llm-text.js";
import type { TechStatus } from "./presence.js";

/**
 * aiRead — one-line Haiku dispatcher narrative per tech, hash-cached.
 *
 * The board hands each tech's (status.state, status.detail, load,
 * nextCommitment) here; when a tech's hash changes, ONE batched Haiku call
 * refreshes all changed techs fire-and-forget. The board always returns
 * immediately with stale/null reads — this never blocks and never
 * determines status.
 */

const MODEL = "claude-haiku-4-5-20251001";
const MAX_READ_WORDS = 14;

export interface AiReadInput {
  readonly tech: string;
  readonly status: TechStatus;
  readonly load: {
    readonly open: number;
    readonly wot: number;
    readonly customerReply: number;
    readonly breaching: number;
  };
  readonly nextCommitment: string | null;
}

// Module-level cache: tech → last input hash + last generated line.
const readCache = new Map<string, { readonly hash: string; readonly read: string | null }>();
let refreshInFlight = false;

const hashOf = (t: AiReadInput): string =>
  JSON.stringify([
    t.status.state,
    t.status.detail,
    t.load.open,
    t.load.wot,
    t.load.customerReply,
    t.load.breaching,
    t.nextCommitment,
  ]);

/**
 * Attach cached aiRead lines (new array — inputs are never mutated) and
 * kick off a background refresh for any tech whose inputs changed.
 */
export function attachAiReads<T extends AiReadInput>(
  techs: ReadonlyArray<T>,
): ReadonlyArray<T & { readonly aiRead: string | null }> {
  const changed = techs.filter((t) => readCache.get(t.tech)?.hash !== hashOf(t));
  if (changed.length > 0 && !refreshInFlight) {
    refreshInFlight = true;
    void refreshAiReads(changed).finally(() => {
      refreshInFlight = false;
    });
  }
  return techs.map((t) => ({ ...t, aiRead: readCache.get(t.tech)?.read ?? null }));
}

async function refreshAiReads(changed: ReadonlyArray<AiReadInput>): Promise<void> {
  try {
    console.log(`[DISPATCH] aiRead refresh (${changed.length} techs)`);
    const facts = changed
      .map((t) =>
        JSON.stringify({
          tech: t.tech,
          state: t.status.state,
          detail: t.status.detail,
          openTickets: t.load.open,
          waitingOnTech: t.load.wot,
          customerReplies: t.load.customerReply,
          breaching: t.load.breaching,
          nextCommitment: t.nextCommitment,
        }),
      )
      .join("\n");

    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: `You are a helpdesk dispatcher glancing at the availability board. For EACH tech below, write ONE plain-spoken dispatcher-voice line of at most ${MAX_READ_WORDS} words summarizing their situation right now (status + workload + next commitment when notable). No emoji, no fluff, no restating the tech's name in the line.

Return ONLY a JSON object mapping each tech's exact name to their line, e.g. {"Jane Doe": "free right now, light board, onsite at 2"}.

Techs (one JSON object per line):
${facts}`,
        },
      ],
    });

    const parsed = parseReadJson(extractResponseText(res));
    if (!parsed) {
      console.warn("[DISPATCH] aiRead response not parseable — keeping previous reads");
      return;
    }
    for (const t of changed) {
      const raw = parsed[t.tech];
      const line = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      // Only advance the hash on success so a failed tech retries next build.
      if (line) readCache.set(t.tech, { hash: hashOf(t), read: line });
    }
  } catch (err) {
    // Never surfaces to the board — previous (or null) reads stay in place.
    console.warn("[DISPATCH] aiRead refresh failed:", err instanceof Error ? err.message : err);
  }
}

/** Defensive JSON extraction — tolerates code fences and surrounding prose. */
function parseReadJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return obj !== null && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
