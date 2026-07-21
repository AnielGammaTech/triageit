import { describe, expect, it } from "vitest";
import { availabilityRiskReason } from "./sla-availability-risk.js";

const NOW = Date.parse("2026-07-21T16:50:00.000Z");
const DUE = "2026-07-21T17:00:00.000Z";

function risk(overrides: Partial<Parameters<typeof availabilityRiskReason>[0]> = {}) {
  return availabilityRiskReason({
    haloId: 40932,
    dueAt: DUE,
    nowMs: NOW,
    tech: {
      status: { state: "meeting", detail: "In a meeting until 1:00 PM" },
      statusTicketId: null,
      unavailableUntil: "2026-07-21T17:00:00.000Z",
    },
    ...overrides,
  });
}

describe("availabilityRiskReason", () => {
  it("flags a meeting that runs through the SLA deadline", () => {
    expect(risk()).toBe("In a meeting until 1:00 PM");
  });

  it("does not interrupt a meeting that leaves recovery time", () => {
    expect(risk({
      tech: {
        status: { state: "meeting", detail: "In a meeting until 12:52 PM" },
        statusTicketId: null,
        unavailableUntil: "2026-07-21T16:52:00.000Z",
      },
    })).toBeNull();
  });

  it("does not call an available owner or someone working this same ticket", () => {
    expect(risk({ tech: { status: { state: "available", detail: null }, statusTicketId: null, unavailableUntil: null } })).toBeNull();
    expect(risk({ tech: { status: { state: "working", detail: "Working ticket #40932" }, statusTicketId: 40932, unavailableUntil: null } })).toBeNull();
  });

  it("flags someone working a different ticket and ignores unknown presence", () => {
    expect(risk({ tech: { status: { state: "working", detail: "Working ticket #41000" }, statusTicketId: 41000, unavailableUntil: null } })).toContain("41000");
    expect(risk({ tech: { status: { state: "unknown", detail: "No presence signal" }, statusTicketId: null, unavailableUntil: null } })).toBeNull();
  });

  it("does not create a pre-breach warning after the deadline", () => {
    expect(risk({ nowMs: Date.parse(DUE) })).toBeNull();
  });
});
