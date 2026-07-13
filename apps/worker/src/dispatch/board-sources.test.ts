import { describe, expect, it } from "vitest";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import {
  calendarSignalFromEvents,
  isCustomerReplyStatus,
  isWaitingOnTechStatus,
} from "./board-sources.js";

const NOW = Date.parse("2026-07-10T16:00:00.000Z");

const event = (over: Partial<MsGraphCalendarEvent>): MsGraphCalendarEvent => ({
  subject: "Event",
  startsAt: "2026-07-10T04:00:00.000Z",
  endsAt: "2026-07-11T04:00:00.000Z",
  showAs: "free",
  isAllDay: true,
  isOnlineMeeting: false,
  onlineMeetingProvider: null,
  categories: [],
  ...over,
});

describe("calendarSignalFromEvents personal PTO rule", () => {
  it("all-day 'free' events (birthdays, holidays) do NOT mark a tech off", () => {
    expect(calendarSignalFromEvents([event({ subject: "Company Holiday" })], NOW).onPtoToday).toBe(false);
  });

  it("all-day oof or busy events count as PTO", () => {
    expect(calendarSignalFromEvents([event({ showAs: "oof" })], NOW).onPtoToday).toBe(true);
    expect(calendarSignalFromEvents([event({ showAs: "busy" })], NOW).onPtoToday).toBe(true);
  });

  it("a non-all-day oof block still counts as PTO", () => {
    const halfDayOof = event({
      isAllDay: false,
      showAs: "oof",
      startsAt: "2026-07-10T16:00:00.000Z",
      endsAt: "2026-07-10T21:00:00.000Z",
    });
    expect(calendarSignalFromEvents([halfDayOof], NOW).onPtoToday).toBe(true);
  });

  it("all-day 'tentative' does not count as PTO", () => {
    expect(calendarSignalFromEvents([event({ showAs: "tentative" })], NOW).onPtoToday).toBe(false);
  });

  it("still reports the current busy block for the meeting signal", () => {
    const meeting = event({
      isAllDay: false,
      showAs: "busy",
      startsAt: "2026-07-10T15:30:00.000Z",
      endsAt: "2026-07-10T16:30:00.000Z",
    });
    const signal = calendarSignalFromEvents([meeting], NOW);
    expect(signal.inMeetingUntil).toBe("2026-07-10T16:30:00.000Z");
    expect(signal.onPtoToday).toBe(false);
  });
});

describe("Halo dispatch status matching", () => {
  it("uses Halo's canonical Customer Reply status ID even when the label is absent", () => {
    expect(isCustomerReplyStatus(30, null)).toBe(true);
    expect(isCustomerReplyStatus(null, "Customer Reply")).toBe(true);
    expect(isCustomerReplyStatus(32, "Waiting on Tech")).toBe(false);
  });

  it("uses Halo's canonical Waiting On Tech status ID even when the label is absent", () => {
    expect(isWaitingOnTechStatus(32, null)).toBe(true);
    expect(isWaitingOnTechStatus(null, "Waiting on Tech")).toBe(true);
    expect(isWaitingOnTechStatus(30, "Customer Reply")).toBe(false);
  });
});
