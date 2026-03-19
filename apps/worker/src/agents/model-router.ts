import type { ClassificationResult } from "./types.js";

/**
 * Smart model routing — selects the appropriate Claude model
 * based on ticket complexity indicators.
 *
 * Strategy:
 * - Haiku: Simple tickets (urgency 1-2, no security flag, high confidence)
 * - Sonnet: Complex tickets (urgency 3+, security flags, low confidence, multi-agent)
 *
 * Cost savings: Haiku is ~3x cheaper than Sonnet while maintaining 90% quality
 * for straightforward triage decisions.
 */

export type ModelTier = "claude-haiku-4-5-20251001" | "claude-sonnet-4-20250514";

export interface RoutingDecision {
  readonly model: ModelTier;
  readonly reason: string;
  readonly maxTokens: number;
}

/**
 * Determine which model to use for the manager synthesis step.
 */
export function selectManagerModel(
  classification: ClassificationResult,
  specialistCount: number,
): RoutingDecision {
  // Always use Sonnet for security-flagged tickets
  if (classification.security_flag) {
    return {
      model: "claude-sonnet-4-20250514",
      reason: "Security flag requires deeper analysis",
      maxTokens: 4096,
    };
  }

  // Always use Sonnet for high urgency (4-5)
  if (classification.urgency_score >= 4) {
    return {
      model: "claude-sonnet-4-20250514",
      reason: `High urgency (${classification.urgency_score}/5) requires careful synthesis`,
      maxTokens: 4096,
    };
  }

  // Use Sonnet when many specialists reported (complex multi-source synthesis)
  if (specialistCount >= 4) {
    return {
      model: "claude-sonnet-4-20250514",
      reason: `${specialistCount} specialist findings require thorough synthesis`,
      maxTokens: 4096,
    };
  }

  // Use Sonnet for low-confidence classifications (ambiguous tickets)
  if (classification.classification.confidence < 0.6) {
    return {
      model: "claude-sonnet-4-20250514",
      reason: `Low classification confidence (${(classification.classification.confidence * 100).toFixed(0)}%) — needs careful analysis`,
      maxTokens: 4096,
    };
  }

  // Medium urgency (3) with moderate confidence — Sonnet
  if (classification.urgency_score === 3 && classification.classification.confidence < 0.8) {
    return {
      model: "claude-sonnet-4-20250514",
      reason: "Medium urgency with moderate confidence",
      maxTokens: 4096,
    };
  }

  // Simple tickets (urgency 1-2, high confidence, few specialists) — Haiku
  return {
    model: "claude-haiku-4-5-20251001",
    reason: `Simple ticket (urgency ${classification.urgency_score}/5, ${(classification.classification.confidence * 100).toFixed(0)}% confidence) — using efficient model`,
    maxTokens: 2048,
  };
}
