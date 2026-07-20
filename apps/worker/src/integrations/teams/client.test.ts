import { describe, expect, it } from "vitest";
import { isWithinBusinessHours } from "./client.js";

describe("automated outbound business-hours gate", () => {
  it("allows weekday messages during the configured Eastern window", () => {
    expect(isWithinBusinessHours(new Date("2026-07-13T12:00:00.000Z"))).toBe(true); // Monday 8:00am ET
    expect(isWithinBusinessHours(new Date("2026-07-13T20:59:00.000Z"))).toBe(true); // Monday 4:59pm ET
  });

  it("blocks weekday messages before and after the configured Eastern window", () => {
    expect(isWithinBusinessHours(new Date("2026-07-13T11:59:00.000Z"))).toBe(false);
    expect(isWithinBusinessHours(new Date("2026-07-13T21:00:00.000Z"))).toBe(false);
  });

  it("blocks messages and calls for the entire weekend", () => {
    expect(isWithinBusinessHours(new Date("2026-07-11T16:00:00.000Z"))).toBe(false); // Saturday noon ET
    expect(isWithinBusinessHours(new Date("2026-07-12T16:00:00.000Z"))).toBe(false); // Sunday noon ET
  });
});
