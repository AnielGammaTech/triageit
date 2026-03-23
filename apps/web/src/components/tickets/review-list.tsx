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

const RATING_STYLES: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  great: { bg: "bg-red-900/20", text: "text-red-200", border: "border-red-800/30", label: "GREAT", dot: "bg-red-300" },
  good: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/20", label: "GOOD", dot: "bg-red-400" },
  needs_improvement: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20", label: "NEEDS IMPROVEMENT", dot: "bg-rose-400" },
  poor: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/25", label: "POOR", dot: "bg-red-400" },
};

const COMM_BAR_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-red-400",
  3: "bg-rose-400",
  4: "bg-red-300",
  5: "bg-red-200",
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ReviewListProps {
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}

export function ReviewList({ onSelectTicket, haloBaseUrl }: ReviewListProps) {
  const [reviews, setReviews] = useState<readonly TechReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versionIndex, setVersionIndex] = useState<Record<string, number>>({});

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

  // Group by ticket — keep all reviews per ticket
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
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <span className="text-xs text-white/40">
          {latestReviews.length} Tech {latestReviews.length === 1 ? "Review" : "Reviews"}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 ml-auto">
          {poorCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-red-400 font-medium">{poorCount} Poor</span>
            </span>
          )}
          {needsImpCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              <span className="text-rose-400 font-medium">{needsImpCount} Needs Improvement</span>
            </span>
          )}
          {goodCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-300" />
              <span className="text-red-300 font-medium">{goodCount} Good</span>
            </span>
          )}
          {greatCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-200" />
              <span className="text-red-200 font-medium">{greatCount} Great</span>
            </span>
          )}
        </div>
      </div>

      {/* Review cards */}
      {ticketGroups.map(([ticketId, ticketReviews]) => {
        const latest = ticketReviews[0];
        const style = RATING_STYLES[latest.rating] ?? RATING_STYLES.good;
        const isExpanded = expandedId === ticketId;
        const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${latest.halo_id}` : null;
        const currentVersion = versionIndex[ticketId] ?? 0;
        const review = ticketReviews[currentVersion];
        const revStyle = RATING_STYLES[review.rating] ?? RATING_STYLES.good;

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
              className="px-3 sm:px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : ticketId)}
            >
              {/* Mobile layout */}
              <div className="sm:hidden">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide", style.bg, style.text)}>
                    {style.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/30 tabular-nums">{timeAgo(latest.created_at)}</span>
                    <svg
                      className={cn("h-4 w-4 text-white/25 transition-transform shrink-0", isExpanded && "rotate-180")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  {haloLink ? (
                    <a href={haloLink} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-mono text-red-400 hover:underline shrink-0"
                      onClick={(e) => e.stopPropagation()}>
                      #{latest.halo_id}
                    </a>
                  ) : (
                    <span className="text-xs font-mono text-white/40 shrink-0">#{latest.halo_id}</span>
                  )}
                  <span className="text-sm text-white/70 truncate">{latest.tickets.summary}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs", latest.tech_name ? "text-white/50" : "text-rose-400/70")}>
                    {latest.tech_name ?? "Dispatch (Bryanna)"}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className={cn("h-1.5 w-2.5 rounded-sm",
                        i <= latest.communication_score ? COMM_BAR_COLORS[latest.communication_score] ?? "bg-white/40" : "bg-white/10"
                      )} />
                    ))}
                    <span className="ml-1 text-[10px] text-white/40 font-mono">{latest.communication_score}/5</span>
                  </div>
                </div>
              </div>

              {/* Desktop layout */}
              <div className="hidden sm:flex items-center gap-3">
                {/* Rating badge */}
                <span className={cn("shrink-0 rounded px-2.5 py-1 text-[11px] font-bold tracking-wide", style.bg, style.text)}>
                  {style.label}
                </span>

                {/* Communication score bars */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-2 w-3.5 rounded-sm",
                        i <= latest.communication_score
                          ? COMM_BAR_COLORS[latest.communication_score] ?? "bg-white/40"
                          : "bg-white/10",
                      )}
                    />
                  ))}
                  <span className="ml-1.5 text-xs text-white/40 font-mono">{latest.communication_score}/5</span>
                </div>

                {/* Ticket info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {haloLink ? (
                      <a
                        href={haloLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-red-400 hover:underline shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{latest.halo_id}
                      </a>
                    ) : (
                      <span className="text-sm font-mono text-white/40 shrink-0">#{latest.halo_id}</span>
                    )}
                    <span className="text-sm text-white/70 truncate">{latest.tickets.summary}</span>
                  </div>
                </div>

                {/* Version count */}
                {ticketReviews.length > 1 && (
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">
                    {ticketReviews.length} reviews
                  </span>
                )}

                {/* Tech name */}
                <span className={cn("text-sm shrink-0", latest.tech_name ? "text-white/50" : "text-rose-400/70")}>
                  {latest.tech_name ?? "Dispatch (Bryanna)"}
                </span>

                {/* Time */}
                <span className="text-xs text-white/30 shrink-0 tabular-nums w-16 text-right">
                  {timeAgo(latest.created_at)}
                </span>

                {/* Expand indicator */}
                <svg
                  className={cn("h-4 w-4 text-white/25 transition-transform shrink-0", isExpanded && "rotate-180")}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Expanded detail — single version with switcher */}
            {isExpanded && (
              <div className="border-t border-white/[0.08]">
                {/* Version switcher — only show when multiple reviews */}
                {ticketReviews.length > 1 && (
                  <div className="flex items-center justify-between px-4 sm:px-5 py-2 bg-white/[0.02] border-b border-white/[0.06]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVersionIndex((prev) => ({ ...prev, [ticketId]: Math.min(currentVersion + 1, ticketReviews.length - 1) }));
                      }}
                      disabled={currentVersion >= ticketReviews.length - 1}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.05] disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/50 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                      Older
                    </button>

                    <div className="flex items-center gap-1.5">
                      {ticketReviews.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={(e) => {
                            e.stopPropagation();
                            setVersionIndex((prev) => ({ ...prev, [ticketId]: idx }));
                          }}
                          className={cn(
                            "h-2 w-2 rounded-full transition-all",
                            idx === currentVersion
                              ? "bg-red-400 scale-125"
                              : "bg-white/20 hover:bg-white/40",
                          )}
                          title={`v${ticketReviews.length - idx} — ${formatDate(ticketReviews[idx].created_at)}`}
                        />
                      ))}
                      <span className="ml-2 text-[10px] text-white/30 tabular-nums">
                        v{ticketReviews.length - currentVersion}/{ticketReviews.length}
                      </span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVersionIndex((prev) => ({ ...prev, [ticketId]: Math.max(currentVersion - 1, 0) }));
                      }}
                      disabled={currentVersion <= 0}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.05] disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/50 transition-colors"
                    >
                      Newer
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                    </button>
                  </div>
                )}

                {/* Single review content */}
                <div className="px-4 py-3 sm:px-5 sm:py-3.5">
                  {/* Review header */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <span className={cn("rounded px-2.5 py-1 text-xs font-bold", revStyle.bg, revStyle.text)}>
                      {revStyle.label}
                    </span>
                    <span className="text-sm text-white/50">{formatDate(review.created_at)}</span>
                    {currentVersion === 0 && (
                      <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs text-red-400 font-medium">Latest</span>
                    )}
                    {currentVersion > 0 && (
                      <span className="text-xs text-white/30 font-medium">v{ticketReviews.length - currentVersion}</span>
                    )}
                    <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-4 text-xs sm:text-sm text-white/40">
                      <span>Response: <span className="text-white/60">{review.response_time}</span></span>
                      <span>Max gap: <span className="text-white/60">{review.max_gap_hours.toFixed(1)}h</span></span>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="text-sm text-white/90 leading-relaxed mb-3">{review.summary}</p>

                  {/* Strengths & Improvements — side by side on desktop */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    {review.strengths && (
                      <div className="rounded-lg bg-red-900/15 border border-red-800/20 px-3 py-2">
                        <p className="text-xs text-red-300 font-bold mb-1">Strengths</p>
                        <p className="text-sm text-red-100/80 leading-relaxed">{review.strengths}</p>
                      </div>
                    )}
                    {review.improvement_areas && (
                      <div className="rounded-lg bg-rose-500/8 border border-rose-500/15 px-3 py-2">
                        <p className="text-xs text-rose-400 font-bold mb-1">Needs Improvement</p>
                        <p className="text-sm text-rose-100/80 leading-relaxed">{review.improvement_areas}</p>
                      </div>
                    )}
                  </div>

                  {/* Suggestions */}
                  {review.suggestions.length > 0 && (
                    <div className="rounded-lg bg-red-500/8 border border-red-500/15 px-3 py-2 mb-2">
                      <p className="text-xs text-red-400 font-bold mb-1">Suggestions</p>
                      <ul className="space-y-0.5">
                        {review.suggestions.map((s, i) => (
                          <li key={i} className="text-sm text-red-100/80 leading-relaxed pl-4 relative">
                            <span className="absolute left-0 text-red-400">•</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex flex-wrap items-center gap-3 sm:gap-5 pt-2 mt-2 border-t border-white/[0.06]">
                    <span className="text-xs sm:text-sm text-white/40">
                      Client: <span className="text-white/70 font-medium">{review.tickets.client_name ?? "Unknown"}</span>
                    </span>
                    <span className="text-xs sm:text-sm text-white/40">
                      Tech: <span className={cn("font-medium", review.tech_name ? "text-white/70" : "text-rose-400/80")}>{review.tech_name ?? "Dispatch (Bryanna)"}</span>
                    </span>
                    <button
                      onClick={() => onSelectTicket(ticketId)}
                      className="w-full sm:w-auto sm:ml-auto text-sm text-red-400 hover:text-red-300 hover:underline font-medium"
                    >
                      View ticket →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
