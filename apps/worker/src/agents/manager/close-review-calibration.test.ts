import { describe, expect, it } from "vitest";
import {
  calibrateCloseReview,
  type CloseReviewResult,
} from "./close-review-calibration.js";

function review(overrides?: Partial<CloseReviewResult>): CloseReviewResult {
  return {
    resolution_summary: "The account was unlocked and a temporary password was issued.",
    tech_performance: {
      rating: "good",
      response_time: "fast",
      communication: "The resolution was clearly communicated.",
      highlights: "The request was completed quickly.",
      issues: "No follow-up documented to confirm the user logged in.",
    },
    documentation_action: {
      hudu_updates_needed: ["Add the user to the Hudu inventory"],
      quality_score: 2,
      notes: "Minimal documentation.",
    },
    hudu_kb_drafts: [],
    onsite_visits: [],
    ticket_lifecycle: {
      total_time: "27 minutes",
      first_response_time: "5 minutes",
      resolution_method: "remote",
    },
    client_policy: null,
    review_basis: {
      evidence_reviewed: [],
      rating_drivers: [],
      not_counted_against_rating: [],
    },
    ...overrides,
  };
}

describe("calibrateCloseReview", () => {
  it("does not punish a documented routine account unlock for optional Hudu or confirmation work", () => {
    const result = calibrateCloseReview({
      review: review(),
      actions: [{
        who: "Aniel Reyes",
        note: "Reset the locked Windows account and issued a temporary password by SMS. Lockout resolved.",
      }],
      ticketSummary: "Jesus Morales Windows account locked out",
      priorTechRating: "good",
    });

    expect(result.tech_performance.rating).toBe("good");
    expect(result.documentation_action.quality_score).toBe(4);
    expect(result.documentation_action.hudu_updates_needed).toEqual([]);
    expect(result.review_basis.not_counted_against_rating.join(" ")).toContain("customer login-confirmation");
    expect(result.review_basis.not_counted_against_rating.join(" ")).toContain("No Hudu update was required");
  });

  it("restores a passing prior tech grade when the close reviewer only cites optional follow-up", () => {
    const result = calibrateCloseReview({
      review: review({
        tech_performance: {
          rating: "needs_improvement",
          response_time: "fast",
          communication: "Clear",
          highlights: null,
          issues: "Best practice would be a follow-up confirmation message.",
        },
      }),
      actions: [{ note: "Unlocked the account and confirmed the reset was completed." }],
      ticketSummary: "Account unlock",
      priorTechRating: "great",
    });

    expect(result.tech_performance.rating).toBe("great");
  });

  it("does not hide a serious unresolved or response failure", () => {
    const result = calibrateCloseReview({
      review: review({
        tech_performance: {
          rating: "poor",
          response_time: "slow",
          communication: "No reply",
          highlights: null,
          issues: "The request was unresolved and the customer received no response for a full business day.",
        },
      }),
      actions: [{ note: "Investigating account lockout." }],
      ticketSummary: "Account locked out",
      priorTechRating: "good",
    });

    expect(result.tech_performance.rating).toBe("poor");
    expect(result.documentation_action.quality_score).toBe(2);
  });

  it("keeps a Hudu suggestion when the ticket changed durable environment configuration", () => {
    const result = calibrateCloseReview({
      review: review({
        documentation_action: {
          hudu_updates_needed: ["Document the new firewall and VLAN configuration"],
          quality_score: 3,
          notes: "The change should be documented.",
        },
      }),
      actions: [{ note: "Reset the service account password and changed the firewall VLAN configuration." }],
      ticketSummary: "Service account access reset",
    });

    expect(result.documentation_action.hudu_updates_needed).toEqual([
      "Document the new firewall and VLAN configuration",
    ]);
  });
});
