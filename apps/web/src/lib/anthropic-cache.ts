import type Anthropic from "@anthropic-ai/sdk";

/**
 * Prompt-caching helpers (docs: platform.claude.com → prompt caching).
 *
 * Caching is a prefix match: tools → system → messages. One breakpoint on
 * the last STABLE system block caches the tools and system together; a
 * moving breakpoint on the last message block lets every tool-loop
 * iteration and every conversation turn reuse the full prior prefix at
 * ~10% of normal input cost.
 */

/**
 * Return a copy of `messages` with exactly one cache breakpoint, on the
 * last content block of the last message. Strips any markers left from
 * previous iterations so the 4-breakpoint request limit is never hit.
 */
export function withMessageCacheBreakpoint(
  messages: ReadonlyArray<Anthropic.Messages.MessageParam>,
): Anthropic.Messages.MessageParam[] {
  const cleaned: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((block) => {
            const rest = { ...(block as unknown as Record<string, unknown>) };
            delete rest.cache_control;
            return rest as never;
          }),
  }));

  const last = cleaned[cleaned.length - 1];
  if (!last) return cleaned;

  if (typeof last.content === "string") {
    if (last.content.trim().length === 0) return cleaned;
    last.content = [
      {
        type: "text",
        text: last.content,
        cache_control: { type: "ephemeral" },
      } as never,
    ];
  } else if (last.content.length > 0) {
    const lastBlock = last.content[last.content.length - 1] as unknown as Record<string, unknown>;
    lastBlock.cache_control = { type: "ephemeral" };
  }

  return cleaned;
}

/**
 * Build a system array with the stable prefix marked cacheable and the
 * volatile context (live counts, mentioned tickets) after the breakpoint
 * so its churn never invalidates the cached prefix.
 */
export function buildCachedSystem(
  stable: string,
  volatile: string,
): Anthropic.Messages.TextBlockParam[] {
  const blocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
  ];
  if (volatile.trim().length > 0) {
    blocks.push({ type: "text", text: volatile });
  }
  return blocks;
}
