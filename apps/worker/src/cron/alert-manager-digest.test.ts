import { describe, expect, it } from "vitest";
import { buildAlertDigestHtml, partitionAlertDigestRows } from "./alert-manager-digest.js";

describe("buildAlertDigestHtml", () => {
  it("renders a compact expandable review page", () => {
    const html = buildAlertDigestHtml([{
      id: "event-1",
      halo_id: 41226,
      event_type: "alert_manager_auto_closed",
      note: "Transient throttling",
      payload: {
        ticket_summary: "Spanning Backup for Office 365 - Error",
        source: "Spanning",
        confidence: 0.98,
        reason: "Microsoft throttling normally self-resolves.",
        pattern_key: "spanning:14021",
      },
      created_at: "2026-07-16T13:52:00.000Z",
    }], "https://example.halopsa.com", new Date("2026-07-16T13:50:00.000Z"), new Date("2026-07-16T13:52:00.000Z"));

    expect(html).toContain("<details");
    expect(html).toContain("Auto-closed noise");
    expect(html).toContain("Daily assignment workflow");
    expect(html).toContain("Open original Halo ticket");
    expect(html).not.toContain("<table");
  });
});

describe("partitionAlertDigestRows", () => {
  it("keeps a 500-decision run on one parent ticket with seven bounded sections", () => {
    const sections = partitionAlertDigestRows(Array.from({ length: 500 }, (_, index) => index));

    expect(sections).toHaveLength(7);
    expect(sections.map((section) => section.length)).toEqual([75, 75, 75, 75, 75, 75, 50]);
  });
});
