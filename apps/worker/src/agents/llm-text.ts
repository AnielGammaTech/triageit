/**
 * Extract the text payload from an Anthropic messages response.
 *
 * Joins ALL text blocks (not just content[0] — the first block can be a
 * thinking/tool block) and never throws on an empty content array.
 * Returns `fallback` when the response carries no text at all.
 */

interface ContentBlockLike {
  readonly type: string;
  readonly text?: string;
}

interface MessageResponseLike {
  readonly content: ReadonlyArray<ContentBlockLike>;
  readonly stop_reason?: string | null;
}

export function extractResponseText(
  response: MessageResponseLike,
  fallback = "",
): string {
  const text = (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();

  if (!text) {
    console.warn(
      `[LLM] Response contained no text (stop_reason: ${response.stop_reason ?? "unknown"}, blocks: ${(response.content ?? []).map((b) => b.type).join(",") || "none"})`,
    );
    return fallback;
  }

  return text;
}
