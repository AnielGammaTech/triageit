import { describe, expect, it } from "vitest";
import {
  currentCommitmentLabel,
  nextCommitmentLabel,
  parseAppointment,
  qualifiesAsOnsite,
  type DispatchAppointment,
} from "./appointments.js";

// Shape of a live /api/Appointment row (verified 2026-07-10).
const liveRow = {
  agent_id: 12,
  agent_name: "Darren Smith",
  subject: "Jenn :: Laptop Setup",
  client_name: "Acme Corp",
  site_name: "Main Office",
  ticket_id: 41013,
  appointment_type_name: "Site Visit",
  note: "Bring the dock",
  start_date: "2026-07-13T11:00:00", // ET wall-clock, NO offset
  end_date: "2026-07-13T13:00:00",
};

const appt = (over: Partial<DispatchAppointment>): DispatchAppointment => ({
  agentId: 1,
  agentName: "Darren Smith",
  subject: "Acme Corp — Jenn :: Laptop Setup",
  rawSubject: "Jenn :: Laptop Setup",
  type: "Site Visit",
  ticketId: 41013,
  note: null,
  clientName: "Acme Corp",
  siteName: null,
  startsAt: "2026-07-13T15:00:00.000Z",
  endsAt: "2026-07-13T17:00:00.000Z",
  ...over,
});

describe("parseAppointment", () => {
  it("converts ET wall-clock dates to real UTC and carries type/ticket/note", () => {
    const parsed = parseAppointment(liveRow);
    expect(parsed).not.toBeNull();
    expect(parsed!.startsAt).toBe("2026-07-13T15:00:00.000Z"); // 11 AM EDT
    expect(parsed!.endsAt).toBe("2026-07-13T17:00:00.000Z");
    expect(parsed!.type).toBe("Site Visit");
    expect(parsed!.ticketId).toBe(41013);
    expect(parsed!.note).toBe("Bring the dock");
    expect(parsed!.rawSubject).toBe("Jenn :: Laptop Setup");
    expect(parsed!.subject).toBe("Acme Corp — Jenn :: Laptop Setup");
  });

  it("drops rows without parseable dates", () => {
    expect(parseAppointment({ ...liveRow, start_date: undefined })).toBeNull();
    expect(parseAppointment({ ...liveRow, end_date: "garbage" })).toBeNull();
  });
});

describe("qualifiesAsOnsite", () => {
  it("accepts a normal-length Site Visit", () => {
    expect(qualifiesAsOnsite(appt({}))).toBe(true);
  });

  it("rejects a month-long Site Visit (the live BANK SCANNER case)", () => {
    const monthLong = appt({
      startsAt: "2026-07-13T19:00:00.000Z",
      endsAt: "2026-08-10T20:30:00.000Z",
    });
    expect(qualifiesAsOnsite(monthLong)).toBe(false);
  });

  it("rejects anything over 12 hours", () => {
    const thirteenHours = appt({ endsAt: "2026-07-14T04:00:00.000Z" });
    expect(qualifiesAsOnsite(thirteenHours)).toBe(false);
  });

  it("rejects Reminders and untyped appointments regardless of duration", () => {
    expect(qualifiesAsOnsite(appt({ type: "Reminder" }))).toBe(false);
    expect(qualifiesAsOnsite(appt({ type: null }))).toBe(false);
  });
});

describe("commitment labels", () => {
  const now = new Date("2026-07-13T14:00:00.000Z"); // same ET day

  it("labels the next commitment with its type", () => {
    expect(nextCommitmentLabel(appt({}), now)).toBe(
      "Site Visit: Acme Corp — Jenn :: Laptop Setup — 11:00 AM",
    );
  });

  it("labels a Reminder as such", () => {
    const reminder = appt({ type: "Reminder", subject: "Need help with a spread sheet" });
    expect(nextCommitmentLabel(reminder, now)).toBe(
      "Reminder: Need help with a spread sheet — 11:00 AM",
    );
  });

  it("falls back to 'Appointment' when the type is missing", () => {
    expect(nextCommitmentLabel(appt({ type: null }), now)).toContain("Appointment:");
  });

  it("labels a current commitment with its end time", () => {
    expect(currentCommitmentLabel(appt({}), now)).toBe(
      "Site Visit: Acme Corp — Jenn :: Laptop Setup — until 1:00 PM",
    );
  });
});
