"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import type {
  TechProfileRow,
  TrendDetectionRow,
  TriageEvaluationRow,
  TobyRunLogRow,
} from "./page";

// ── Helpers ─────────────────────────────────────────────────────────

function formatHours(hours: number | null): string {
  if (hours === null) return "--";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function responseColor(hours: number | null): string {
  if (hours === null) return "text-zinc-500";
  if (hours <= 2) return "text-emerald-400";
  if (hours <= 8) return "text-green-400";
  if (hours <= 24) return "text-amber-400";
  if (hours <= 48) return "text-orange-400";
  return "text-red-400";
}

function severityBadge(severity: "critical" | "warning" | "info") {
  const map = {
    critical: "bg-red-500/15 text-red-400 border-red-500/20",
    warning: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    info: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  } as const;
  return map[severity];
}

function accuracyColor(accurate: boolean | null): string {
  if (accurate === null) return "text-zinc-500";
  return accurate ? "text-emerald-400" : "text-red-400";
}

function statusBadge(status: "running" | "completed" | "error") {
  const map = {
    running: "bg-blue-500/15 text-blue-400",
    completed: "bg-emerald-500/15 text-emerald-400",
    error: "bg-red-500/15 text-red-400",
  } as const;
  return map[status];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

// ── Section header ──────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div className="border-b border-white/5 bg-white/[0.02] px-5 py-3.5">
      <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
      <p className="text-xs text-zinc-500">{subtitle}</p>
    </div>
  );
}

// ── Section 1: Tech Scorecards ──────────────────────────────────────

function TechScorecard({ tech }: { readonly tech: TechProfileRow }) {
  const totalRatings =
    tech.great_count + tech.good_count + tech.needs_improvement_count + tech.poor_count;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-zinc-200">{tech.tech_name}</h4>
        {tech.avg_rating_score !== null && (
          <span className="text-xs font-medium text-zinc-400">
            {tech.avg_rating_score.toFixed(2)} / 4.00
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-zinc-500">Avg Response</p>
          <p className={cn("font-semibold", responseColor(tech.avg_response_hours))}>
            {formatHours(tech.avg_response_hours)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Tickets (30d)</p>
          <p className="font-semibold text-zinc-200">{tech.tickets_handled_30d}</p>
        </div>
        <div>
          <p className="text-zinc-500">Total Ratings</p>
          <p className="font-semibold text-zinc-200">{totalRatings}</p>
        </div>
      </div>

      {/* Rating breakdown bar */}
      {totalRatings > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Rating Breakdown</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
            {tech.great_count > 0 && (
              <div
                className="bg-emerald-500"
                style={{ width: `${(tech.great_count / totalRatings) * 100}%` }}
              />
            )}
            {tech.good_count > 0 && (
              <div
                className="bg-green-500"
                style={{ width: `${(tech.good_count / totalRatings) * 100}%` }}
              />
            )}
            {tech.needs_improvement_count > 0 && (
              <div
                className="bg-amber-500"
                style={{ width: `${(tech.needs_improvement_count / totalRatings) * 100}%` }}
              />
            )}
            {tech.poor_count > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(tech.poor_count / totalRatings) * 100}%` }}
              />
            )}
          </div>
          <div className="flex gap-3 text-[10px] text-zinc-500">
            <span className="text-emerald-400">{tech.great_count} great</span>
            <span className="text-green-400">{tech.good_count} good</span>
            <span className="text-amber-400">{tech.needs_improvement_count} needs imp.</span>
            <span className="text-red-400">{tech.poor_count} poor</span>
          </div>
        </div>
      )}

      {/* Strong / Weak categories */}
      <div className="space-y-2">
        {tech.strong_categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tech.strong_categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
        {tech.weak_categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tech.weak_categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400 border border-red-500/20"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {tech.summary && (
        <p className="text-xs text-zinc-500 leading-relaxed">{tech.summary}</p>
      )}
    </div>
  );
}

function TechScorecardsSection({
  profiles,
}: {
  readonly profiles: ReadonlyArray<TechProfileRow>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <SectionHeader
        title="Tech Scorecards"
        subtitle={`${profiles.length} technicians profiled`}
      />
      {profiles.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-zinc-500">
            No tech profiles yet. Toby will generate these on the next analysis run.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((tech) => (
            <TechScorecard key={tech.id} tech={tech} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 2: Trend Detections ─────────────────────────────────────

function TrendCard({
  trend,
  onAcknowledge,
}: {
  readonly trend: TrendDetectionRow;
  readonly onAcknowledge: (id: string) => void;
}) {
  return (
    <div className="border-b border-white/5 px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                severityBadge(trend.severity),
              )}
            >
              {trend.severity}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">
              {trend.trend_type}
            </span>
            {trend.affected_entity && (
              <span className="text-[10px] text-zinc-500">
                {trend.affected_entity_type}: {trend.affected_entity}
              </span>
            )}
          </div>
          <h4 className="text-sm font-medium text-zinc-200">{trend.title}</h4>
          <p className="text-xs text-zinc-400 leading-relaxed">{trend.description}</p>
          {trend.recommendation && (
            <p className="text-xs text-indigo-400 leading-relaxed">
              Recommendation: {trend.recommendation}
            </p>
          )}
          <p className="text-[10px] text-zinc-600">{formatDate(trend.created_at)}</p>
        </div>
        <div className="flex-shrink-0">
          {trend.is_acknowledged ? (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-medium text-zinc-500">
              Acknowledged
            </span>
          ) : (
            <button
              onClick={() => onAcknowledge(trend.id)}
              className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Acknowledge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendDetectionsSection({
  trends: initialTrends,
}: {
  readonly trends: ReadonlyArray<TrendDetectionRow>;
}) {
  const [trends, setTrends] = useState<ReadonlyArray<TrendDetectionRow>>(initialTrends);

  const handleAcknowledge = useCallback(async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("trend_detections")
      .update({ is_acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return;
    }

    setTrends((prev) =>
      prev.map((t) => (t.id === id ? { ...t, is_acknowledged: true } : t)),
    );
  }, []);

  const unacknowledgedCount = trends.filter((t) => !t.is_acknowledged).length;

  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <SectionHeader
        title="Trend Detections"
        subtitle={`${trends.length} trends (last 30 days) · ${unacknowledgedCount} unacknowledged`}
      />
      {trends.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-zinc-500">
            No trends detected yet. Toby looks for spikes, recurring issues, and anomalies.
          </p>
        </div>
      ) : (
        <div>
          {trends.map((trend) => (
            <TrendCard
              key={trend.id}
              trend={trend}
              onAcknowledge={handleAcknowledge}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 3: Triage Accuracy ──────────────────────────────────────

function AccuracySummary({
  evaluations,
}: {
  readonly evaluations: ReadonlyArray<TriageEvaluationRow>;
}) {
  if (evaluations.length === 0) return null;

  const withOverall = evaluations.filter((e) => e.overall_accuracy !== null);
  const withType = evaluations.filter((e) => e.type_accurate !== null);
  const withPriority = evaluations.filter((e) => e.priority_accurate !== null);

  const overallPct =
    withOverall.length > 0
      ? (withOverall.reduce((sum, e) => sum + (e.overall_accuracy ?? 0), 0) /
          withOverall.length) *
        100
      : null;

  const typePct =
    withType.length > 0
      ? (withType.filter((e) => e.type_accurate).length / withType.length) * 100
      : null;

  const priorityPct =
    withPriority.length > 0
      ? (withPriority.filter((e) => e.priority_accurate).length / withPriority.length) *
        100
      : null;

  return (
    <div className="grid grid-cols-3 gap-3 p-4">
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Overall Accuracy
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold",
            overallPct !== null && overallPct >= 70
              ? "text-emerald-400"
              : overallPct !== null && overallPct >= 50
                ? "text-amber-400"
                : "text-red-400",
          )}
        >
          {overallPct !== null ? `${overallPct.toFixed(0)}%` : "--"}
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-600">{withOverall.length} evaluated</p>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Classification
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold",
            typePct !== null && typePct >= 70
              ? "text-emerald-400"
              : typePct !== null && typePct >= 50
                ? "text-amber-400"
                : "text-red-400",
          )}
        >
          {typePct !== null ? `${typePct.toFixed(0)}%` : "--"}
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-600">{withType.length} evaluated</p>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Priority
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold",
            priorityPct !== null && priorityPct >= 70
              ? "text-emerald-400"
              : priorityPct !== null && priorityPct >= 50
                ? "text-amber-400"
                : "text-red-400",
          )}
        >
          {priorityPct !== null ? `${priorityPct.toFixed(0)}%` : "--"}
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-600">{withPriority.length} evaluated</p>
      </div>
    </div>
  );
}

function EvaluationRow({ evaluation }: { readonly evaluation: TriageEvaluationRow }) {
  const isAccurate = evaluation.overall_accuracy !== null && evaluation.overall_accuracy >= 0.7;

  return (
    <div
      className={cn(
        "border-b border-white/5 px-5 py-3 last:border-b-0",
        isAccurate ? "border-l-2 border-l-emerald-500/30" : "border-l-2 border-l-red-500/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              #{evaluation.halo_id ?? "N/A"}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium",
                isAccurate ? "text-emerald-400" : "text-red-400",
              )}
            >
              {evaluation.overall_accuracy !== null
                ? `${(evaluation.overall_accuracy * 100).toFixed(0)}% accurate`
                : "Not scored"}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-[10px]">
            {evaluation.predicted_type && (
              <span>
                <span className="text-zinc-500">Type: </span>
                <span className={accuracyColor(evaluation.type_accurate)}>
                  {evaluation.predicted_type}
                  {evaluation.type_accurate === false ? " (wrong)" : ""}
                </span>
              </span>
            )}
            {evaluation.predicted_priority !== null && (
              <span>
                <span className="text-zinc-500">Priority: </span>
                <span className={accuracyColor(evaluation.priority_accurate)}>
                  P{evaluation.predicted_priority}
                  {evaluation.priority_accurate === false ? " (wrong)" : ""}
                </span>
              </span>
            )}
          </div>
          {evaluation.what_we_missed && (
            <p className="text-xs text-red-400/80">Missed: {evaluation.what_we_missed}</p>
          )}
          {evaluation.improvement_suggestion && (
            <p className="text-xs text-indigo-400/80">
              Improve: {evaluation.improvement_suggestion}
            </p>
          )}
        </div>
        <span className="flex-shrink-0 text-[10px] text-zinc-600">
          {formatDate(evaluation.created_at)}
        </span>
      </div>
    </div>
  );
}

function TriageAccuracySection({
  evaluations,
}: {
  readonly evaluations: ReadonlyArray<TriageEvaluationRow>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <SectionHeader
        title="Triage Accuracy"
        subtitle={`${evaluations.length} evaluations (last 30 days)`}
      />
      {evaluations.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-zinc-500">
            No evaluations yet. Toby compares AI predictions vs actual outcomes for
            resolved tickets.
          </p>
        </div>
      ) : (
        <>
          <AccuracySummary evaluations={evaluations} />
          <div>
            {evaluations.slice(0, 20).map((evaluation) => (
              <EvaluationRow key={evaluation.id} evaluation={evaluation} />
            ))}
            {evaluations.length > 20 && (
              <div className="px-5 py-3 text-center text-xs text-zinc-600">
                Showing 20 of {evaluations.length} evaluations
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Section 4: Run History ──────────────────────────────────────────

function RunHistorySection({
  runLog,
}: {
  readonly runLog: ReadonlyArray<TobyRunLogRow>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <SectionHeader
        title="Run History"
        subtitle={`Last ${runLog.length} Toby analysis runs`}
      />
      {runLog.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-zinc-500">
            No runs recorded yet. Toby runs daily at 2 AM ET or can be triggered manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01]">
                <th className="px-4 py-2.5 text-left font-medium uppercase tracking-wider text-zinc-500">
                  Date
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Type
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Tickets
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Profiles
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Trends
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Tokens
                </th>
                <th className="px-4 py-2.5 text-center font-medium uppercase tracking-wider text-zinc-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {runLog.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-2.5 text-zinc-300">
                    {formatDate(run.started_at)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                      {run.run_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-zinc-300">
                    {run.tickets_analyzed}
                  </td>
                  <td className="px-4 py-2.5 text-center text-zinc-300">
                    {run.tech_profiles_updated}
                  </td>
                  <td className="px-4 py-2.5 text-center text-zinc-300">
                    {run.trends_detected}
                  </td>
                  <td className="px-4 py-2.5 text-center text-zinc-400">
                    {formatTokens(run.tokens_used)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        statusBadge(run.status),
                      )}
                    >
                      {run.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────

export function TobyDashboard({
  techProfiles,
  trends,
  evaluations,
  runLog,
}: {
  readonly techProfiles: ReadonlyArray<TechProfileRow>;
  readonly trends: ReadonlyArray<TrendDetectionRow>;
  readonly evaluations: ReadonlyArray<TriageEvaluationRow>;
  readonly runLog: ReadonlyArray<TobyRunLogRow>;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Toby&apos;s Learning Insights</h2>
          <p className="mt-1 text-sm text-zinc-500">
            AI-generated analytics from ticket patterns, tech behavior, and triage accuracy
          </p>
        </div>
        <p className="text-xs text-zinc-600">
          Last run:{" "}
          {runLog.length > 0 ? formatDate(runLog[0].started_at) : "Never"}
        </p>
      </div>

      <TechScorecardsSection profiles={techProfiles} />
      <TrendDetectionsSection trends={trends} />
      <TriageAccuracySection evaluations={evaluations} />
      <RunHistorySection runLog={runLog} />
    </div>
  );
}
