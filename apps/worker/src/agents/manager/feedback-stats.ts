import type { SupabaseClient } from "@supabase/supabase-js";
import { withCache } from "../../cache/integration-cache.js";

interface FeedbackStats {
  readonly totalFeedback: number;
  readonly helpfulRate: number;
  readonly classificationAccuracy: number;
  readonly priorityAccuracy: number;
  readonly topIssues: ReadonlyArray<string>;
}

/**
 * Get aggregated triage feedback stats — cached for 1 hour.
 * Used to inject accuracy context into Michael's synthesis prompt.
 */
export async function getFeedbackStats(supabase: SupabaseClient): Promise<FeedbackStats> {
  return withCache("feedback", "stats", async () => {
    const { data: feedback } = await supabase
      .from("triage_feedback")
      .select("rating, classification_accurate, priority_accurate, recommendations_useful, comment")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (!feedback || feedback.length === 0) {
      return {
        totalFeedback: 0,
        helpfulRate: 0,
        classificationAccuracy: 0,
        priorityAccuracy: 0,
        topIssues: [],
      };
    }

    const total = feedback.length;
    const helpful = feedback.filter((f) => f.rating === "helpful").length;
    const classCorrect = feedback.filter((f) => f.classification_accurate === true).length;
    const classRated = feedback.filter((f) => f.classification_accurate !== null).length;
    const prioCorrect = feedback.filter((f) => f.priority_accurate === true).length;
    const prioRated = feedback.filter((f) => f.priority_accurate !== null).length;

    // Extract common themes from negative feedback comments
    const negativeComments = feedback
      .filter((f) => f.rating === "not_helpful" && f.comment)
      .map((f) => f.comment as string)
      .slice(0, 5);

    return {
      totalFeedback: total,
      helpfulRate: Math.round((helpful / total) * 100),
      classificationAccuracy: classRated > 0 ? Math.round((classCorrect / classRated) * 100) : 0,
      priorityAccuracy: prioRated > 0 ? Math.round((prioCorrect / prioRated) * 100) : 0,
      topIssues: negativeComments,
    };
  }, 3600);
}

/**
 * Build a short context string about triage accuracy for Michael's prompt.
 */
export async function getFeedbackContext(supabase: SupabaseClient): Promise<string | null> {
  const stats = await getFeedbackStats(supabase);
  if (stats.totalFeedback < 5) return null; // Not enough data

  const lines = [
    `## Triage Accuracy (last 30 days, ${stats.totalFeedback} ratings)`,
    `- Overall helpful rate: ${stats.helpfulRate}%`,
    `- Classification accuracy: ${stats.classificationAccuracy}%`,
    `- Priority accuracy: ${stats.priorityAccuracy}%`,
  ];

  if (stats.topIssues.length > 0) {
    lines.push(`- Recent improvement areas: ${stats.topIssues.join("; ")}`);
  }

  return lines.join("\n");
}
