import { describe, expect, it } from "vitest";
import type { HaloConfig } from "@triageit/shared";
import type { ClassificationResult, TriageContext } from "../types.js";
import {
  calibrateTechFeedback,
  checkReviewEligibility,
  type TechFeedback,
} from "./tech-reviewer.js";

const classification = {} as ClassificationResult;
const halo = {} as HaloConfig;

function context(actions: NonNullable<TriageContext["actions"]>): TriageContext {
  return {
    ticketId: "00000000-0000-0000-0000-000000000001",
    haloId: 41570,
    summary: "Email Password",
    details: null,
    clientName: "Lock and Quay",
    clientId: 1,
    userName: "Jace",
    userEmail: "jace@example.com",
    originalPriority: 2,
    assignedTechName: "Ryan Fitzpatrick",
    actions,
  };
}

const inventedFourHourReview: TechFeedback = {
  rating: "needs_improvement",
  communication_score: 3,
  response_time_assessment: "slow",
  max_response_gap_hours: 4,
  strengths: null,
  improvement_areas: "Ryan took four hours to reply.",
  suggestions: ["Reply faster."],
  summary: "Ryan took 4.0 business hours to respond.",
};

describe("tech review response evidence", () => {
  it("corrects the #41570 timing instead of trusting an invented four-hour claim", () => {
    const review = checkReviewEligibility(
      context([
        {
          note: "Customer follow-up",
          who: "Jace",
          outcome: "Email Update",
          date: "2026-07-21T13:47:43Z",
          isInternal: false,
        },
        {
          note: "Customer update",
          who: "Ryan Fitzpatrick",
          outcome: "Email User",
          date: "2026-07-21T14:25:25Z",
          isInternal: false,
        },
      ]),
      classification,
      halo,
      "2026-07-21T13:05:02Z",
      {
        assignedAt: "2026-07-21T13:05:02Z",
        assignedTech: "Ryan Fitzpatrick",
        now: new Date("2026-07-21T14:30:00Z"),
      },
    );

    expect(review.responseFacts.firstResponseBh).toBeCloseTo(1.35, 2);
    expect(review.maxResponseGapHours).toBeCloseTo(38 / 60, 2);

    const calibrated = calibrateTechFeedback(
      inventedFourHourReview,
      review.responseFacts,
      "Ryan Fitzpatrick",
      review.accountableBusinessHours,
    );
    expect(calibrated.rating).toBe("good");
    expect(calibrated.summary).toContain("1.4 business hours");
    expect(calibrated.summary).toContain("0.6 business hours");
    expect(calibrated.summary).not.toContain("4.0");
  });

  it("counts a customer email sent at 11:08 PM as only 32 business minutes old at 8:32 AM", () => {
    const review = checkReviewEligibility(
      context([
        {
          note: "Earlier customer update",
          who: "Ryan Fitzpatrick",
          outcome: "Email User",
          date: "2026-07-22T13:00:00Z",
          isInternal: false,
        },
        {
          note: "Thanks for looking into this.",
          who: "travis@lockandquaymkg.co.uk",
          outcome: "Email Update",
          date: "2026-07-23T03:08:00Z",
          isInternal: false,
        },
      ]),
      classification,
      halo,
      "2026-07-22T12:00:00Z",
      {
        assignedAt: "2026-07-22T12:00:00Z",
        assignedTech: "Ryan Fitzpatrick",
        now: new Date("2026-07-23T12:32:00Z"),
      },
    );

    expect(review.responseFacts.currentlyWaitingBh).toBeCloseTo(32 / 60, 2);
    const calibrated = calibrateTechFeedback(
      inventedFourHourReview,
      review.responseFacts,
      "Ryan Fitzpatrick",
      review.accountableBusinessHours,
    );
    expect(calibrated.rating).toBe("good");
    expect(calibrated.summary).not.toContain("4.0");
  });
});
