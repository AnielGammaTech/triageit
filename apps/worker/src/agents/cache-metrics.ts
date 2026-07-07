/**
 * Prompt-cache observability. Logs per-call cache activity so Railway
 * logs show whether caching is actually saving tokens.
 *
 * Reading the numbers: cache_read tokens bill at ~10% of input price;
 * cache_write at 125%. Zero reads across repeated calls means the prefix
 * is below the model minimum (4096 tokens on Haiku 4.5) or is being
 * invalidated by per-request content.
 */

interface CacheUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

export function logCacheUsage(label: string, usage: CacheUsage): void {
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  console.log(
    `[CACHE] ${label}: input=${usage.input_tokens} cache_write=${write} cache_read=${read} output=${usage.output_tokens}`,
  );
}
