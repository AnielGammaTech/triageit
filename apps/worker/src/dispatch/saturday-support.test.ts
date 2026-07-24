import { describe, expect, it } from "vitest";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import {
  nextSaturdaySupportAssignment,
  technicianFromSaturdaySupportSubject,
} from "./saturday-support.js";

const event = (
  subject: string,
  startsAt: string,
  endsAt: string,
): MsGraphCalendarEvent => ({
  subject,
  startsAt,
  endsAt,
  showAs: "busy",
  isAllDay: false,
  isOnlineMeeting: false,
  onlineMeetingProvider: null,
  categories: [],
});

describe("Saturday Support calendar", () => {
  it("parses the technician from the live subject format", () => {
    expect(technicianFromSaturdaySupportSubject("Saturday Support - Jonathan")).toBe("Jonathan");
    expect(technicianFromSaturdaySupportSubject("Saturday Support — Ryan Fitzpatrick")).toBe("Ryan Fitzpatrick");
    expect(technicianFromSaturdaySupportSubject("Team meeting")).toBeNull();
  });

  it("returns the active shift before a later future shift", () => {
    const assignment = nextSaturdaySupportAssignment([
      event("Saturday Support - Jonathan", "2026-07-25T12:00:00Z", "2026-07-25T21:00:00Z"),
      event("Saturday Support - Darren", "2026-08-08T12:00:00Z", "2026-08-08T21:00:00Z"),
    ], new Date("2026-07-25T15:00:00Z"));

    expect(assignment).toEqual({
      technician: "Jonathan",
      subject: "Saturday Support - Jonathan",
      startsAt: "2026-07-25T12:00:00Z",
      endsAt: "2026-07-25T21:00:00Z",
    });
  });

  it("skips completed and unrelated events", () => {
    const assignment = nextSaturdaySupportAssignment([
      event("Saturday Support - Jonathan", "2026-07-25T12:00:00Z", "2026-07-25T21:00:00Z"),
      event("Company picnic", "2026-08-01T12:00:00Z", "2026-08-01T21:00:00Z"),
      event("Saturday Support - Darren", "2026-08-08T12:00:00Z", "2026-08-08T21:00:00Z"),
    ], new Date("2026-07-26T12:00:00Z"));

    expect(assignment?.technician).toBe("Darren");
  });
});
