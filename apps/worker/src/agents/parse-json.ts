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
      try {
        const sanitized = sanitizeLlmJson(extracted);
        return JSON.parse(sanitized) as T;
      } catch {
        // Fourth try: use regex to extract key-value pairs from broken JSON
        // This handles cases where markdown content has unescaped quotes
        const repaired = repairBrokenJsonStrings(extracted);
        return JSON.parse(repaired) as T;
      }
    }
  }
}

/**
 * Attempt to repair JSON with unescaped double quotes inside string values.
 * Common when LLM puts markdown content (with "quoted text") inside JSON strings.
 *
 * Strategy: find string boundaries by looking at the structural context
 * (colons, commas, brackets) rather than just matching quotes.
 */
function repairBrokenJsonStrings(json: string): string {
  // Replace literal newlines that might be inside strings
  let fixed = json.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

  // Try parsing after newline fix
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {
    // Continue
  }

  // More aggressive: escape all double quotes that aren't structural
  // Structural quotes are: after {, after [, after :, after ,, before :, before }, before ], before ,
  fixed = fixTrailingCommas(json);
  const chars = [...fixed];
  const result: string[] = [];
  let inStr = false;
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    if (ch === "\\" && inStr) {
      result.push(ch, chars[i + 1] ?? "");
      i += 2;
      continue;
    }

    if (ch === '"') {
      if (!inStr) {
        inStr = true;
        result.push(ch);
        i++;
        continue;
      }

      // We're in a string and hit a quote. Is this the closing quote?
      // Look ahead: if followed by structural char (: , } ]) then it's closing
      let j = i + 1;
      while (j < chars.length && (chars[j] === " " || chars[j] === "\n" || chars[j] === "\r" || chars[j] === "\t")) j++;
      const next = chars[j];
      if (!next || next === ":" || next === "," || next === "}" || next === "]") {
        // Closing quote
        inStr = false;
        result.push(ch);
      } else {
        // Unescaped quote inside string — escape it
        result.push("\\", '"');
      }
      i++;
      continue;
    }

    if (inStr && ch === "\n") { result.push("\\n"); i++; continue; }
    if (inStr && ch === "\r") { result.push("\\r"); i++; continue; }
    if (inStr && ch === "\t") { result.push("\\t"); i++; continue; }
    if (inStr && ch.charCodeAt(0) < 32) { result.push(" "); i++; continue; }

    result.push(ch);
    i++;
  }

  return result.join("");
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
