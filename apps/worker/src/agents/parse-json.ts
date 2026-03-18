/**
 * Safely parse JSON from an LLM response.
 *
 * Claude sometimes wraps JSON in markdown code fences like:
 * ```json
 * { "key": "value" }
 * ```
 *
 * This function strips those fences before parsing.
 */
export function parseLlmJson<T>(text: string): T {
  const stripped = stripMarkdownFences(text);
  return JSON.parse(stripped) as T;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}
