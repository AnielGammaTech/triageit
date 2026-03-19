"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { TechMetrics, TeamOverview } from "./page";

type SortField = "name" | "openTickets" | "avgResponseHours" | "staleTickets" | "needsReviewTickets" | "resolvedTickets";

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function responseGrade(hours: number | null): { readonly label: string; readonly color: string } {
  if (hours === null) return { label: "N/A", color: "text-zinc-500" };
  if (hours <= 2) return { label: "Excellent", color: "text-emerald-400" };
  if (hours <= 8) return { label: "Good", color: "text-green-400" };
  if (hours <= 24) return { label: "Fair", color: "text-amber-400" };
  if (hours <= 48) return { label: "Slow", color: "text-orange-400" };
  return { label: "Critical", color: "text-red-400" };
}

function StatCard({
  label,
  value,
  subtitle,
  accent = "white",
}: {
  readonly label: string;
  readonly value: string | number;
  readonly subtitle?: string;
  readonly accent?: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", `text-${accent}`)}>{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function TechRow({
  tech,
  rank,
}: {
  readonly tech: TechMetrics;
  readonly rank: number;
}) {
  const grade = responseGrade(tech.avgResponseHours);
  const customerGrade = responseGrade(tech.avgCustomerWaitHours);

  return (
    <tr className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-xs font-medium text-zinc-400">
            {rank}
          </span>
          <div>
            <p className="font-medium text-zinc-200">{tech.name}</p>
            <p className="text-xs text-zinc-500">
              {tech.ticketsLastWeek} this week · {tech.ticketsLastMonth} this month
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 text-center">
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold text-zinc-200">{tech.openTickets}</span>
          <span className="text-xs text-zinc-500">/ {tech.totalTickets}</span>
        </span>
      </td>
      <td className="px-4 py-3.5 text-center">
        <div>
          <span className="font-semibold text-zinc-200">{formatHours(tech.avgResponseHours)}</span>
          <p className={cn("text-xs font-medium", grade.color)}>{grade.label}</p>
        </div>
      </td>
      <td className="px-4 py-3.5 text-center">
        <div>
          <span className="font-semibold text-zinc-200">{formatHours(tech.avgCustomerWaitHours)}</span>
          <p className={cn("text-xs font-medium", customerGrade.color)}>{customerGrade.label}</p>
        </div>
      </td>
      <td className="px-4 py-3.5 text-center">
        {tech.staleTickets > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-400">
            {tech.staleTickets}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">0</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-center">
        {tech.needsReviewTickets > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400 animate-pulse">
            {tech.needsReviewTickets}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">0</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-center">
        <span className="font-semibold text-emerald-400">{tech.resolvedTickets}</span>
      </td>
      <td className="px-4 py-3.5 text-center">
        {tech.oldestOpenDays !== null && tech.oldestOpenDays > 7 ? (
          <span className="text-xs font-medium text-red-400">{tech.oldestOpenDays}d</span>
        ) : tech.oldestOpenDays !== null ? (
          <span className="text-xs text-zinc-400">{tech.oldestOpenDays}d</span>
        ) : (
          <span className="text-xs text-zinc-500">—</span>
        )}
      </td>
    </tr>
  );
}

export function PerformanceDashboard({
  techMetrics,
  teamOverview,
}: {
  readonly techMetrics: ReadonlyArray<TechMetrics>;
  readonly teamOverview: TeamOverview;
}) {
  const [sortField, setSortField] = useState<SortField>("openTickets");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sorted = [...techMetrics].sort((a, b) => {
    const mul = sortAsc ? 1 : -1;
    switch (sortField) {
      case "name":
        return mul * a.name.localeCompare(b.name);
      case "openTickets":
        return mul * (a.openTickets - b.openTickets);
      case "avgResponseHours":
        return mul * ((a.avgResponseHours ?? 999) - (b.avgResponseHours ?? 999));
      case "staleTickets":
        return mul * (a.staleTickets - b.staleTickets);
      case "needsReviewTickets":
        return mul * (a.needsReviewTickets - b.needsReviewTickets);
      case "resolvedTickets":
        return mul * (a.resolvedTickets - b.resolvedTickets);
      default:
        return 0;
    }
  });

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortAsc ? " ↑" : " ↓";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Performance & Reporting</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Tech response quality, speed, and ticket ownership
          </p>
        </div>
        <p className="text-xs text-zinc-600">
          Updated on page load · Refresh to see latest data
        </p>
      </div>

      {/* Team overview cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Open Tickets"
          value={teamOverview.totalOpen}
          subtitle={`${teamOverview.unassignedTickets} unassigned`}
          accent="amber-400"
        />
        <StatCard
          label="Needs Review"
          value={teamOverview.totalNeedsReview}
          subtitle="Flagged by re-triage"
          accent="rose-400"
        />
        <StatCard
          label="Stale (3+ days)"
          value={teamOverview.totalStale}
          subtitle="No tech activity"
          accent="orange-400"
        />
        <StatCard
          label="Avg Response"
          value={formatHours(teamOverview.avgResponseHours)}
          subtitle="First tech action"
        />
        <StatCard
          label="Customer Wait"
          value={formatHours(teamOverview.avgCustomerWaitHours)}
          subtitle="Reply → tech action"
        />
      </div>

      {/* Triage activity */}
      <div className="flex gap-3">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3">
          <span className="text-xs text-zinc-500">Triaged today</span>
          <span className="ml-2 text-lg font-bold text-indigo-400">{teamOverview.ticketsTriagedToday}</span>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3">
          <span className="text-xs text-zinc-500">Triaged this week</span>
          <span className="ml-2 text-lg font-bold text-indigo-400">{teamOverview.ticketsTriagedThisWeek}</span>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3">
          <span className="text-xs text-zinc-500">Resolved</span>
          <span className="ml-2 text-lg font-bold text-emerald-400">{teamOverview.totalResolved}</span>
        </div>
      </div>

      {/* Tech performance table */}
      <div className="overflow-hidden rounded-xl border border-white/5">
        <div className="border-b border-white/5 bg-white/[0.02] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-zinc-300">Tech Performance Breakdown</h3>
          <p className="text-xs text-zinc-500">{techMetrics.length} technicians tracked</p>
        </div>

        {techMetrics.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-zinc-500">
              No tech assignment data yet. Tickets will appear here once they have an assigned agent in Halo.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01]">
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("name")}
                  >
                    Technician{sortArrow("name")}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("openTickets")}
                  >
                    Open / Total{sortArrow("openTickets")}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("avgResponseHours")}
                  >
                    Avg Response{sortArrow("avgResponseHours")}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Customer Wait
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("staleTickets")}
                  >
                    Stale{sortArrow("staleTickets")}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("needsReviewTickets")}
                  >
                    Needs Review{sortArrow("needsReviewTickets")}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleSort("resolvedTickets")}
                  >
                    Resolved{sortArrow("resolvedTickets")}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Oldest Open
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((tech, i) => (
                  <TechRow key={tech.name} tech={tech} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend / help */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Response Grades</h4>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span className="text-emerald-400">● Excellent (&lt;2h)</span>
          <span className="text-green-400">● Good (2-8h)</span>
          <span className="text-amber-400">● Fair (8-24h)</span>
          <span className="text-orange-400">● Slow (24-48h)</span>
          <span className="text-red-400">● Critical (&gt;48h)</span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Avg Response = time from ticket creation to first tech action.
          Customer Wait = time from customer reply to tech follow-up.
          Stale = open tickets with no tech activity for 3+ days.
          Needs Review = flagged by re-triage (every 3 hours) for critical/warning issues.
        </p>
      </div>
    </div>
  );
}
