import { createClient } from "@/lib/supabase/server";
import { TobyDashboard } from "./toby-dashboard";

// ── Row types ───────────────────────────────────────────────────────

export interface TechProfileRow {
  readonly id: string;
  readonly tech_name: string;
  readonly avg_response_hours: number | null;
  readonly median_response_hours: number | null;
  readonly tickets_handled_30d: number;
  readonly tickets_handled_all_time: number;
  readonly avg_rating_score: number | null;
  readonly avg_communication_score: number | null;
  readonly great_count: number;
  readonly good_count: number;
  readonly needs_improvement_count: number;
  readonly poor_count: number;
  readonly strong_categories: readonly string[];
  readonly weak_categories: readonly string[];
  readonly patterns: Record<string, unknown> | null;
  readonly summary: string | null;
  readonly updated_at: string;
}

export interface TrendDetectionRow {
  readonly id: string;
  readonly trend_type: string;
  readonly title: string;
  readonly description: string;
  readonly severity: "critical" | "warning" | "info";
  readonly affected_entity: string | null;
  readonly affected_entity_type: string | null;
  readonly evidence: Record<string, unknown> | null;
  readonly recommendation: string | null;
  readonly is_acknowledged: boolean;
  readonly created_at: string;
}

export interface TriageEvaluationRow {
  readonly id: string;
  readonly ticket_id: string | null;
  readonly halo_id: number | null;
  readonly predicted_priority: number | null;
  readonly predicted_type: string | null;
  readonly predicted_urgency: number | null;
  readonly actual_resolution_hours: number | null;
  readonly actual_was_escalated: boolean | null;
  readonly actual_required_onsite: boolean | null;
  readonly priority_accurate: boolean | null;
  readonly type_accurate: boolean | null;
  readonly urgency_accurate: boolean | null;
  readonly overall_accuracy: number | null;
  readonly what_we_missed: string | null;
  readonly what_we_got_right: string | null;
  readonly improvement_suggestion: string | null;
  readonly created_at: string;
}

export interface TobyRunLogRow {
  readonly id: string;
  readonly run_type: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly tickets_analyzed: number;
  readonly tech_profiles_updated: number;
  readonly customer_insights_updated: number;
  readonly trends_detected: number;
  readonly triages_evaluated: number;
  readonly memories_created: number;
  readonly skills_updated: number;
  readonly tokens_used: number;
  readonly processing_time_ms: number | null;
  readonly status: "running" | "completed" | "error";
  readonly error_message: string | null;
  readonly summary: string | null;
}

// ── Data fetching ───────────────────────────────────────────────────

export default async function TobyAnalyticsPage() {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [techProfilesRes, trendsRes, evaluationsRes, runLogRes] = await Promise.all([
    supabase
      .from("tech_profiles")
      .select("*")
      .order("avg_rating_score", { ascending: false }),

    supabase
      .from("trend_detections")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false }),

    supabase
      .from("triage_evaluations")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false }),

    supabase
      .from("toby_run_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  const techProfiles = (techProfilesRes.data ?? []) as ReadonlyArray<TechProfileRow>;
  const trends = (trendsRes.data ?? []) as ReadonlyArray<TrendDetectionRow>;
  const evaluations = (evaluationsRes.data ?? []) as ReadonlyArray<TriageEvaluationRow>;
  const runLog = (runLogRes.data ?? []) as ReadonlyArray<TobyRunLogRow>;

  return (
    <TobyDashboard
      techProfiles={techProfiles}
      trends={trends}
      evaluations={evaluations}
      runLog={runLog}
    />
  );
}
