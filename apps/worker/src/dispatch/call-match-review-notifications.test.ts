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
      match_evidence: null,
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("match_call");
    expect(serialized).toContain("separate_call");
    expect(serialized).toContain("85631");
    expect(serialized).toContain("Elizabeth Balmer");
    expect(serialized).toContain("What the call was about");
    expect(serialized).toContain("You handled this call");
    expect(serialized).toContain("instead of letting the system guess");
    expect(serialized).not.toContain("EWS");
  });

  it("shows an unverified CNAM identity when Halo and the transcript cannot identify the caller", () => {
    const card = buildCallMatchReviewCard({
      recording_id: 85819,
      tech_name: "Carlson, Jarid",
      direction: "outbound",
      started_at: "2026-07-15T16:10:00Z",
      external_number: "12392938135",
      summary: "Jarid called about an email access issue and confirmed the next troubleshooting step.",
      identified_customer_name: null,
      identified_client_name: null,
      match_evidence: "Twilio CNAM hint (CONSUMER): FRANCES RUSHMAN",
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("FRANCES RUSHMAN");
    expect(serialized).toContain("Twilio CNAM consumer hint");
    expect(serialized).toContain("email access issue");
  });
});
