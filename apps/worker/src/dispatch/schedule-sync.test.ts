import { describe, expect, it } from "vitest";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import type { DispatchAppointment } from "./appointments.js";
import {
  eventMatchesAppointment,
  isSyncableAppointment,
  outlookBodyFor,
  outlookSubjectFor,
} from "./schedule-sync.js";

const appt = (over: Partial<DispatchAppointment> = {}): DispatchAppointment => ({
  agentId: 1,
  agentName: "Darren Smith",
  subject: "Acme Corp — Jenn :: Laptop Setup",
  rawSubject: "Jenn :: Laptop Setup",
  type: "Site Visit",
  ticketId: 41013,
  note: "Bring the dock",
  clientName: "Acme Corp",
  siteName: "Main Office",
  startsAt: "2026-07-13T15:00:00.000Z",
  endsAt: "2026-07-13T17:00:00.000Z",
  ...over,
});

const event = (over: Partial<MsGraphCalendarEvent> = {}): MsGraphCalendarEvent => ({
  subject: "Jenn :: Laptop Setup",
  startsAt: "2026-07-13T15:00:00.000Z",
  endsAt: "2026-07-13T17:00:00.000Z",
  showAs: "busy",
  isAllDay: false,
  isOnlineMeeting: false,
  onlineMeetingProvider: null,
  categories: [],
  ...over,
});

describe("eventMatchesAppointment", () => {
  it("matches on overlap + subject containment (case-insensitive)", () => {
    expect(eventMatchesAppointment(appt(), event())).toBe(true);
    expect(
      eventMatchesAppointment(appt(), event({ subject: "JENN :: LAPTOP SETUP prep" })),
    ).toBe(true);
  });

  it("matches events created by Halo's native M365 sync (contains subject, overlapping)", () => {
    const nativeCopy = event({
      subject: "Jenn :: Laptop Setup",
      startsAt: "2026-07-13T15:30:00.000Z", // partial overlap is enough
      endsAt: "2026-07-13T18:00:00.000Z",
    });
    expect(eventMatchesAppointment(appt(), nativeCopy)).toBe(true);
  });

  it("matches our own TriageIT-tagged event even when times no longer overlap", () => {
    const moved = event({
      subject: "[Site Visit] Jenn :: Laptop Setup",
      startsAt: "2026-07-14T15:00:00.000Z",
      endsAt: "2026-07-14T17:00:00.000Z",
      categories: ["TriageIT"],
    });
    expect(eventMatchesAppointment(appt(), moved)).toBe(true);
  });

  it("does NOT match an overlapping event with a different subject", () => {
    expect(eventMatchesAppointment(appt(), event({ subject: "Dentist" }))).toBe(false);
  });

  it("does NOT match same subject without overlap or TriageIT category", () => {
    const later = event({
      startsAt: "2026-07-14T15:00:00.000Z",
      endsAt: "2026-07-14T17:00:00.000Z",
    });
    expect(eventMatchesAppointment(appt(), later)).toBe(false);
  });

  it("compares only the first 40 chars of the appointment subject", () => {
    const longSubject = "A".repeat(60);
    const a = appt({ rawSubject: longSubject });
    // Event subject holds only the first 40 chars — still a match.
    expect(eventMatchesAppointment(a, event({ subject: "A".repeat(40) }))).toBe(true);
  });
});

describe("isSyncableAppointment", () => {
  it("accepts a normal appointment", () => {
    expect(isSyncableAppointment(appt())).toBe(true);
  });

  it("rejects appointments without a subject", () => {
    expect(isSyncableAppointment(appt({ rawSubject: null }))).toBe(false);
    expect(isSyncableAppointment(appt({ rawSubject: "  " }))).toBe(false);
  });

  it("rejects insane durations (>14 days or non-positive)", () => {
    expect(isSyncableAppointment(appt({ endsAt: "2026-07-30T15:00:00.001Z" }))).toBe(false);
    expect(isSyncableAppointment(appt({ endsAt: appt().startsAt }))).toBe(false);
  });

  it("rejects the live month-long Site Visit (28 days is over the 14-day cap)", () => {
    expect(isSyncableAppointment(appt({ endsAt: "2026-08-10T20:30:00.000Z" }))).toBe(false);
  });
});

describe("outlook event content", () => {
  it("prefixes the subject with the appointment type", () => {
    expect(outlookSubjectFor(appt())).toBe("[Site Visit] Jenn :: Laptop Setup");
    expect(outlookSubjectFor(appt({ type: null }))).toBe(
      "[Appointment] Jenn :: Laptop Setup",
    );
  });

  it("builds the body from note, client/site, ticket, and provenance", () => {
    expect(outlookBodyFor(appt())).toBe(
      "Bring the dock\nAcme Corp — Main Office\nTicket #41013\nCreated by TriageIT from Halo schedule",
    );
  });

  it("omits missing pieces without blank lines", () => {
    expect(outlookBodyFor(appt({ note: null, clientName: null, siteName: null, ticketId: null }))).toBe(
      "Created by TriageIT from Halo schedule",
    );
  });
});
