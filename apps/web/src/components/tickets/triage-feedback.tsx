"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

// ── Icons (inline SVGs matching codebase pattern) ──────────────────

function ThumbsUpIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function ThumbsDownIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function MessageSquareIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── Types ───────────────────────────────────────────────────────────

type Rating = "helpful" | "not_helpful";

interface FeedbackRow {
  readonly id: string;
  readonly triage_result_id: string;
  readonly ticket_id: string;
  readonly rating: Rating;
  readonly classification_accurate: boolean | null;
  readonly priority_accurate: boolean | null;
  readonly recommendations_useful: boolean | null;
  readonly comment: string | null;
  readonly submitted_by: string | null;
  readonly created_at: string;
}

interface TriageFeedbackProps {
  readonly triageResultId: string;
  readonly ticketId: string;
}

// ── Component ───────────────────────────────────────────────────────

export function TriageFeedback({ triageResultId, ticketId }: TriageFeedbackProps) {
  const [existing, setExisting] = useState<FeedbackRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedRating, setSelectedRating] = useState<Rating | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [classificationAccurate, setClassificationAccurate] = useState(false);
  const [priorityAccurate, setPriorityAccurate] = useState(false);
  const [recommendationsUseful, setRecommendationsUseful] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Fetch existing feedback on mount
  useEffect(() => {
    async function fetchFeedback() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("triage_feedback")
          .select("*")
          .eq("triage_result_id", triageResultId)
          .limit(1)
          .maybeSingle();

        if (data) {
          setExisting(data as FeedbackRow);
        }
      } catch {
        // Non-fatal — just show the empty feedback UI
      } finally {
        setLoaded(true);
      }
    }

    fetchFeedback();
  }, [triageResultId]);

  const handleRatingClick = useCallback((rating: Rating) => {
    setSelectedRating(rating);
    setShowDetails(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedRating || submitting) return;
    setSubmitting(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("triage_feedback")
        .insert({
          triage_result_id: triageResultId,
          ticket_id: ticketId,
          rating: selectedRating,
          classification_accurate: classificationAccurate || null,
          priority_accurate: priorityAccurate || null,
          recommendations_useful: recommendationsUseful || null,
          comment: comment.trim() || null,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      setExisting(data as FeedbackRow);
      setSubmitted(true);
    } catch {
      // Non-fatal — user can retry
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedRating,
    submitting,
    triageResultId,
    ticketId,
    classificationAccurate,
    priorityAccurate,
    recommendationsUseful,
    comment,
  ]);

  // Don't render until we know if feedback already exists
  if (!loaded) return null;

  // Read-only view for existing feedback
  if (existing) {
    const isHelpful = existing.rating === "helpful";
    return (
      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
            isHelpful
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400",
          )}
        >
          {isHelpful ? (
            <ThumbsUpIcon className="h-3 w-3" />
          ) : (
            <ThumbsDownIcon className="h-3 w-3" />
          )}
          {isHelpful ? "Helpful" : "Not helpful"}
        </div>
        <CheckIcon className="h-3 w-3 text-emerald-400" />
        {existing.comment && (
          <span className="flex items-center gap-1 text-[10px] text-white/30">
            <MessageSquareIcon className="h-2.5 w-2.5" />
            {existing.comment}
          </span>
        )}
      </div>
    );
  }

  // Just-submitted confirmation
  if (submitted) {
    return (
      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
        <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-xs text-emerald-400">Feedback saved</span>
      </div>
    );
  }

  return (
    <div className="pt-3 border-t border-white/5">
      {/* Rating buttons */}
      {!showDetails && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30">Rate this triage</span>
          <button
            onClick={() => handleRatingClick("helpful")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/40 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
          >
            <ThumbsUpIcon className="h-3 w-3" />
          </button>
          <button
            onClick={() => handleRatingClick("not_helpful")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <ThumbsDownIcon className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Detail form */}
      {showDetails && selectedRating && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                selectedRating === "helpful"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400",
              )}
            >
              {selectedRating === "helpful" ? (
                <ThumbsUpIcon className="h-3 w-3" />
              ) : (
                <ThumbsDownIcon className="h-3 w-3" />
              )}
              {selectedRating === "helpful" ? "Helpful" : "Not helpful"}
            </div>
            <button
              onClick={() => {
                setShowDetails(false);
                setSelectedRating(null);
              }}
              className="text-[10px] text-white/20 hover:text-white/40"
            >
              change
            </button>
          </div>

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={classificationAccurate}
                onChange={(e) => setClassificationAccurate(e.target.checked)}
                className="h-3 w-3 rounded border-white/20 bg-white/5 accent-emerald-500"
              />
              Classification accurate
            </label>
            <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={priorityAccurate}
                onChange={(e) => setPriorityAccurate(e.target.checked)}
                className="h-3 w-3 rounded border-white/20 bg-white/5 accent-emerald-500"
              />
              Priority correct
            </label>
            <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recommendationsUseful}
                onChange={(e) => setRecommendationsUseful(e.target.checked)}
                className="h-3 w-3 rounded border-white/20 bg-white/5 accent-emerald-500"
              />
              Recommendations useful
            </label>
          </div>

          {/* Comment input */}
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment..."
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 placeholder-white/20 outline-none focus:border-white/20"
          />

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              submitting
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-[#b91c1c]/20 text-[#b91c1c] hover:bg-[#b91c1c]/30",
            )}
          >
            {submitting ? "Saving..." : "Submit Feedback"}
          </button>
        </div>
      )}
    </div>
  );
}
