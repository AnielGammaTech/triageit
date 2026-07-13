import { describe, expect, it } from "vitest";
import { hasConfirmedGammaOnsiteEvidence } from "./onsite-evidence.js";

describe("hasConfirmedGammaOnsiteEvidence", () => {
  it("rejects customer-performed physical checks", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Lissette Cardona",
      note: "Ty checked the box when he reset the AP this morning.",
      outcome: "Email Update",
    }])).toBe(false);
  });

  it("rejects an internal note that only describes a customer's physical check", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Aniel Reyes",
      note: "Customer personnel checked the enclosure onsite; Gamma handled the ticket remotely.",
    }])).toBe(false);
  });

  it("rejects an internal note that repeats a customer onsite visit", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Aniel Reyes",
      note: "The customer completed an onsite visit and reset the access point.",
    }])).toBe(false);
  });

  it("accepts explicit first-person onsite work by Gamma staff", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Darren Davillier",
      note: "I went onsite to replace the failed switch and verify connectivity.",
    }])).toBe(true);
  });

  it("accepts explicit first-person presence onsite", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Jonathan Schober",
      note: "I am onsite and working with the client to replace the firewall.",
    }])).toBe(true);
  });

  it("accepts an explicit onsite service outcome from Gamma staff", () => {
    expect(hasConfirmedGammaOnsiteEvidence([{
      who: "Raul Tapanes",
      note: "Work completed.",
      outcome: "Onsite Support",
    }])).toBe(true);
  });
});
