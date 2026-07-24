import { describe, expect, it } from "vitest";
import { isSaturdaySupportVerificationWindow } from "./saturday-support-verification.js";

describe("Saturday support verification window", () => {
  it("opens during the 8 AM Eastern hour on Saturday", () => {
    expect(isSaturdaySupportVerificationWindow(new Date("2026-07-25T12:05:00Z"))).toBe(true);
  });

  it("does not run on Friday or later Saturday hours", () => {
    expect(isSaturdaySupportVerificationWindow(new Date("2026-07-24T12:05:00Z"))).toBe(false);
    expect(isSaturdaySupportVerificationWindow(new Date("2026-07-25T13:05:00Z"))).toBe(false);
  });
});
