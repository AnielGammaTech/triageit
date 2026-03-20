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

  // First try: raw parse
  try {
    return JSON.parse(extracted) as T;
  } catch {
    // Second try: fix trailing commas (common LLM mistake)
    try {
      const cleaned = fixTrailingCommas(extracted);
      return JSON.parse(cleaned) as T;
    } catch {
      // Third try: fix common LLM JSON issues (unescaped newlines, control chars in strings)
      const sanitized = sanitizeLlmJson(extracted);
      return JSON.parse(sanitized) as T;
    }
  }
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

/**
 * Remove trailing commas before closing brackets/braces — a common LLM mistake.
 *
 * Handles:
 *   ["a", "b",]  →  ["a", "b"]
 *   { "k": "v", } →  { "k": "v" }
 *   Nested trailing commas at any depth
 */
function fixTrailingCommas(json: string): string {
  // Remove commas followed by optional whitespace/newlines then ] or }
  return json.replace(/,\s*([\]}])/g, "$1");
}

/**
 * Sanitize malformed LLM JSON by fixing common issues:
 * - Unescaped control characters inside strings (newlines, tabs)
 * - Trailing commas
 * - Truncated responses (close any open arrays/objects)
 */
function sanitizeLlmJson(json: string): string {
  let cleaned = fixTrailingCommas(json);

  // Replace unescaped control characters inside JSON string values
  // Walk through the string character by character to handle only characters inside quotes
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      // Replace unescaped control chars with escaped versions
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
      // Skip other control characters
      if (ch.charCodeAt(0) < 32) { result += " "; continue; }
    }

    result += ch;
  }

  cleaned = result;

  // Close any unclosed brackets/braces from truncated responses
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;

  for (const ch of cleaned) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "{") openBraces++;
      if (ch === "}") openBraces--;
      if (ch === "[") openBrackets++;
      if (ch === "]") openBrackets--;
    }
  }

  // Close any remaining open structures
  for (let i = 0; i < openBrackets; i++) cleaned += "]";
  for (let i = 0; i < openBraces; i++) cleaned += "}";

  return cleaned;
}
