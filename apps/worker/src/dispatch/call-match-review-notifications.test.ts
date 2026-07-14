import { describe, expect, it } from "vitest";
import { buildCallMatchReviewCard } from "./call-match-review-notifications.js";
import { peopleNamesOverlap } from "./call-match-review-policy.js";

describe("unmatched-call Teams review", () => {
  it("matches reversed 3CX and Teams display names", () => {
    expect(peopleNamesOverlap("Carlson, Jarid", "Jarid Carlson")).toBe(true);
    expect(peopleNamesOverlap("Lawyer, Matthew", "Ryan Fitzpatrick")).toBe(false);
    expect(peopleNamesOverlap("Lawyer, Matthew", "David Lawyer")).toBe(false);
  });

  it("builds an actionable card without embedding a credential", () => {
    const card = buildCallMatchReviewCard({
      recording_id: 85631,
      tech_name: "Carlson, Jarid",
      direction: "inbound",
      started_at: "2026-07-14T12:09:11.365Z",
      external_number: "12395720926",
      summary: "Elizabeth requested the Microsoft password that had been changed; credential redacted.",
      identified_customer_name: "Elizabeth Balmer",
      identified_client_name: "ALLEN CONCRETE & MASONRY, INC",
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("match_call");
    expect(serialized).toContain("separate_call");
    expect(serialized).toContain("85631");
    expect(serialized).toContain("Elizabeth Balmer");
    expect(serialized).not.toContain("EWS");
  });
});
