import { describe, expect, it } from "vitest";
import {
  buildSaturdaySupportObjective,
  parseSaturdaySupportObjective,
  saturdaySupportDedupeKey,
  saturdaySupportEscalationDedupeKey,
} from "./saturday-support-call.js";

describe("Saturday support call objectives", () => {
  it("round trips a technician verification call", () => {
    const value = buildSaturdaySupportObjective({
      kind: "verification",
      technician: "Jonathan Schober",
      date: "2026-07-25",
      shift: "8:00 AM–5:00 PM ET",
      attempt: 1,
    });

    expect(parseSaturdaySupportObjective(value)).toEqual({
      kind: "verification",
      technician: "Jonathan Schober",
      date: "2026-07-25",
      shift: "8:00 AM–5:00 PM ET",
      attempt: 1,
    });
  });

  it("round trips a manager escalation with the failure reason", () => {
    const value = buildSaturdaySupportObjective({
      kind: "manager_escalation",
      technician: "Jonathan",
      date: "2026-07-25",
      shift: "8:00 AM–5:00 PM ET",
      attempt: 3,
      reason: "Two calls reached voicemail.",
    });

    expect(parseSaturdaySupportObjective(value)).toMatchObject({
      kind: "manager_escalation",
      technician: "Jonathan",
      attempt: 3,
      reason: "Two calls reached voicemail.",
    });
  });

  it("uses stable per-day attempt and escalation dedupe keys", () => {
    expect(saturdaySupportDedupeKey("2026-07-25", "Jonathan Schober", 2))
      .toBe("saturday_support:2026-07-25:jonathan-schober:2");
    expect(saturdaySupportEscalationDedupeKey("2026-07-25"))
      .toBe("saturday_support:2026-07-25:manager_escalation");
  });
});
