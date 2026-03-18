/**
 * Safely parse JSON from an LLM response.
 *
 * Claude sometimes wraps JSON in markdown code fences, adds preamble text,
 * or appends explanations after the JSON. This handles all those cases:
 *
 * 1. ```json { "key": "value" } ```
 * 2. Here's my analysis: ```json { ... } ```
 * 3. { "key": "value" }  (raw JSON)
 * 4. Some text { "key": "value" } some trailing text
 */
export function parseLlmJson<T>(text: string): T {
  const extracted = extractJson(text);
  return JSON.parse(extracted) as T;
}

function extractJson(text: string): string {
  const trimmed = text.trim();

  // 1. Try to extract from markdown code fences (anywhere in the string)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 2. Try raw parse first — maybe it's already clean JSON
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue to extraction
  }

  // 3. Find the first { and last } to extract a JSON object
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Return as-is and let the caller handle the error
      return candidate;
    }
  }

  // 4. Find the first [ and last ] for JSON arrays
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return candidate;
    }
  }

  return trimmed;
}
