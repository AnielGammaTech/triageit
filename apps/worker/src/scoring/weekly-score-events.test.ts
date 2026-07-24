import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  easternScoreWeekKey,
  recordWeeklyScoreEvent,
} from "./weekly-score-events.js";

describe("weekly score events", () => {
  it("uses the Eastern Monday as the score-week key across DST", () => {
    expect(easternScoreWeekKey(new Date("2026-07-24T13:00:00Z"))).toBe("2026-07-20");
    expect(easternScoreWeekKey(new Date("2026-11-01T16:00:00Z"))).toBe("2026-10-26");
    expect(easternScoreWeekKey(new Date("2026-11-02T16:00:00Z"))).toBe("2026-11-02");
  });

  it("upserts by event key so repeated scans cannot double-charge", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const supabase = { from } as unknown as SupabaseClient;

    await recordWeeklyScoreEvent(supabase, {
      eventKey: "sla_breach:2026-07-20:41570",
      eventType: "sla_breach",
      haloTicketId: 41570,
      technicianName: "Ryan Fitzpatrick",
      points: -3,
      occurredAt: "2026-07-24T13:00:00Z",
      summary: "Example",
    });

    expect(from).toHaveBeenCalledWith("weekly_score_events");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_key: "sla_breach:2026-07-20:41570",
        points: -3,
      }),
      { onConflict: "event_key", ignoreDuplicates: true },
    );
  });
});
