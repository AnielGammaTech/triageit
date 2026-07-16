import { describe, expect, it } from "vitest";
import { deterministicAlertDecision, hasProtectedAlertSignals } from "./alert-manager-policy.js";

describe("deterministicAlertDecision", () => {
  it("closes known self-resolving Spanning throttling noise", () => {
    const result = deterministicAlertDecision({
      summary: "Spanning Backup for Office 365 - Error",
      details: "Error Code: 14021\nError User, Site, or Teams Channel: https://tenant.sharepoint.com/sites/ContentTypeHub\nError: Microsoft was unable to respond to the volume of requests being made.",
    });
    expect(result?.decision).toBe("auto_close");
    expect(result?.patternKey).toBe("spanning:14021");
  });

  it("keeps configuration and data-protection errors for review", () => {
    const noMailbox = deterministicAlertDecision({
      summary: "Spanning Backup for Office 365 - Error",
      details: "Error Code: 10004\nThe user does not have an Exchange Online mailbox. Remove the license.",
    });
    expect(noMailbox?.decision).toBe("review_required");
    expect(hasProtectedAlertSignals({ summary: "Daily Dark Web Compromise Report", details: "credential compromised" })).toBe(true);
  });

  it("closes informational reports but preserves missed communications", () => {
    expect(deterministicAlertDecision({ summary: "3CX: Your Scheduled Reports are ready", details: "Reports are ready" })?.decision).toBe("auto_close");
    expect(deterministicAlertDecision({ summary: "New missed call from +1239", details: "Ringing 00:00" })?.decision).toBe("review_required");
  });
});
