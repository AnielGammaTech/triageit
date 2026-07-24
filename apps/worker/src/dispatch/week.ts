import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import { effectiveOnsiteEnd, fetchAppointments, type DispatchAppointment } from "./appointments.js";
import { etWallToUtcMs } from "./et-time.js";
import {
  fetchRoster,
  loadMsGraphIntegration,
  namesMatch,
  type RosterAgent,
} from "./board-sources.js";
import { fetchSharedCalendarEvents, techsMatchingOffSubject } from "./pto-calendar.js";
import {
  nextSaturdaySupportAssignment,
  SATURDAY_SUPPORT_CALENDAR_NAME,
  type SaturdaySupportAssignment,
} from "./saturday-support.js";

/**
 * Daily schedule data for the dispatch page: per tech, per ET day — Halo
 * appointments (typed Site Visit / Reminder), Teams meetings from personal
 * calendars, and PTO from the shared employee calendar. Sources degrade
 * independently; a failed source simply contributes no events.
 */

export interface WeekEvent {
  readonly day: string; // YYYY-MM-DD (ET)
  readonly type: "site_visit" | "reminder" | "pto" | "meeting";
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  /** Halo ticket the appointment belongs to — null for PTO and unlinked events. */
  readonly ticketId: number | null;
}

export interface WeekData {
  readonly start: string;
  /** Halo web base URL (no trailing slash) for ticket links; "" when Halo isn't configured. */
  readonly haloBaseUrl: string;
  /** Active or next upcoming assignment from Saturday Support Schedule V2. */
  readonly saturdaySupport: SaturdaySupportAssignment | null;
  readonly days: ReadonlyArray<string>;
  readonly techs: ReadonlyArray<{
    readonly tech: string;
    readonly events: ReadonlyArray<WeekEvent>;
  }>;
}

const CACHE_TTL_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;
const MAX_SUBJECT = 60;
/** One dispatcher day at a time; navigation requests the next date explicitly. */
const WINDOW_DAYS = 1;

let cache: { readonly key: string; readonly at: number; readonly data: WeekData } | null = null;

/** Today's ET date as YYYY-MM-DD. */
function todayEt(now: Date): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ET calendar day of a UTC instant, as YYYY-MM-DD. */
function etDayOf(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** The window's days covered by [startsAt, endsAt), as ET day strings. */
function coveredDays(startsAt: string, endsAt: string, days: ReadonlyArray<string>): ReadonlyArray<string> {
  const firstDay = etDayOf(startsAt);
  // Subtract a millisecond so midnight-exclusive ends don't bleed a day over.
  const lastDay = etDayOf(new Date(Date.parse(endsAt) - 1).toISOString());
  return days.filter((d) => d >= firstDay && d <= lastDay);
}

function appointmentEvents(
  agent: RosterAgent,
  appointments: ReadonlyArray<DispatchAppointment>,
  days: ReadonlyArray<string>,
): ReadonlyArray<WeekEvent> {
  return appointments
    .filter((a) => (agent.id > 0 && a.agentId === agent.id) || namesMatch(agent.name, a.agentName))
    .flatMap((a) => {
      const type = (a.type ?? "").toLowerCase() === "site visit" ? ("site_visit" as const) : ("reminder" as const);
      const endsAt = type === "site_visit" ? (effectiveOnsiteEnd(a) ?? a.endsAt) : a.endsAt;
      return coveredDays(a.startsAt, endsAt, days).map((day) => ({
        day,
        type,
        subject: a.subject.slice(0, MAX_SUBJECT),
        startsAt: a.startsAt,
        endsAt,
        allDay: false,
        ticketId: a.ticketId,
      }));
    });
}

function isTeamsMeeting(event: MsGraphCalendarEvent): boolean {
  const provider = event.onlineMeetingProvider?.toLowerCase() ?? "";
  return provider.includes("teams") || (event.isOnlineMeeting && (!provider || provider === "unknown"));
}

/** Convert a technician's actual Microsoft 365 Teams meetings into schedule rows. */
export function teamsMeetingEvents(
  events: ReadonlyArray<MsGraphCalendarEvent>,
  days: ReadonlyArray<string>,
): ReadonlyArray<WeekEvent> {
  return events
    .filter((event) => !event.isAllDay && isTeamsMeeting(event))
    .flatMap((event) =>
      coveredDays(event.startsAt, event.endsAt, days).map((day) => ({
        day,
        type: "meeting" as const,
        subject: (event.subject ?? "Teams meeting").slice(0, MAX_SUBJECT),
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: false,
        ticketId: null,
      })),
    );
}

function sameTimedSubject(a: WeekEvent, b: WeekEvent): boolean {
  const aSubject = a.subject.trim().toLowerCase();
  const bSubject = b.subject.trim().toLowerCase();
  const subjectsMatch = aSubject.length >= 4 && bSubject.length >= 4 &&
    (aSubject.includes(bSubject) || bSubject.includes(aSubject));
  const overlaps = Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt);
  return subjectsMatch && overlaps;
}

export async function buildWeekData(startParam?: string | null): Promise<WeekData> {
  const now = new Date();
  const today = todayEt(now);
  // Never look backwards — the earliest visible day is always today.
  const requested =
    startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : today;
  const start = requested < today ? today : requested;
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(start, i));

  if (cache && cache.key === start && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const startUtcMs = etWallToUtcMs(`${start}T00:00:00`);
  const startUtc = startUtcMs !== null ? new Date(startUtcMs).toISOString() : new Date().toISOString();
  const endUtcMs = etWallToUtcMs(`${addDays(start, WINDOW_DAYS)}T00:00:00`);
  const endUtc = new Date(endUtcMs ?? Date.parse(startUtc) + WINDOW_DAYS * DAY_MS).toISOString();

  const supabase = createSupabaseClient();
  let halo: HaloClient | null = null;
  let haloBaseUrl = "";
  try {
    const haloConfig = await getCachedHaloConfig(supabase);
    if (haloConfig) {
      halo = new HaloClient(haloConfig);
      haloBaseUrl = (haloConfig.base_url ?? "").replace(/\/$/, "");
    }
  } catch (err) {
    console.warn("[DISPATCH] Week: Halo config lookup failed:", err instanceof Error ? err.message : err);
  }

  const [roster, appointments, msgraph] = await Promise.all([
    fetchRoster(halo),
    fetchAppointments(halo, startUtc, endUtc),
    loadMsGraphIntegration(supabase),
  ]);
  const rosterAgents = roster ?? [];

  let ptoEvents: ReadonlyArray<MsGraphCalendarEvent> | null = null;
  let saturdaySupport: SaturdaySupportAssignment | null = null;
  const personalCalendars = new Map<string, ReadonlyArray<MsGraphCalendarEvent>>();
  if (msgraph) {
    const withEmail = rosterAgents.filter(
      (agent): agent is RosterAgent & { email: string } => agent.email !== null,
    );
    const saturdayWindowEnd = new Date(now.getTime() + 90 * DAY_MS).toISOString();
    const [sharedPto, saturdayEvents, personalResults] = await Promise.all([
      fetchSharedCalendarEvents(msgraph.graph, rosterAgents, msgraph.ptoCalendarName, startUtc, endUtc),
      fetchSharedCalendarEvents(
        msgraph.graph,
        rosterAgents,
        SATURDAY_SUPPORT_CALENDAR_NAME,
        now.toISOString(),
        saturdayWindowEnd,
      ),
      Promise.all(
        withEmail.map(async (agent) => ({
          tech: agent.name,
          events: await msgraph.graph.getCalendarView(agent.email, startUtc, endUtc),
        })),
      ),
    ]);
    ptoEvents = sharedPto;
    saturdaySupport = saturdayEvents
      ? nextSaturdaySupportAssignment(saturdayEvents, now)
      : null;
    for (const result of personalResults) {
      if (result.events !== null) personalCalendars.set(result.tech, result.events);
    }
  }

  const techs = rosterAgents.map((agent) => {
    const fromAppointments = appointments ? appointmentEvents(agent, appointments, days) : [];
    const fromTeams = teamsMeetingEvents(personalCalendars.get(agent.name) ?? [], days);
    // Halo reminders can also be synchronized into Outlook. When the same
    // timed subject is a Teams meeting, keep the purple meeting row once.
    const uniqueAppointments = fromAppointments.filter(
      (appointment) =>
        appointment.type === "site_visit" || !fromTeams.some((meeting) => sameTimedSubject(appointment, meeting)),
    );
    const fromPto = (ptoEvents ?? [])
      .filter((e) => techsMatchingOffSubject(e.subject, [agent]).length > 0)
      .flatMap((e) =>
        coveredDays(e.startsAt, e.endsAt, days).map((day) => ({
          day,
          type: "pto" as const,
          subject: (e.subject ?? "OFF").slice(0, MAX_SUBJECT),
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          allDay: true,
          ticketId: null,
        })),
      );
    // Halo can return near-identical rows (recurrences, ticket copies) —
    // one chip per (day, subject, start) is what a human wants to see.
    const seen = new Set<string>();
    const events = [...uniqueAppointments, ...fromTeams, ...fromPto]
      .filter((e) => {
        const key = `${e.day}|${e.type}|${e.subject.toLowerCase()}|${e.startsAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.day.localeCompare(b.day) || Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return { tech: agent.name, events };
  });

  const data: WeekData = { start, haloBaseUrl, saturdaySupport, days, techs };
  cache = { key: start, at: Date.now(), data };
  console.log(
    `[DISPATCH] Day built ${start}: ${techs.length} techs, ${techs.reduce((n, t) => n + t.events.length, 0)} events (halo=${appointments !== null}, personalCalendars=${personalCalendars.size}, pto=${ptoEvents !== null}, saturdaySupport=${saturdaySupport?.technician ?? "none"})`,
  );
  return data;
}
