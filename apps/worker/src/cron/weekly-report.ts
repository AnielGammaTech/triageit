import { createSupabaseClient } from "../db/supabase.js";
import { TeamsClient } from "../integrations/teams/client.js";
import { getTechNames } from "../db/staff.js";
import type { TeamsConfig } from "@triageit/shared";

interface TechScore {
  readonly name: string;
  readonly ticketsHandled: number;
  readonly avgResponseHours: number;
  readonly rating: string;
  readonly trend: "improving" | "stable" | "declining";
}

interface WeeklyReportResult {
  readonly totalTickets: number;
  readonly closedTickets: number;
  readonly avgResponseHours: number;
  readonly feedbackScore: number;
  readonly mvpName: string | null;
  readonly techScores: ReadonlyArray<TechScore>;
  readonly topIssues: ReadonlyArray<string>;
}

/**
 * Generate and send a weekly team performance report card.
 * Runs Monday 8 AM ET.
 */
export async function generateWeeklyReport(): Promise<WeeklyReportResult> {
  const supabase = createSupabaseClient();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Tickets opened this week
  const { data: openedTickets } = await supabase
    .from("tickets")
    .select("id")
    .gte("created_at", oneWeekAgo);

  // Tickets closed/resolved this week
  const { data: closedTickets } = await supabase
    .from("tickets")
    .select("id")
    .in("halo_status", ["Closed", "Resolved", "Resolved Remotely", "Resolved Onsite"])
    .gte("updated_at", oneWeekAgo);

  // Tech reviews this week
  const { data: weekReviews } = await supabase
    .from("tech_reviews")
    .select("tech_name, rating, response_time, max_gap_hours")
    .gte("created_at", oneWeekAgo);

  // Tech profiles (overall stats)
  const { data: profiles } = await supabase
    .from("tech_profiles")
    .select("tech_name, avg_response_hours, avg_rating_score, tickets_handled_30d, strong_categories");

  // Triage feedback this week
  const { data: feedback } = await supabase
    .from("triage_feedback")
    .select("rating")
    .gte("created_at", oneWeekAgo);

  // Top issue types this week
  const { data: triageResults } = await supabase
    .from("triage_results")
    .select("classification")
    .gte("created_at", oneWeekAgo);

  // Build tech scores
  const techNames = await getTechNames(supabase);
  const techScores: TechScore[] = [];

  for (const name of techNames) {
    const reviews = (weekReviews ?? []).filter(
      (r) => r.tech_name?.toLowerCase() === name.toLowerCase(),
    );
    const profile = (profiles ?? []).find(
      (p) => p.tech_name?.toLowerCase() === name.toLowerCase(),
    );

    if (reviews.length === 0 && !profile) continue;

    const ratingMap: Record<string, number> = { great: 4, good: 3, needs_improvement: 2, poor: 1 };
    const weekAvg = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (ratingMap[r.rating] ?? 0), 0) / reviews.length
      : 0;
    const overallAvg = profile?.avg_rating_score ?? 0;

    const trend: "improving" | "stable" | "declining" =
      weekAvg === 0 || overallAvg === 0
        ? "stable"
        : weekAvg > overallAvg + 0.3
          ? "improving"
          : weekAvg < overallAvg - 0.3
            ? "declining"
            : "stable";

    const ratingLabel = weekAvg >= 3.5 ? "Great" : weekAvg >= 2.5 ? "Good" : weekAvg >= 1.5 ? "Needs Work" : reviews.length > 0 ? "Poor" : "N/A";

    techScores.push({
      name,
      ticketsHandled: reviews.length,
      avgResponseHours: profile?.avg_response_hours ?? 0,
      rating: ratingLabel,
      trend,
    });
  }

  // Sort by tickets handled descending
  techScores.sort((a, b) => b.ticketsHandled - a.ticketsHandled);

  // MVP: highest rated tech with 2+ tickets
  const mvpCandidates = techScores.filter((t) => t.ticketsHandled >= 2);
  const ratingOrder = ["Great", "Good", "Needs Work", "Poor", "N/A"];
  mvpCandidates.sort((a, b) => ratingOrder.indexOf(a.rating) - ratingOrder.indexOf(b.rating));
  const mvpName = mvpCandidates[0]?.name ?? null;

  // Feedback score
  const totalFeedback = feedback?.length ?? 0;
  const helpful = feedback?.filter((f) => f.rating === "helpful").length ?? 0;
  const feedbackScore = totalFeedback > 0 ? Math.round((helpful / totalFeedback) * 100) : 0;

  // Top issue types
  const typeCounts = new Map<string, number>();
  for (const tr of triageResults ?? []) {
    const type = (tr.classification as { type?: string })?.type ?? "other";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const topIssues = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `${type} (${count})`);

  // Average team response
  const allResponseHours = techScores.filter((t) => t.avgResponseHours > 0).map((t) => t.avgResponseHours);
  const avgResponseHours = allResponseHours.length > 0
    ? allResponseHours.reduce((a, b) => a + b, 0) / allResponseHours.length
    : 0;

  const report: WeeklyReportResult = {
    totalTickets: openedTickets?.length ?? 0,
    closedTickets: closedTickets?.length ?? 0,
    avgResponseHours: Math.round(avgResponseHours * 10) / 10,
    feedbackScore,
    mvpName,
    techScores,
    topIssues,
  };

  // Send to Teams
  const { data: teamsIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  if (teamsIntegration) {
    const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
    const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    await teams.sendWeeklyReport({
      weekOf,
      ...report,
      mvpReason: mvpName ? `Highest rated tech with 2+ tickets this week` : null,
    });

    console.log(`[WEEKLY-REPORT] Sent to Teams: ${report.totalTickets} opened, ${report.closedTickets} closed, ${techScores.length} techs`);
  }

  return report;
}
