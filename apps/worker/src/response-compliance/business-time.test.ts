import { describe, expect, it } from "vitest";
import {
  addResponseBusinessMinutes,
  isResponseBusinessTime,
  responseBusinessMinutesBetween,
} from "./business-time.js";

describe("response business time", () => {
  it("uses the 8:00 AM to 5:00 PM Eastern weekday window", () => {
    expect(isResponseBusinessTime(new Date("2026-07-14T12:00:00Z"))).toBe(true); // 8:00 ET
    expect(isResponseBusinessTime(new Date("2026-07-14T20:59:00Z"))).toBe(true); // 4:59 ET
    expect(isResponseBusinessTime(new Date("2026-07-14T21:00:00Z"))).toBe(false); // 5:00 ET
    expect(isResponseBusinessTime(new Date("2026-07-18T14:00:00Z"))).toBe(false);
  });

  it("pauses a deadline overnight", () => {
    expect(addResponseBusinessMinutes(new Date("2026-07-14T20:45:00Z"), 30).toISOString())
      .toBe("2026-07-15T12:15:00.000Z");
  });

  it("pauses a deadline over the weekend", () => {
    expect(addResponseBusinessMinutes(new Date("2026-07-17T20:45:00Z"), 30).toISOString())
      .toBe("2026-07-20T12:15:00.000Z");
  });

  it("counts only elapsed business minutes", () => {
    expect(responseBusinessMinutesBetween(
      new Date("2026-07-17T20:45:00Z"),
      new Date("2026-07-20T12:15:00Z"),
    )).toBe(30);
  });

  it("does not start an overnight customer-reply clock until 8 AM Eastern", () => {
    expect(responseBusinessMinutesBetween(
      new Date("2026-07-23T03:08:00Z"), // Jul 22, 11:08 PM ET
      new Date("2026-07-23T12:32:00Z"), // Jul 23, 8:32 AM ET
    )).toBe(32);
  });
});
