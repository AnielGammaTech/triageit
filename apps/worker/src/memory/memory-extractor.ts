import type { MemoryType } from "@triageit/shared";

/**
 * Memory Extractor — parses <remember> tags from LLM output.
 *
 * Agents can embed learnings in their responses using:
 *   <remember type="pattern" confidence="0.9">DNS issues at Contoso often trace to stale conditional forwarders</remember>
 *
 * This module extracts those tags into structured memory entries
 * that get stored via MemoryManager after each agent execution.
 */

export interface ExtractedMemory {
  readonly content: string;
  readonly memory_type: MemoryType;
  readonly confidence: number;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  "resolution",
  "pattern",
  "insight",
  "escalation",
  "workaround",
]);

const REMEMBER_REGEX =
  /<remember(?:\s+type="([^"]*)")?(?:\s+confidence="([^"]*)")?>([^<]+)<\/remember>/gi;

/**
 * Extract all <remember> tags from an LLM response string.
 *
 * Returns an array of structured memories. Invalid types default to "insight",
 * invalid confidence values default to 0.8.
 */
export function extractRememberTags(
  text: string,
): ReadonlyArray<ExtractedMemory> {
  const memories: ExtractedMemory[] = [];

  let match: RegExpExecArray | null;
  // Reset regex state for each call
  REMEMBER_REGEX.lastIndex = 0;

  while ((match = REMEMBER_REGEX.exec(text)) !== null) {
    const rawType = match[1]?.trim().toLowerCase() ?? "insight";
    const rawConfidence = match[2]?.trim() ?? "0.8";
    const content = match[3]?.trim() ?? "";

    if (content.length === 0) continue;

    const memoryType: MemoryType = VALID_TYPES.has(rawType)
      ? (rawType as MemoryType)
      : "insight";

    const confidence = Math.min(
      1,
      Math.max(0, parseFloat(rawConfidence) || 0.8),
    );

    memories.push({ content, memory_type: memoryType, confidence });
  }

  return memories;
}

/**
 * Strip <remember> tags from text, returning clean output for display.
 * The memories are extracted separately — this just cleans the visible text.
 */
export function stripRememberTags(text: string): string {
  return text.replace(REMEMBER_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Instruction block to inject into agent system prompts, teaching them
 * how to use <remember> tags to flag important learnings.
 */
export const REMEMBER_INSTRUCTIONS = `
## Memory System
You can flag important learnings for future reference using <remember> tags in your response.
These will be extracted and stored so you can recall them on similar tickets later.

Use them sparingly — only for genuinely useful patterns, not obvious facts.

Syntax:
  <remember type="TYPE" confidence="0.0-1.0">What you learned</remember>

Types:
  - pattern: Recurring issue pattern (e.g., "DNS issues at Contoso often trace to stale conditional forwarders")
  - resolution: How a specific issue was resolved
  - insight: General observation about a client, system, or process
  - escalation: When/why escalation was needed
  - workaround: Temporary fix or known limitation

Examples:
  <remember type="pattern" confidence="0.9">Contoso's VPN drops every Monday morning correlate with their backup window at 6am</remember>
  <remember type="workaround" confidence="0.8">Fabrikam's legacy print server requires manual spooler restart after Windows updates</remember>
`.trim();
