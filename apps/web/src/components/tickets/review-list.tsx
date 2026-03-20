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

const RATING_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  great: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", label: "GREAT" },
  good: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", label: "GOOD" },
  needs_improvement: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", label: "NEEDS IMPROVEMENT" },
  poor: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", label: "POOR" },
};

const COMM_BAR_COLORS: Record<number, string> = {
  1: "bg-red-400",
  2: "bg-orange-400",
  3: "bg-amber-400",
  4: "bg-blue-400",
  5: "bg-emerald-400",
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ReviewListProps {
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}

export function ReviewList({ onSelectTicket, haloBaseUrl }: ReviewListProps) {
  const [reviews, setReviews] = useState<readonly TechReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/tech-reviews");
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews ?? []);
      }
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          No tech performance reviews yet. Reviews are generated when tickets are triaged.
        </p>
      </div>
    );
  }

  // Group by ticket — show latest review per ticket, but keep all for expansion
  const byTicket = new Map<string, readonly TechReview[]>();
  for (const r of reviews) {
    const existing = byTicket.get(r.ticket_id) ?? [];
    byTicket.set(r.ticket_id, [...existing, r]);
  }

  // Sort by latest review date
  const ticketGroups = [...byTicket.entries()].sort((a, b) => {
    const aDate = new Date(a[1][0].created_at).getTime();
    const bDate = new Date(b[1][0].created_at).getTime();
    return bDate - aDate;
  });

  // Stats
  const latestReviews = ticketGroups.map(([, revs]) => revs[0]);
  const poorCount = latestReviews.filter((r) => r.rating === "poor").length;
  const needsImpCount = latestReviews.filter((r) => r.rating === "needs_improvement").length;
  const goodCount = latestReviews.filter((r) => r.rating === "good").length;
  const greatCount = latestReviews.filter((r) => r.rating === "great").length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <span className="text-xs text-white/40">Tech Reviews</span>
        <div className="flex items-center gap-3 ml-auto">
          {poorCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-red-400 font-medium">{poorCount} Poor</span>
            </span>
          )}
          {needsImpCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-amber-400 font-medium">{needsImpCount} Needs Improvement</span>
            </span>
          )}
          {goodCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              <span className="text-blue-400 font-medium">{goodCount} Good</span>
            </span>
          )}
          {greatCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-medium">{greatCount} Great</span>
            </span>
          )}
        </div>
      </div>

      {/* Review cards */}
      {ticketGroups.map(([ticketId, ticketReviews]) => {
        const latest = ticketReviews[0];
        const style = RATING_STYLES[latest.rating] ?? RATING_STYLES.good;
        const isExpanded = expandedId === ticketId;
        const hasMultiple = ticketReviews.length > 1;
        const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${latest.halo_id}` : null;

        return (
          <div
            key={ticketId}
            className={cn(
              "rounded-lg border overflow-hidden",
              style.border,
              style.bg,
            )}
          >
            {/* Main review row */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : ticketId)}
            >
              {/* Rating badge */}
              <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-bold", style.bg, style.text)}>
                {style.label}
              </span>

              {/* Communication score dots */}
              <div className="flex items-center gap-0.5 shrink-0">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 w-3 rounded-full",
                      i <= latest.communication_score
                        ? COMM_BAR_COLORS[latest.communication_score] ?? "bg-white/40"
                        : "bg-white/10",
                    )}
                  />
                ))}
                <span className="ml-1 text-[10px] text-white/30">{latest.communication_score}/5</span>
              </div>

              {/* Ticket info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {haloLink ? (
                    <a
                      href={haloLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-indigo-400 hover:underline shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{latest.halo_id}
                    </a>
                  ) : (
                    <span className="text-xs font-mono text-white/40 shrink-0">#{latest.halo_id}</span>
                  )}
                  <span className="text-xs text-white/70 truncate">{latest.tickets.summary}</span>
                </div>
              </div>

              {/* Tech name */}
              <span className="text-xs text-white/40 shrink-0">
                {latest.tech_name ?? "Unassigned"}
              </span>

              {/* Time */}
              <span className="text-[10px] text-white/25 shrink-0 tabular-nums w-14 text-right">
                {timeAgo(latest.created_at)}
              </span>

              {/* Expand indicator */}
              <svg
                className={cn("h-3 w-3 text-white/20 transition-transform shrink-0", isExpanded && "rotate-180")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
                {/* Latest review detail */}
                <ReviewDetail review={latest} onViewTicket={() => onSelectTicket(ticketId)} />

                {/* Previous reviews */}
                {hasMultiple && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-white/25 uppercase tracking-wider">Previous Reviews ({ticketReviews.length - 1})</p>
                    {ticketReviews.slice(1).map((prev) => {
                      const prevStyle = RATING_STYLES[prev.rating] ?? RATING_STYLES.good;
                      return (
                        <div key={prev.id} className="flex items-center gap-2 rounded bg-white/[0.02] px-3 py-2">
                          <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", prevStyle.bg, prevStyle.text)}>
                            {prevStyle.label}
                          </span>
                          <span className="text-[10px] text-white/30">{latest.communication_score}/5 comm</span>
                          <span className="flex-1 text-[10px] text-white/40 truncate">{prev.summary}</span>
                          <span className="text-[10px] text-white/20">{timeAgo(prev.created_at)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewDetail({ review, onViewTicket }: { readonly review: TechReview; readonly onViewTicket: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-white/70 leading-relaxed">{review.summary}</p>

      <div className="grid grid-cols-2 gap-2">
        {review.strengths && (
          <div className="rounded bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
            <p className="text-[10px] text-emerald-400 font-medium mb-1">Strengths</p>
            <p className="text-[11px] text-emerald-300/70">{review.strengths}</p>
          </div>
        )}
        {review.improvement_areas && (
          <div className="rounded bg-amber-500/5 border border-amber-500/10 px-3 py-2">
            <p className="text-[10px] text-amber-400 font-medium mb-1">Improve</p>
            <p className="text-[11px] text-amber-300/70">{review.improvement_areas}</p>
          </div>
        )}
      </div>

      {review.suggestions.length > 0 && (
        <div className="rounded bg-blue-500/5 border border-blue-500/10 px-3 py-2">
          <p className="text-[10px] text-blue-400 font-medium mb-1">Suggestions</p>
          <ul className="space-y-0.5">
            {review.suggestions.map((s, i) => (
              <li key={i} className="text-[11px] text-blue-300/70">• {s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] text-white/20">
          Response: <span className="text-white/40">{review.response_time}</span>
        </span>
        <span className="text-[10px] text-white/20">
          Max gap: <span className="text-white/40">{review.max_gap_hours.toFixed(1)}h</span>
        </span>
        <span className="text-[10px] text-white/20">
          Client: <span className="text-white/40">{review.tickets.client_name ?? "Unknown"}</span>
        </span>
        <button
          onClick={onViewTicket}
          className="ml-auto text-[10px] text-indigo-400 hover:underline"
        >
          View ticket →
        </button>
      </div>
    </div>
  );
}
