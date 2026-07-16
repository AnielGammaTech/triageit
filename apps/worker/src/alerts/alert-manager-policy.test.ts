import { describe, expect, it } from "vitest";
import { deterministicAlertDecision, hasProtectedAlertSignals, recurringThreeCxAlertKey } from "./alert-manager-policy.js";

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

  it("always closes Phish911 report notifications but protects other security and backup alerts", () => {
    const phish911 = { summary: "Phish911 Report Alert", details: "User reported a suspicious email" };
    expect(deterministicAlertDecision(phish911)?.decision).toBe("auto_close");
    expect(hasProtectedAlertSignals(phish911)).toBe(false);
    expect(deterministicAlertDecision({ summary: "Microsoft Entra ID Protection Weekly Digest", details: "One risky sign-in detected" })?.decision).toBe("review_required");
    expect(deterministicAlertDecision({ summary: "BackupIQ: Microsoft 365 Alert", details: "Backup partially completed" })?.decision).toBe("keep_open");
    expect(deterministicAlertDecision({ summary: "3CX Alert: Scheduled Backup Failed", details: "The scheduled backup failed" })?.decision).toBe("keep_open");
  });

  it("groups only identical 3CX system alerts, never customer contact events", () => {
    const stahlman = "3CX Alert: Trunk/Provider responds to Request with an error - System wide - stahlman.fl.3cx.us";
    expect(recurringThreeCxAlertKey({ summary: stahlman })).toBe(recurringThreeCxAlertKey({ summary: `  ${stahlman}  ` }));
    expect(recurringThreeCxAlertKey({ summary: stahlman })).not.toBe(recurringThreeCxAlertKey({
      summary: "3CX Alert: Trunk/Provider responds to Request with an error - System wide - another.fl.3cx.us",
    }));
    expect(recurringThreeCxAlertKey({ summary: "New missed call from +1239" })).toBeNull();
    expect(recurringThreeCxAlertKey({ summary: "New Voicemail from +1239" })).toBeNull();
  });
});
