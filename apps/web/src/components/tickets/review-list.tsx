"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

interface TechReview {
  readonly id: string;
  readonly ticket_id: string;
  readonly halo_id: number;
  readonly tech_name: string | null;
  readonly rating: string;
  readonly communication_score: number;
  readonly response_time: string;
  readonly max_gap_hours: number;
  readonly strengths: string | null;
  readonly improvement_areas: string | null;
  readonly suggestions: readonly string[];
  readonly summary: string;
  readonly created_at: string;
  readonly tickets: {
    readonly summary: string;
    readonly client_name: string | null;
    readonly halo_status: string | null;
    readonly halo_agent: string | null;
  };
}

// ── Rating config ───────────────────────────────────────────────────────

const RATINGS: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  ring: string;
  icon: string;
}> = {
  poor: {
    label: "POOR",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/25",
    ring: "ring-red-500/20",
    icon: "!",
  },
  needs_improvement: {
    label: "NEEDS IMPROVEMENT",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
    ring: "ring-amber-500/20",
    icon: "~",
  },
  good: {
    label: "GOOD",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
    ring: "ring-blue-500/20",
    icon: "+",
  },
  great: {
    label: "GREAT",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
    ring: "ring-emerald-500/20",
    icon: "*",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function resolveTechName(review: TechReview): { name: string; isDispatch: boolean } {
  const techName = review.tech_name;
  const haloAgent = review.tickets.halo_agent;
  if (techName && !/^\d+$/.test(techName.trim())) return { name: techName, isDispatch: false };
  if (haloAgent && !/^\d+$/.test(haloAgent.trim())) return { name: haloAgent, isDispatch: false };
  return { name: "Unassigned", isDispatch: true };
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York",
  });
}

// ── Component ───────────────────────────────────────────────────────────

interface ReviewListProps {
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}

export function ReviewList({ onSelectTicket, haloBaseUrl }: ReviewListProps) {
  const [reviews, setReviews] = useState<readonly TechReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");

  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/tech-reviews");
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews ?? []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-16 text-center">
        <p className="text-sm text-white/30">No tech reviews for open tickets.</p>
      </div>
    );
  }

  // Group by ticket
  const byTicket = new Map<string, readonly TechReview[]>();
  for (const r of reviews) {
    const existing = byTicket.get(r.ticket_id) ?? [];
    byTicket.set(r.ticket_id, [...existing, r]);
  }

  const ticketGroups = [...byTicket.entries()].sort((a, b) =>
    new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime(),
  );

  // Filters
  const allStatuses = [...new Set(ticketGroups.map(([, r]) => r[0].tickets.halo_status ?? "Unknown"))].sort();
  const allTechs = [...new Set(ticketGroups.map(([, r]) => resolveTechName(r[0]).name))].sort();

  const filtered = ticketGroups.filter(([, revs]) => {
    const r = revs[0];
    const tech = resolveTechName(r);
    const q = search.toLowerCase();
    if (q && !r.tickets.summary.toLowerCase().includes(q) && !String(r.halo_id).includes(q) && !(r.tickets.client_name ?? "").toLowerCase().includes(q) && !tech.name.toLowerCase().includes(q)) return false;
    if (statusFilter && (r.tickets.halo_status ?? "Unknown") !== statusFilter) return false;
    if (techFilter && tech.name !== techFilter) return false;
    if (ratingFilter && r.rating !== ratingFilter) return false;
    return true;
  });

  const counts = { poor: 0, needs_improvement: 0, good: 0, great: 0 };
  for (const [, revs] of filtered) {
    const r = revs[0].rating as keyof typeof counts;
    if (r in counts) counts[r]++;
  }

  return (
    <div className="space-y-3">
      {/* ── Filters ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reviews..."
          className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/20 focus:outline-none"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/70 focus:outline-none">
          <option value="">All Statuses</option>
          {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/70 focus:outline-none">
          <option value="">All Techs</option>
          {allTechs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/70 focus:outline-none">
          <option value="">All Ratings</option>
          <option value="poor">Poor</option>
          <option value="needs_improvement">Needs Improvement</option>
          <option value="good">Good</option>
          <option value="great">Great</option>
        </select>
      </div>

      {/* ── Summary bar ──────────────────────────────────── */}
      <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-3">
        <span className="text-sm font-semibold text-white/50">{filtered.length} Reviews</span>
        <div className="flex items-center gap-4 ml-auto">
          {counts.poor > 0 && <span className="flex items-center gap-1.5 text-sm font-semibold text-red-400"><span className="h-2.5 w-2.5 rounded-full bg-red-400" />{counts.poor}</span>}
          {counts.needs_improvement > 0 && <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-400"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />{counts.needs_improvement}</span>}
          {counts.good > 0 && <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-400"><span className="h-2.5 w-2.5 rounded-full bg-blue-400" />{counts.good}</span>}
          {counts.great > 0 && <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />{counts.great}</span>}
        </div>
      </div>

      {/* ── Review cards ─────────────────────────────────── */}
      <div className="space-y-2">
        {filtered.map(([ticketId, ticketReviews]) => {
          const r = ticketReviews[0];
          const style = RATINGS[r.rating] ?? RATINGS.good;
          const tech = resolveTechName(r);
          const isOpen = expandedId === ticketId;
          const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${r.halo_id}` : null;

          return (
            <div key={ticketId} className={cn("rounded-xl border overflow-hidden transition-all", style.border, isOpen && `ring-1 ${style.ring}`)}>
              {/* ── Row ─────────────────────────────────── */}
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : ticketId)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
              >
                {/* Rating */}
                <span className={cn("shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black", style.bg, style.color)}>
                  {style.icon}
                </span>

                {/* Ticket info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-xs font-bold tracking-wider", style.color)}>{style.label}</span>
                    <span className="text-xs text-white/25">|</span>
                    <span className="text-xs font-mono text-white/40">#{r.halo_id}</span>
                    {ticketReviews.length > 1 && (
                      <span className="text-[10px] text-white/30 bg-white/[0.05] rounded px-1.5 py-0.5">{ticketReviews.length}x</span>
                    )}
                  </div>
                  <p className="text-sm text-white/80 truncate">{r.tickets.summary}</p>
                </div>

                {/* Client */}
                <span className="hidden sm:block shrink-0 text-xs text-white/30 max-w-[120px] truncate">
                  {r.tickets.client_name ?? "—"}
                </span>

                {/* Status */}
                <span className="hidden sm:block shrink-0 text-[10px] text-white/40 bg-white/[0.05] rounded-full px-2 py-0.5">
                  {r.tickets.halo_status ?? "?"}
                </span>

                {/* Tech */}
                <span className={cn("hidden sm:block shrink-0 text-sm font-medium min-w-[100px] text-right", tech.isDispatch ? "text-red-400/80" : "text-white/60")}>
                  {tech.name}
                </span>

                {/* Time */}
                <span className="shrink-0 text-xs text-white/20 tabular-nums w-8 text-right">
                  {timeAgo(r.created_at)}
                </span>

                {/* Chevron */}
                <svg className={cn("shrink-0 h-4 w-4 text-white/20 transition-transform", isOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* ── Expanded detail ─────────────────────── */}
              {isOpen && (
                <div className="border-t border-white/[0.06] bg-white/[0.01]">
                  <div className="p-5 space-y-4">
                    {/* Header row */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={cn("rounded-lg px-3 py-1 text-xs font-black tracking-wider", style.bg, style.color)}>{style.label}</span>
                      <span className="text-sm text-white/40">{formatDate(r.created_at)}</span>
                      <span className="text-sm text-white/40">Response: <span className="text-white/70 font-medium">{r.response_time}</span></span>
                      {r.max_gap_hours > 0 && (
                        <span className="text-sm text-white/40">Max gap: <span className={cn("font-medium", r.max_gap_hours > 4 ? "text-red-400" : "text-white/70")}>{r.max_gap_hours.toFixed(1)}h</span></span>
                      )}
                    </div>

                    {/* Summary */}
                    <p className="text-[15px] text-white/90 leading-relaxed">{r.summary}</p>

                    {/* Strengths & Issues grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {r.strengths && (
                        <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            <span className="text-xs font-bold text-emerald-400 tracking-wider">STRENGTHS</span>
                          </div>
                          <p className="text-sm text-emerald-100/80 leading-relaxed">{r.strengths}</p>
                        </div>
                      )}
                      {r.improvement_areas && (
                        <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/20 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="h-2 w-2 rounded-full bg-amber-400" />
                            <span className="text-xs font-bold text-amber-400 tracking-wider">NEEDS WORK</span>
                          </div>
                          <p className="text-sm text-amber-100/80 leading-relaxed">{r.improvement_areas}</p>
                        </div>
                      )}
                    </div>

                    {/* Suggestions */}
                    {r.suggestions.length > 0 && (
                      <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/20 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-2 w-2 rounded-full bg-blue-400" />
                          <span className="text-xs font-bold text-blue-400 tracking-wider">SUGGESTIONS</span>
                        </div>
                        <ul className="space-y-1.5">
                          {r.suggestions.map((s, i) => (
                            <li key={i} className="text-sm text-blue-100/80 leading-relaxed flex gap-2">
                              <span className="text-blue-400/60 shrink-0">{i + 1}.</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Footer actions */}
                    <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-white/[0.06]">
                      <span className="text-sm text-white/40">
                        <span className="text-white/60 font-medium">{r.tickets.client_name ?? "Unknown"}</span>
                      </span>
                      <span className="text-sm text-white/40">
                        Tech: <span className={cn("font-medium", tech.isDispatch ? "text-red-400/80" : "text-white/60")}>{tech.name}</span>
                      </span>
                      <div className="flex gap-2 ml-auto">
                        {haloLink && (
                          <a
                            href={haloLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white/50 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
                          >
                            Open in Halo
                          </a>
                        )}
                        <button
                          onClick={() => onSelectTicket(ticketId)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-[#b91c1c] hover:bg-[#991b1b] transition-colors"
                        >
                          View Ticket
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
