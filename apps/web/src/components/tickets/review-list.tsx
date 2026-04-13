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

const RATINGS: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  poor: { label: "POOR", color: "text-red-400", bg: "bg-red-500/10", border: "border-l-red-500", dot: "bg-red-400" },
  needs_improvement: { label: "NEEDS IMP", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", dot: "bg-amber-400" },
  good: { label: "GOOD", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-l-blue-500", dot: "bg-blue-400" },
  great: { label: "GREAT", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-l-emerald-500", dot: "bg-emerald-400" },
};

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

interface ReviewListProps {
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}

export function ReviewList({ onSelectTicket, haloBaseUrl }: ReviewListProps) {
  const [reviews, setReviews] = useState<readonly TechReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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
    return <div className="flex items-center justify-center py-16"><div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" /></div>;
  }

  if (reviews.length === 0) {
    return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-16 text-center"><p className="text-sm text-white/30">No tech reviews for open tickets.</p></div>;
  }

  // Group by ticket, keep latest per ticket
  const byTicket = new Map<string, TechReview>();
  for (const r of reviews) {
    if (!byTicket.has(r.ticket_id)) byTicket.set(r.ticket_id, r);
  }
  const allReviews = [...byTicket.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const allTechs = [...new Set(allReviews.map((r) => resolveTechName(r).name))].sort();

  const filtered = allReviews.filter((r) => {
    const tech = resolveTechName(r);
    const q = search.toLowerCase();
    if (q && !r.tickets.summary.toLowerCase().includes(q) && !String(r.halo_id).includes(q) && !(r.tickets.client_name ?? "").toLowerCase().includes(q) && !tech.name.toLowerCase().includes(q)) return false;
    if (techFilter && tech.name !== techFilter) return false;
    if (ratingFilter && r.rating !== ratingFilter) return false;
    return true;
  });

  const counts = { poor: 0, needs_improvement: 0, good: 0, great: 0 };
  for (const r of filtered) { const k = r.rating as keyof typeof counts; if (k in counts) counts[k]++; }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="flex-1 min-w-[180px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/20 focus:outline-none" />
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

      {/* Summary */}
      <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-3">
        <span className="text-sm font-semibold text-white/50">{filtered.length} Reviews</span>
        <div className="flex items-center gap-4 ml-auto">
          {counts.poor > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-red-400"><span className="h-2.5 w-2.5 rounded-full bg-red-400" />{counts.poor} Poor</span>}
          {counts.needs_improvement > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-amber-400"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />{counts.needs_improvement} Needs Imp</span>}
          {counts.good > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-blue-400"><span className="h-2.5 w-2.5 rounded-full bg-blue-400" />{counts.good} Good</span>}
          {counts.great > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-400"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />{counts.great} Great</span>}
        </div>
      </div>

      {/* ── Scorecard rows — everything visible, no dropdowns ── */}
      <div className="space-y-2">
        {filtered.map((r) => {
          const style = RATINGS[r.rating] ?? RATINGS.good;
          const tech = resolveTechName(r);
          const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${r.halo_id}` : null;

          return (
            <div key={r.id} className={cn("rounded-xl border border-white/[0.06] border-l-[3px] overflow-hidden", style.border)}>
              {/* Top bar: rating + ticket + tech + time */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.02]">
                <span className={cn("shrink-0 text-[11px] font-black tracking-wider", style.color)}>{style.label}</span>

                {haloLink ? (
                  <a href={haloLink} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-white/50 hover:text-white/80 hover:underline" onClick={(e) => e.stopPropagation()}>
                    #{r.halo_id}
                  </a>
                ) : (
                  <span className="text-xs font-mono text-white/40">#{r.halo_id}</span>
                )}

                <span className="text-sm text-white/80 truncate flex-1">{r.tickets.summary}</span>

                <span className="hidden sm:block shrink-0 text-xs text-white/30 max-w-[100px] truncate">{r.tickets.client_name ?? ""}</span>
                <span className="hidden sm:block shrink-0 text-[10px] text-white/30 bg-white/[0.04] rounded px-1.5 py-0.5">{r.tickets.halo_status ?? "?"}</span>

                <span className={cn("shrink-0 text-sm font-medium", tech.isDispatch ? "text-red-400" : "text-white/60")}>
                  {tech.name}
                </span>

                <span className="shrink-0 text-xs text-white/20 tabular-nums">{timeAgo(r.created_at)}</span>
              </div>

              {/* Body: summary + strengths/issues side by side */}
              <div className="px-4 py-3 space-y-2">
                {/* Summary */}
                <p className="text-[13px] text-white/70 leading-relaxed">{r.summary}</p>

                {/* Metrics bar */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
                  <span>Response: <span className="text-white/70 font-medium">{r.response_time}</span></span>
                  {r.max_gap_hours > 0 && (
                    <span>Max gap: <span className={cn("font-medium", r.max_gap_hours > 4 ? "text-red-400" : r.max_gap_hours > 2 ? "text-amber-400" : "text-white/70")}>{r.max_gap_hours.toFixed(1)}h</span></span>
                  )}
                  <span>Comm: <span className="text-white/70 font-medium">{r.communication_score}/5</span></span>
                </div>

                {/* Strengths + Issues inline */}
                {(r.strengths || r.improvement_areas) && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    {r.strengths && (
                      <div className="flex-1 rounded-lg bg-emerald-500/[0.05] border border-emerald-500/15 px-3 py-2">
                        <span className="text-[10px] font-bold text-emerald-400 tracking-wider">GOOD: </span>
                        <span className="text-xs text-emerald-100/70">{r.strengths}</span>
                      </div>
                    )}
                    {r.improvement_areas && (
                      <div className="flex-1 rounded-lg bg-amber-500/[0.05] border border-amber-500/15 px-3 py-2">
                        <span className="text-[10px] font-bold text-amber-400 tracking-wider">FIX: </span>
                        <span className="text-xs text-amber-100/70">{r.improvement_areas}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Suggestions inline */}
                {r.suggestions.length > 0 && (
                  <div className="rounded-lg bg-blue-500/[0.04] border border-blue-500/12 px-3 py-2">
                    <span className="text-[10px] font-bold text-blue-400 tracking-wider">DO: </span>
                    <span className="text-xs text-blue-100/70">{r.suggestions.join(" | ")}</span>
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-2 px-4 py-2 border-t border-white/[0.04] bg-white/[0.01]">
                <button onClick={() => onSelectTicket(r.ticket_id)} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                  View Ticket
                </button>
                {haloLink && (
                  <>
                    <span className="text-white/10">|</span>
                    <a href={haloLink} target="_blank" rel="noopener noreferrer" className="text-xs text-white/40 hover:text-white/70 transition-colors">
                      Open in Halo
                    </a>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
