import { fmtEtDayAware } from "./time-format.js";

export interface TechSignals {
  readonly onPtoToday: boolean | null;        // null = calendar source unavailable (Outlook oof/all-day when connected)
  readonly onsiteAppointment: { readonly subject: string; readonly endsAt: string } | null;
  readonly inMeetingUntil: string | null;     // ISO end of current busy block, null = none/unknown
  readonly onCall: boolean | null;            // null = 3CX unavailable
  readonly extensionRegistered: boolean | null;
  readonly withinBusinessHours: boolean;
}

export interface TechStatus {
  readonly state: "off" | "onsite" | "meeting" | "on_call" | "available" | "unreachable" | "unknown";
  readonly detail: string | null;             // e.g. "Onsite — Allen Concrete until 4:00 PM"
}

export function resolveTechStatus(s: TechSignals): TechStatus {
  if (s.onPtoToday === true) return { state: "off", detail: "Off today (PTO)" };
  if (s.onsiteAppointment) return { state: "onsite", detail: `Onsite — ${s.onsiteAppointment.subject} until ${fmtEtDayAware(s.onsiteAppointment.endsAt)}` };
  if (s.inMeetingUntil) return { state: "meeting", detail: `In a meeting until ${fmtEtDayAware(s.inMeetingUntil)}` };
  if (s.onCall === true) return { state: "on_call", detail: "On a call" };
  if (s.extensionRegistered === true && s.withinBusinessHours) return { state: "available", detail: null };
  if (s.extensionRegistered === false) return { state: "unreachable", detail: "No phone registered" };
  return { state: "unknown", detail: "No presence signal" };
}
