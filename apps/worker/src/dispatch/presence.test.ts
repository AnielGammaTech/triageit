import { describe, expect, it } from "vitest";
import { resolveTechStatus, type TechSignals } from "./presence.js";

const base: TechSignals = {
  onPtoToday: false, onsiteAppointment: null, inMeetingUntil: null,
  onCall: false, extensionRegistered: true, withinBusinessHours: true,
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
  it("no registration, no signals = unreachable", () => {
    expect(resolveTechStatus({ ...base, extensionRegistered: false }).state).toBe("unreachable");
  });
  it("all sources unknown = unknown, never available", () => {
    expect(resolveTechStatus({ ...base, onPtoToday: null, onCall: null, extensionRegistered: null }).state).toBe("unknown");
  });
  it("outside business hours never claims available", () => {
    expect(resolveTechStatus({ ...base, withinBusinessHours: false }).state).not.toBe("available");
  });
});
