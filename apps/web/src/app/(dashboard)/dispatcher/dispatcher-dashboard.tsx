"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { DispatcherReview } from "./page";

type RatingFilter = "all" | "great" | "good" | "needs_improvement" | "poor";
type SortField = "date" | "rating";

const RATING_ORDER: Record<DispatcherReview["rating"], number> = {
  great: 4,
  good: 3,
  needs_improvement: 2,
  poor: 1,
} as const;

const RATING_CONFIG: Record<
  DispatcherReview["rating"],
  { readonly label: string; readonly bg: string; readonly text: string }
> = {
  great: { label: "Great", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  good: { label: "Good", bg: "bg-blue-500/10", text: "text-blue-400" },
  needs_improvement: { label: "Needs Improvement", bg: "bg-orange-500/10", text: "text-orange-400" },
  poor: { label: "Poor", bg: "bg-red-500/10", text: "text-red-400" },
} as const;

function computeSummaryStats(reviews: ReadonlyArray<DispatcherReview>) {
  const total = reviews.length;

  if (total === 0) {
    return {
      total: 0,
      avgRating: null as number | null,
      avgRatingLabel: "N/A",
      avgAssignmentMinutes: null as number | null,
      promiseKeptRate: null as number | null,
      customerReplyRate: null as number | null,
    };
  }

  // Average rating (numeric)
  const ratingSum = reviews.reduce((acc, r) => acc + RATING_ORDER[r.rating], 0);
  const avgRating = ratingSum / total;

  // Rating label from avg
  let avgRatingLabel: string;
  if (avgRating >= 3.5) avgRatingLabel = "Great";
  else if (avgRating >= 2.5) avgRatingLabel = "Good";
  else if (avgRating >= 1.5) avgRatingLabel = "Needs Improvement";
  else avgRatingLabel = "Poor";

  // Average assignment time
  const assignmentTimes = reviews
    .map((r) => r.assignment_time_minutes)
    .filter((v): v is number => v !== null);
  const avgAssignmentMinutes =
    assignmentTimes.length > 0
      ? assignmentTimes.reduce((a, b) => a + b, 0) / assignmentTimes.length
      : null;

  // Promise kept rate
  const promiseReviews = reviews.filter((r) => r.promise_kept !== null);
  const promiseKeptRate =
    promiseReviews.length > 0
      ? (promiseReviews.filter((r) => r.promise_kept === true).length / promiseReviews.length) * 100
      : null;

  // Customer reply handled rate
  const replyReviews = reviews.filter((r) => r.customer_reply_handled !== null);
  const customerReplyRate =
    replyReviews.length > 0
      ? (replyReviews.filter((r) => r.customer_reply_handled === true).length / replyReviews.length) * 100
      : null;

  return {
    total,
    avgRating,
    avgRatingLabel,
    avgAssignmentMinutes,
    promiseKeptRate,
    customerReplyRate,
  };
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

function RatingBadge({ rating }: { readonly rating: DispatcherReview["rating"] }) {
  const config = RATING_CONFIG[rating];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        config.bg,
        config.text,
      )}
    >
      {config.label}
    </span>
  );
}

function BoolIndicator({ value, trueLabel, falseLabel }: {
  readonly value: boolean | null;
  readonly trueLabel: string;
  readonly falseLabel: string;
}) {
  if (value === null) return <span className="text-xs text-zinc-500">--</span>;
  return value ? (
    <span className="text-xs font-medium text-emerald-400">{trueLabel}</span>
  ) : (
    <span className="text-xs font-medium text-red-400">{falseLabel}</span>
  );
}

function ReviewRow({
  review,
  isExpanded,
  onToggle,
}: {
  readonly review: DispatcherReview;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const date = new Date(review.created_at);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const ticketNumber = review.ticket_halo_id ?? review.halo_id ?? "--";
  const clientName = review.ticket_client_name ?? "--";
  const issues = review.issues ?? [];

  return (
    <>
      <tr
        className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.04]"
        onClick={onToggle}
      >
        <td className="px-4 py-3.5">
          <div>
            <p className="text-sm text-zinc-200">{formattedDate}</p>
            <p className="text-xs text-zinc-500">{formattedTime}</p>
          </div>
        </td>
        <td className="px-4 py-3.5 text-center">
          <span className="font-mono text-sm text-zinc-200">#{ticketNumber}</span>
        </td>
        <td className="px-4 py-3.5">
          <span className="text-sm text-zinc-300">{clientName}</span>
        </td>
        <td className="px-4 py-3.5 text-center">
          <RatingBadge rating={review.rating} />
        </td>
        <td className="px-4 py-3.5 text-center">
          {review.assignment_time_minutes !== null ? (
            <span className="text-sm font-semibold text-zinc-200">
              {review.assignment_time_minutes}m
            </span>
          ) : (
            <span className="text-xs text-zinc-500">--</span>
          )}
        </td>
        <td className="px-4 py-3.5 text-center">
          <BoolIndicator value={review.promise_kept} trueLabel="Yes" falseLabel="No" />
        </td>
        <td className="px-4 py-3.5 text-center">
          {issues.length > 0 ? (
            <span className="inline-flex items-center rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-400">
              {issues.length}
            </span>
          ) : (
            <span className="text-xs text-zinc-500">None</span>
          )}
        </td>
        <td className="px-4 py-3.5">
          <p className="max-w-[200px] truncate text-xs text-zinc-400">
            {review.summary ?? "--"}
          </p>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-white/5 bg-white/[0.02]">
          <td colSpan={8} className="px-6 py-4">
            <div className="space-y-3">
              {review.summary && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
                    Summary
                  </p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{review.summary}</p>
                </div>
              )}
              {review.ticket_summary && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
                    Ticket Summary
                  </p>
                  <p className="text-sm text-zinc-400">{review.ticket_summary}</p>
                </div>
              )}
              {issues.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
                    Issues
                  </p>
                  <ul className="space-y-1">
                    {issues.map((issue, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-orange-400">
                        <span className="mt-0.5 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {review.promise_details && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
                    Promise Details
                  </p>
                  <p className="text-sm text-zinc-400">{review.promise_details}</p>
                </div>
              )}
              <div className="flex gap-6 text-xs text-zinc-500">
                <span>
                  Customer Reply Handled:{" "}
                  <BoolIndicator
                    value={review.customer_reply_handled}
                    trueLabel="Yes"
                    falseLabel="No"
                  />
                </span>
                <span>
                  Unassigned During Business Hours:{" "}
                  <BoolIndicator
                    value={review.unassigned_during_business_hours}
                    trueLabel="Yes"
                    falseLabel="No"
                  />
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MobileReviewCard({
  review,
  isExpanded,
  onToggle,
}: {
  readonly review: DispatcherReview;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const date = new Date(review.created_at);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const ticketNumber = review.ticket_halo_id ?? review.halo_id ?? "--";
  const clientName = review.ticket_client_name ?? "--";
  const issues = review.issues ?? [];

  return (
    <div
      className="cursor-pointer border-b border-white/5 px-4 py-3 transition-colors hover:bg-white/[0.04]"
      onClick={onToggle}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">#{ticketNumber}</span>
          <RatingBadge rating={review.rating} />
        </div>
        <span className="text-xs text-zinc-500">{formattedDate}</span>
      </div>
      <p className="text-sm text-zinc-300 mb-1">{clientName}</p>
      <div className="flex gap-3 text-xs">
        {review.assignment_time_minutes !== null && (
          <span className="text-zinc-400">{review.assignment_time_minutes}m assign</span>
        )}
        <BoolIndicator value={review.promise_kept} trueLabel="Promise kept" falseLabel="Promise broken" />
        {issues.length > 0 && (
          <span className="text-orange-400">{issues.length} issue{issues.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      {isExpanded && (
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
          {review.summary && (
            <p className="text-xs text-zinc-400 leading-relaxed">{review.summary}</p>
          )}
          {issues.length > 0 && (
            <ul className="space-y-1">
              {issues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-orange-400">
                  <span className="mt-0.5 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400" />
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function DispatcherDashboard({
  reviews,
}: {
  readonly reviews: ReadonlyArray<DispatcherReview>;
}) {
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered =
    ratingFilter === "all"
      ? reviews
      : reviews.filter((r) => r.rating === ratingFilter);

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortAsc ? 1 : -1;
    switch (sortField) {
      case "date":
        return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "rating":
        return mul * (RATING_ORDER[a.rating] - RATING_ORDER[b.rating]);
      default:
        return 0;
    }
  });

  const stats = computeSummaryStats(reviews);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortAsc ? " ↑" : " ↓";
  };

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Dispatcher Reviews</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Bryanna&apos;s dispatch performance and ticket handling
          </p>
        </div>
        <p className="text-xs text-zinc-600">Updated on page load</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total Reviews"
          value={stats.total}
          accent="indigo-400"
        />
        <StatCard
          label="Avg Rating"
          value={stats.avgRating !== null ? stats.avgRating.toFixed(1) : "N/A"}
          subtitle={stats.avgRatingLabel}
          accent={
            stats.avgRating !== null
              ? stats.avgRating >= 3.5
                ? "emerald-400"
                : stats.avgRating >= 2.5
                  ? "blue-400"
                  : stats.avgRating >= 1.5
                    ? "orange-400"
                    : "red-400"
              : "zinc-500"
          }
        />
        <StatCard
          label="Avg Assignment"
          value={
            stats.avgAssignmentMinutes !== null
              ? `${Math.round(stats.avgAssignmentMinutes)}m`
              : "N/A"
          }
          subtitle="Minutes to assign"
        />
        <StatCard
          label="Promise Kept"
          value={
            stats.promiseKeptRate !== null
              ? `${Math.round(stats.promiseKeptRate)}%`
              : "N/A"
          }
          accent={
            stats.promiseKeptRate !== null
              ? stats.promiseKeptRate >= 80
                ? "emerald-400"
                : stats.promiseKeptRate >= 60
                  ? "amber-400"
                  : "red-400"
              : "zinc-500"
          }
        />
        <StatCard
          label="Reply Handled"
          value={
            stats.customerReplyRate !== null
              ? `${Math.round(stats.customerReplyRate)}%`
              : "N/A"
          }
          subtitle="Customer replies"
          accent={
            stats.customerReplyRate !== null
              ? stats.customerReplyRate >= 80
                ? "emerald-400"
                : stats.customerReplyRate >= 60
                  ? "amber-400"
                  : "red-400"
              : "zinc-500"
          }
        />
      </div>

      {/* Rating breakdown */}
      <div className="flex flex-wrap gap-3">
        {(["great", "good", "needs_improvement", "poor"] as const).map((rating) => {
          const count = reviews.filter((r) => r.rating === rating).length;
          const config = RATING_CONFIG[rating];
          return (
            <div
              key={rating}
              className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3"
            >
              <span className="text-xs text-zinc-500">{config.label}</span>
              <span className={cn("ml-2 text-lg font-bold", config.text)}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Reviews table */}
      <div className="overflow-hidden rounded-xl border border-white/5">
        <div className="flex flex-col gap-3 border-b border-white/5 bg-white/[0.02] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-300">Review History</h3>
            <p className="text-xs text-zinc-500">
              {sorted.length} review{sorted.length !== 1 ? "s" : ""}
              {ratingFilter !== "all" ? ` (filtered: ${RATING_CONFIG[ratingFilter].label})` : ""}
            </p>
          </div>
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-indigo-500"
          >
            <option value="all">All Ratings</option>
            <option value="great">Great</option>
            <option value="good">Good</option>
            <option value="needs_improvement">Needs Improvement</option>
            <option value="poor">Poor</option>
          </select>
        </div>

        {sorted.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-zinc-500">
              {reviews.length === 0
                ? "No dispatcher reviews yet. Reviews will appear here once the system evaluates dispatch performance."
                : "No reviews match the selected filter."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-white/5">
              {sorted.map((review) => (
                <MobileReviewCard
                  key={review.id}
                  review={review}
                  isExpanded={expandedId === review.id}
                  onToggle={() => handleToggle(review.id)}
                />
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.01]">
                    <th
                      className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                      onClick={() => handleSort("date")}
                    >
                      Date{sortArrow("date")}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Ticket #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Client
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                      onClick={() => handleSort("rating")}
                    >
                      Rating{sortArrow("rating")}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Assign Time
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Promise Kept
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Issues
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Summary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((review) => (
                    <ReviewRow
                      key={review.id}
                      review={review}
                      isExpanded={expandedId === review.id}
                      onToggle={() => handleToggle(review.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Rating Scale</h4>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span className="text-emerald-400">Great</span>
          <span className="text-blue-400">Good</span>
          <span className="text-orange-400">Needs Improvement</span>
          <span className="text-red-400">Poor</span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Assignment Time = minutes from ticket creation to tech assignment.
          Promise Kept = whether the dispatcher followed through on commitments to the customer.
          Click any row to expand full details.
        </p>
      </div>
    </div>
  );
}
