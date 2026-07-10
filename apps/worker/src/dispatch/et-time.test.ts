import { describe, expect, it } from "vitest";
import { etTodayBounds, etWallToUtcIso, haloEtToUtcIso, utcIsoToEtWall } from "./et-time.js";

describe("etWallToUtcIso", () => {
  it("converts ET wall-clock to UTC during EDT (UTC-4)", () => {
    // Verified live 2026-07-10: Halo "2026-07-13T11:00:00" means 11 AM Eastern.
    expect(etWallToUtcIso("2026-07-13T11:00:00")).toBe("2026-07-13T15:00:00.000Z");
  });

  it("converts ET wall-clock to UTC during EST (UTC-5)", () => {
    expect(etWallToUtcIso("2026-01-13T11:00:00")).toBe("2026-01-13T16:00:00.000Z");
  });

  it("handles missing seconds", () => {
    expect(etWallToUtcIso("2026-07-13T11:00")).toBe("2026-07-13T15:00:00.000Z");
  });

  it("returns null for garbage", () => {
    expect(etWallToUtcIso("not a date")).toBeNull();
    expect(etWallToUtcIso("")).toBeNull();
  });
});

describe("haloEtToUtcIso", () => {
  it("treats offset-less strings as UTC (verified live: ticket #40930's 4 PM ET came back as 20:00)", () => {
    expect(haloEtToUtcIso("2026-07-14T20:00:00")).toBe("2026-07-14T20:00:00.000Z");
  });

  it("passes through explicit UTC/offset strings unchanged", () => {
    expect(haloEtToUtcIso("2026-07-13T15:00:00Z")).toBe("2026-07-13T15:00:00.000Z");
    expect(haloEtToUtcIso("2026-07-13T11:00:00-04:00")).toBe("2026-07-13T15:00:00.000Z");
  });
});

describe("utcIsoToEtWall", () => {
  it("round-trips a UTC instant back to ET wall-clock", () => {
    expect(utcIsoToEtWall("2026-07-13T15:00:00.000Z")).toBe("2026-07-13T11:00:00");
    expect(utcIsoToEtWall("2026-01-13T16:00:00.000Z")).toBe("2026-01-13T11:00:00");
  });

  it("returns null for garbage", () => {
    expect(utcIsoToEtWall("nope")).toBeNull();
  });
});

describe("etTodayBounds", () => {
  it("spans exactly 24 hours starting at ET midnight", () => {
    const { start, end } = etTodayBounds(new Date("2026-07-10T16:00:00Z"));
    expect(start).toBe("2026-07-10T04:00:00.000Z"); // midnight ET in EDT
    expect(Date.parse(end) - Date.parse(start)).toBe(24 * 3600_000);
  });
});
