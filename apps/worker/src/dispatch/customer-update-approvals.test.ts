import { describe, expect, it } from "vitest";
import { classifyCustomerScheduleReply, validateCustomerCommitmentDraft } from "./customer-update-approvals.js";

const TARGET = "2026-07-14T13:00:00.000Z";

describe("validateCustomerCommitmentDraft", () => {
  it("accepts a call commitment with an exact Eastern time and confirmation question", () => {
    expect(validateCustomerCommitmentDraft(
      "We will call you on July 14 at 9:00 AM Eastern. Does that time work for you?",
      TARGET,
      "call",
    )).toBeNull();
  });

  it("rejects a vague next action", () => {
    expect(validateCustomerCommitmentDraft(
      "We will follow up tomorrow morning. Does that work for you?",
      TARGET,
      "reply",
    )).toContain("exact next-action date and time");
  });

  it("rejects a reply draft that does not ask whether the time works", () => {
    expect(validateCustomerCommitmentDraft(
      "We will email you with an update on July 14 at 9:00 AM Eastern.",
      TARGET,
      "reply",
    )).toContain("ask whether");
  });
});

describe("classifyCustomerScheduleReply", () => {
  it("recognizes acceptance", () => {
    expect(classifyCustomerScheduleReply("Yes, that works for me. Thank you.")).toBe("accepted");
    expect(classifyCustomerScheduleReply("Yes, 3 PM works for me.")).toBe("accepted");
  });

  it("returns explicit rejection to follow-up", () => {
    expect(classifyCustomerScheduleReply("No, 9:00 AM does not work for me.")).toBe("needs_follow_up");
  });

  it("returns a proposed alternate time to follow-up", () => {
    expect(classifyCustomerScheduleReply("Can you call at 3 PM instead?")).toBe("needs_follow_up");
  });

  it("does not treat a neutral thank-you as a rejection", () => {
    expect(classifyCustomerScheduleReply("Thank you for the update.")).toBe("neutral");
  });
});
