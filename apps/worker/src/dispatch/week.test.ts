import { describe, expect, it } from "vitest";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import { teamsMeetingEvents } from "./week.js";

const event = (over: Partial<MsGraphCalendarEvent> = {}): MsGraphCalendarEvent => ({
  subject: "Project check-in",
  startsAt: "2026-07-13T14:00:00.000Z",
  endsAt: "2026-07-13T14:30:00.000Z",
  showAs: "busy",
  isAllDay: false,
  isOnlineMeeting: true,
  onlineMeetingProvider: "teamsForBusiness",
  categories: [],
  ...over,
});

describe("teamsMeetingEvents", () => {
  it("turns Teams calendar events into purple meeting schedule data", () => {
    expect(teamsMeetingEvents([event()], ["2026-07-13"])).toEqual([
      expect.objectContaining({
        day: "2026-07-13",
        type: "meeting",
        subject: "Project check-in",
        ticketId: null,
      }),
    ]);
  });

  it("does not label ordinary Outlook events or all-day blocks as Teams meetings", () => {
    const outlookOnly = event({ isOnlineMeeting: false, onlineMeetingProvider: null });
    const allDayTeams = event({ isAllDay: true });
    expect(teamsMeetingEvents([outlookOnly, allDayTeams], ["2026-07-13"])).toEqual([]);
  });

  it("uses a readable fallback when a Teams event has no subject", () => {
    expect(teamsMeetingEvents([event({ subject: null })], ["2026-07-13"])[0]?.subject).toBe("Teams meeting");
  });
});
