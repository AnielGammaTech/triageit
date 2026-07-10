import { describe, expect, it } from "vitest";
import { resolveTechStatus, type TechSignals } from "./presence.js";

const base: TechSignals = {
  onPtoToday: false, onsiteAppointment: null, inMeetingUntil: null,
  onCall: false, workingTicket: null, phoneProfile: "Available",
  extensionRegistered: true, withinBusinessHours: true,
};

describe("resolveTechStatus priority order", () => {
  it("PTO beats everything", () => {
    expect(resolveTechStatus({ ...base, onPtoToday: true, onCall: true }).state).toBe("off");
  });
  it("onsite beats meeting/call", () => {
    const s = resolveTechStatus({ ...base, onsiteAppointment: { subject: "Allen Concrete", endsAt: "2026-07-10T20:00:00Z" }, onCall: true });
    expect(s.state).toBe("onsite");
    expect(s.detail).toContain("Allen Concrete");
  });
  it("meeting beats call", () => {
    expect(resolveTechStatus({ ...base, inMeetingUntil: "2026-07-10T20:00:00Z", onCall: true }).state).toBe("meeting");
  });
  it("call beats available", () => {
    expect(resolveTechStatus({ ...base, onCall: true }).state).toBe("on_call");
  });
  it("registered in business hours = available", () => {
    expect(resolveTechStatus(base).state).toBe("available");
  });
  it("call beats working a ticket", () => {
    const s = resolveTechStatus({ ...base, onCall: true, workingTicket: { haloId: 41013, summary: "Printer" } });
    expect(s.state).toBe("on_call");
  });
  it("an In Progress ticket means working, not available", () => {
    const s = resolveTechStatus({ ...base, workingTicket: { haloId: 41013, summary: "Printer error" } });
    expect(s.state).toBe("working");
    expect(s.detail).toContain("#41013");
  });
  it("3CX DND profile blocks available", () => {
    expect(resolveTechStatus({ ...base, phoneProfile: "Do Not Disturb" }).state).toBe("dnd");
  });
  it("3CX Away/Out of office profile shows away", () => {
    expect(resolveTechStatus({ ...base, phoneProfile: "Out of office" }).state).toBe("away");
    expect(resolveTechStatus({ ...base, phoneProfile: "Away" }).state).toBe("away");
  });
  it("working beats DND", () => {
    const s = resolveTechStatus({ ...base, phoneProfile: "Do Not Disturb", workingTicket: { haloId: 1, summary: null } });
    expect(s.state).toBe("working");
  });
  it("no registration, no signals = unreachable", () => {
    expect(resolveTechStatus({ ...base, extensionRegistered: false }).state).toBe("unreachable");
  });
  it("all sources unknown = unknown, never available", () => {
    expect(resolveTechStatus({ ...base, onPtoToday: null, onCall: null, extensionRegistered: null }).state).toBe("unknown");
  });
  it("outside business hours never claims available", () => {
    expect(resolveTechStatus({ ...base, withinBusinessHours: false }).state).not.toBe("available");
  });
  it("registered outside business hours = after_hours, not an error state", () => {
    const s = resolveTechStatus({ ...base, withinBusinessHours: false });
    expect(s.state).toBe("after_hours");
    expect(s.detail).toBeNull();
  });
});
