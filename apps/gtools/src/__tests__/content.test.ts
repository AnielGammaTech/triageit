import { describe, expect, it } from "vitest";
import { TOOLS } from "@/content/tools";

describe("tools content integrity", () => {
  it("has exactly 11 tools", () => {
    expect(TOOLS).toHaveLength(11);
  });

  it("has unique slugs matching their mockup keys", () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(11);
    for (const t of TOOLS) expect(t.mockup).toBe(t.slug);
  });

  it("has non-empty copy everywhere", () => {
    for (const t of TOOLS) {
      expect(t.name.trim()).not.toBe("");
      expect(t.oneLiner.trim()).not.toBe("");
      expect(t.tagline.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
      expect(t.features.length).toBeGreaterThanOrEqual(3);
      expect(t.features.length).toBeLessThanOrEqual(4);
      for (const f of t.features) {
        expect(f.title.trim()).not.toBe("");
        expect(f.blurb.trim()).not.toBe("");
      }
      expect(t.integrations.length).toBeGreaterThan(0);
      expect(t.accent).toBe(t.slug);
    }
  });

  it("never overclaims ConnectIT connectors", () => {
    const connectit = TOOLS.find((t) => t.slug === "connectit");
    const text = JSON.stringify(connectit).toLowerCase();
    expect(text).not.toContain("14 integrations live");
    expect(text).not.toContain("all connectors live");
  });
});
