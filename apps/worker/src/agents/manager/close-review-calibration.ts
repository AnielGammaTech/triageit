export interface HuduKbDraft {
  readonly title: string;
  readonly category: "procedure" | "troubleshooting" | "environment" | "contact" | "network" | "password" | "general";
  readonly content: string;
  readonly hudu_section: string;
}

export interface CloseReviewResult {
  readonly resolution_summary: string;
  readonly tech_performance: {
    readonly rating: "great" | "good" | "needs_improvement" | "poor";
    readonly response_time: string;
    readonly communication: string;
    readonly highlights: string | null;
    readonly issues: string | null;
  };
  readonly documentation_action: {
    readonly hudu_updates_needed: ReadonlyArray<string>;
    /** Completeness of this ticket's close-out notes, not the client's whole Hudu environment. */
    readonly quality_score: 1 | 2 | 3 | 4 | 5;
    readonly notes: string;
  };
  readonly hudu_kb_drafts: ReadonlyArray<HuduKbDraft>;
  readonly onsite_visits: ReadonlyArray<string>;
  readonly ticket_lifecycle: {
    readonly total_time: string;
    readonly first_response_time: string;
    readonly resolution_method: string;
  };
  readonly client_policy?: string | null;
  readonly review_basis: {
    readonly evidence_reviewed: ReadonlyArray<string>;
    readonly rating_drivers: ReadonlyArray<string>;
    readonly not_counted_against_rating: ReadonlyArray<string>;
  };
}

export interface CloseReviewAction {
  readonly note?: string | null;
  readonly who?: string | null;
  readonly isInternal?: boolean | null;
}

interface CalibrationInput {
  readonly review: CloseReviewResult;
  readonly actions: ReadonlyArray<CloseReviewAction>;
  readonly ticketSummary: string;
  readonly ticketDetails?: string | null;
  readonly priorTechRating?: string | null;
  readonly imageCount?: number;
}

const ROUTINE_ACCESS_TASK = /\b(lock(?:ed)?\s*out|account\s+unlock|password\s+reset|reset\s+(?:the\s+)?password|temporary\s+password|mfa\s+reset|authentication\s+method\s+reset)\b/i;
const RESOLUTION_EVIDENCE = /\b(reset|unlocked?|temporary password|restored|resolved|fixed|completed|working|access (?:was )?restored)\b/i;
const DURABLE_ENVIRONMENT_CHANGE = /\b(vlan|firewall|router|switch|dns|dhcp|mail flow|transport rule|connector|server config|network config|vendor contact|standing policy|new procedure|new workaround|asset serial|shared credential)\b/i;
const SERIOUS_REVIEW_ISSUE = /\b(slow|unanswered|no response|failed|wrong|not resolved|unresolved|customer (?:was )?frustrat|reopened|security risk|unsafe|missed sla|breach)\b/i;
const OPTIONAL_REVIEW_ISSUE = /\b(follow[- ]?up|confirm(?:ation|ed)?|documentation|documented|hudu|inventory|best practice)\b/i;

const RATING_RANK: Record<CloseReviewResult["tech_performance"]["rating"], number> = {
  poor: 0,
  needs_improvement: 1,
  good: 2,
  great: 3,
};

function asKnownRating(value: string | null | undefined): CloseReviewResult["tech_performance"]["rating"] | null {
  return value === "great" || value === "good" || value === "needs_improvement" || value === "poor"
    ? value
    : null;
}

function unique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Applies deterministic fairness guardrails after the model review.
 *
 * The model may suggest optional improvements, but those suggestions cannot turn
 * a clearly documented, successfully completed routine task into a failing grade.
 */
export function calibrateCloseReview(input: CalibrationInput): CloseReviewResult {
  const { review, actions } = input;
  const actionText = actions.map((action) => action.note ?? "").join("\n");
  const ticketText = `${input.ticketSummary}\n${input.ticketDetails ?? ""}\n${actionText}`;
  const isRoutineAccessTask = ROUTINE_ACCESS_TASK.test(ticketText);
  const hasResolutionEvidence = RESOLUTION_EVIDENCE.test(actionText);
  const hasDurableEnvironmentChange = DURABLE_ENVIRONMENT_CHANGE.test(ticketText);
  const priorRating = asKnownRating(input.priorTechRating);
  const issueText = review.tech_performance.issues ?? "";
  const optionalOnlyIssue = Boolean(issueText)
    && OPTIONAL_REVIEW_ISSUE.test(issueText)
    && !SERIOUS_REVIEW_ISSUE.test(issueText);

  let rating = review.tech_performance.rating;
  if (
    priorRating
    && RATING_RANK[priorRating] > RATING_RANK[rating]
    && optionalOnlyIssue
  ) {
    rating = priorRating;
  } else if (
    isRoutineAccessTask
    && hasResolutionEvidence
    && optionalOnlyIssue
    && RATING_RANK[rating] < RATING_RANK.good
  ) {
    rating = "good";
  }

  let qualityScore = review.documentation_action.quality_score;
  let documentationNotes = review.documentation_action.notes;
  let huduUpdates = review.documentation_action.hudu_updates_needed;
  const notCounted = [...review.review_basis.not_counted_against_rating];
  const ratingDrivers = [...review.review_basis.rating_drivers];

  if (isRoutineAccessTask && hasResolutionEvidence) {
    qualityScore = Math.max(4, qualityScore) as 4 | 5;
    documentationNotes = "The ticket records the issue, the action taken, and the resolved outcome; that is sufficient close-out documentation for a routine access task.";
    ratingDrivers.push("The ticket actions document a completed routine access fix and its outcome.");
    notCounted.push("A separate customer login-confirmation message is recommended follow-up, not a failed resolution.");

    if (!hasDurableEnvironmentChange) {
      huduUpdates = [];
      notCounted.push("No Hudu update was required because the work did not create or change durable client configuration.");
    }
  }

  if (priorRating) {
    ratingDrivers.push(`The existing live tech review rated the handling ${priorRating.replace(/_/g, " ")}.`);
  }

  const evidenceReviewed = unique([
    ...review.review_basis.evidence_reviewed,
    `${actions.length} human ticket action${actions.length === 1 ? "" : "s"}`,
    priorRating ? "the existing live tech review" : "",
    input.imageCount ? `${input.imageCount} ticket image${input.imageCount === 1 ? "" : "s"}` : "",
  ]);

  return {
    ...review,
    tech_performance: {
      ...review.tech_performance,
      rating,
    },
    documentation_action: {
      ...review.documentation_action,
      hudu_updates_needed: huduUpdates,
      quality_score: qualityScore,
      notes: documentationNotes,
    },
    review_basis: {
      evidence_reviewed: evidenceReviewed,
      rating_drivers: unique(ratingDrivers),
      not_counted_against_rating: unique(notCounted),
    },
  };
}
