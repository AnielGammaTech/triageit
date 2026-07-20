import type Anthropic from "@anthropic-ai/sdk";
import { extractResponseText } from "./llm-text.js";
import { parseLlmJson } from "./parse-json.js";

export interface LlmJsonResult<T> {
  readonly value: T;
  readonly response: Anthropic.Message;
  readonly attempts: number;
}

/**
 * Request structured JSON with one bounded recovery attempt.
 *
 * Some Anthropic-compatible providers can spend the whole token allowance on
 * a thinking block and return no text. JSON can also be truncated. We disable
 * extended thinking for deterministic data extraction, double the retry token
 * budget, and only accept a response that both contains text and parses.
 */
export async function requestLlmJson<T>(
  client: Anthropic,
  request: Anthropic.MessageCreateParamsNonStreaming,
  label: string,
  retryMaxTokens = 8_192,
): Promise<LlmJsonResult<T>> {
  let lastError: unknown = null;
  let lastResponse: Anthropic.Message | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const maxTokens = attempt === 1
      ? request.max_tokens
      : Math.min(retryMaxTokens, Math.max(request.max_tokens * 2, 2_048));
    const response = await client.messages.create({
      ...request,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
    });
    lastResponse = response;
    const text = extractResponseText(response);

    if (text) {
      try {
        return { value: parseLlmJson<T>(text), response, attempts: attempt };
      } catch (error) {
        lastError = error;
        console.warn(`[LLM] ${label} returned malformed JSON on attempt ${attempt}`);
      }
    } else {
      lastError = new Error(`no text (stop_reason: ${response.stop_reason ?? "unknown"})`);
    }

    if (attempt === 1) {
      console.warn(`[LLM] ${label} retrying with ${maxTokens === request.max_tokens ? Math.min(retryMaxTokens, Math.max(request.max_tokens * 2, 2_048)) : maxTokens} tokens`);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown failure");
  throw new Error(`${label} failed after 2 attempts: ${detail}${lastResponse ? ` (stop_reason: ${lastResponse.stop_reason ?? "unknown"})` : ""}`);
}
