// apps/worker/src/memory/memory-validator.ts

import type { MemoryMatch } from "@triageit/shared";

/**
 * MemoryValidator — Checks recalled memories for staleness and accuracy.
 *
 * Before injecting a memory into an agent's prompt, we validate:
 * 1. URL liveness — any URLs in the memory still resolve (HEAD request)
 * 2. Age staleness — memories older than threshold get flagged
 * 3. Confidence decay — low-confidence + old = skip
 *
 * Returns validated memories with a `validated` flag and optional warnings.
 */

export interface ValidatedMemory {
  readonly memory: MemoryMatch;
  readonly isValid: boolean;
  readonly warnings: ReadonlyArray<string>;
}

const URL_REGEX = /https?:\/\/[^\s)"']+/g;
const STALE_THRESHOLD_DAYS = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Validate a batch of recalled memories.
 * URL checks run in parallel with a short timeout.
 * Memories that fail validation are flagged but not deleted —
 * the agent sees the warning and decides whether to trust them.
 */
export async function validateMemories(
  memories: ReadonlyArray<MemoryMatch>,
): Promise<ReadonlyArray<ValidatedMemory>> {
  return Promise.all(memories.map(validateSingleMemory));
}

async function validateSingleMemory(
  memory: MemoryMatch,
): Promise<ValidatedMemory> {
  const warnings: string[] = [];

  // Check age staleness
  const createdAt = (memory as unknown as { readonly created_at?: string })
    .created_at;
  if (createdAt) {
    const ageDays =
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_THRESHOLD_DAYS) {
      warnings.push(
        `Memory is ${Math.round(ageDays)} days old — verify info is still current`,
      );
    }
  }

  // Check confidence
  if (memory.confidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push(
      `Low confidence (${(memory.confidence * 100).toFixed(0)}%) — treat as unverified`,
    );
  }

  // Check URLs in memory content
  const urls = memory.content.match(URL_REGEX) ?? [];
  const deadUrls = await checkUrls(urls);
  if (deadUrls.length > 0) {
    warnings.push(`Dead links found: ${deadUrls.join(", ")}`);
  }

  return {
    memory,
    isValid: deadUrls.length === 0 && warnings.length <= 1,
    warnings,
  };
}

/**
 * HEAD-check a list of URLs. Returns the ones that are dead.
 * Uses a short timeout (3s) to avoid blocking triage.
 */
async function checkUrls(
  urls: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (urls.length === 0) return [];

  // Check max 3 URLs to avoid slowing down triage
  const toCheck = urls.slice(0, 3);

  const results = await Promise.allSettled(
    toCheck.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(3000),
          redirect: "follow",
        });
        return response.ok ? null : url;
      } catch {
        return url;
      }
    }),
  );

  return results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((url): url is string => url !== null);
}

/**
 * Format validated memories for prompt injection.
 * Valid memories are shown normally. Flagged memories include warnings.
 */
export function formatValidatedMemories(
  validated: ReadonlyArray<ValidatedMemory>,
): string {
  if (validated.length === 0) return "";

  const items = validated
    .map((v, i) => {
      const base = `${i + 1}. [${v.memory.memory_type}] ${v.memory.summary} (confidence: ${(v.memory.confidence * 100).toFixed(0)}%, relevance: ${(v.memory.similarity * 100).toFixed(0)}%)`;
      if (v.warnings.length > 0) {
        return `${base}\n   ⚠ UNVERIFIED: ${v.warnings.join("; ")}`;
      }
      return base;
    })
    .join("\n");

  return `\n---\n# Relevant Past Experiences\nYou've handled similar tickets before. Use these memories to inform your analysis.\nMemories marked UNVERIFIED may contain outdated information — verify before relying on them.\n\n${items}\n---\n`;
}
