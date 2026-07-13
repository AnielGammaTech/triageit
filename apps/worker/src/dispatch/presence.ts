import { fmtEtDayAware } from "./time-format.js";

export interface TechSignals {
  readonly onPtoToday: boolean | null;        // null = calendar source unavailable (Outlook oof / employee PTO calendar)
  readonly onsiteAppointment: {
    readonly subject: string;
    readonly endsAt: string;
    readonly ticketId: number | null;
  } | null;
  readonly inMeetingUntil: string | null;     // ISO end of current busy block, null = none/unknown
  readonly onCall: boolean | null;            // null = 3CX unavailable
  /** Ticket the tech has in "In Progress" — actively being worked, so not available. */
  readonly workingTicket: { readonly haloId: number; readonly summary: string | null } | null;
  /** Raw 3CX profile: Available / Away / Do Not Disturb / Out of office / ... */
  readonly phoneProfile: string | null;
  readonly extensionRegistered: boolean | null;
  readonly withinBusinessHours: boolean;
}

export interface TechStatus {
  readonly state:
    | "off"
    | "onsite"
    | "meeting"
    | "on_call"
    | "working"
    | "dnd"
    | "away"
    | "available"
    | "after_hours"
    | "unreachable"
    | "unknown";
  readonly detail: string | null;             // e.g. "Onsite — Allen Concrete until 4:00 PM"
}

const DND_RE = /do\s*not\s*disturb|dnd/i;
const AWAY_RE = /away|out\s*of\s*office|business\s*trip|lunch/i;

export function resolveTechStatus(s: TechSignals): TechStatus {
  if (s.onPtoToday === true) return { state: "off", detail: "Off today (PTO)" };
  if (s.onsiteAppointment) {
    const ticket = s.onsiteAppointment.ticketId !== null ? ` ticket #${s.onsiteAppointment.ticketId}` : "";
    return {
      state: "onsite",
      detail: `Onsite${ticket} — ${s.onsiteAppointment.subject} until ${fmtEtDayAware(s.onsiteAppointment.endsAt)}`,
    };
  }
  if (s.inMeetingUntil) return { state: "meeting", detail: `In a meeting until ${fmtEtDayAware(s.inMeetingUntil)}` };
  if (s.onCall === true) return { state: "on_call", detail: "On a call" };
  if (s.workingTicket) {
    return {
      state: "working",
      detail: `Working ticket #${s.workingTicket.haloId}${s.workingTicket.summary ? ` — ${s.workingTicket.summary}` : ""}`,
    };
  }
  if (s.phoneProfile && DND_RE.test(s.phoneProfile)) return { state: "dnd", detail: "Phone set to Do Not Disturb" };
  if (s.phoneProfile && /lunch/i.test(s.phoneProfile)) return { state: "away", detail: "Out to lunch" };
  if (s.phoneProfile && AWAY_RE.test(s.phoneProfile)) return { state: "away", detail: `Phone set to ${s.phoneProfile}` };
  if (s.extensionRegistered === true && s.withinBusinessHours) return { state: "available", detail: null };
  // Registered but outside the workday — a calm, expected state, not an
  // error. The chip is self-explanatory; no detail line needed.
  if (s.extensionRegistered === true && !s.withinBusinessHours) return { state: "after_hours", detail: null };
  if (s.extensionRegistered === false) return { state: "unreachable", detail: "No phone registered" };
  return { state: "unknown", detail: "No presence signal" };
}
