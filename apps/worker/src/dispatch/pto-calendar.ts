import type { MsGraphCalendarEvent, MsGraphClient } from "../integrations/msgraph/client.js";
import type { RosterAgent } from "./board-sources.js";

/**
 * Shared PTO calendar ("Gamma Tech Employee Calendar" — an Outlook calendar
 * shared into tech mailboxes, verified live 2026-07-10). Its events are
 * all-day, showAs "free", with subjects like "Ryan OFF" / "Matthew T. OFF"
 * (first name, optional last-name initial, then OFF). A matched tech is off
 * today, overriding their personal-calendar signal.
 */

export const DEFAULT_PTO_CALENDAR_NAME = "Gamma Tech Employee Calendar";

// "Ryan OFF", "Matthew T. OFF", "Bryan OFF today" — first name, optional
// single-letter last-name initial (with optional trailing dot), then OFF.
const OFF_SUBJECT_RE = /^\s*(\w+)(?:\s+(\w))?\.?\s+OFF\b/i;

export interface OffSubject {
  readonly firstName: string;
  readonly initial: string | null;
}

/** Parse a PTO-calendar subject. Null = not an OFF entry. */
export function parseOffSubject(subject: string | null): OffSubject | null {
  if (!subject) return null;
  const m = OFF_SUBJECT_RE.exec(subject);
  if (!m) return null;
  return { firstName: m[1], initial: m[2] ?? null };
}

/**
 * Roster techs an OFF subject refers to: first name must match
 * (case-insensitive) AND, when an initial is present, it must equal the
 * first letter of the tech's last name.
 */
export function techsMatchingOffSubject(
  subject: string | null,
  roster: ReadonlyArray<RosterAgent>,
): ReadonlyArray<string> {
  const off = parseOffSubject(subject);
  if (!off) return [];
  const first = off.firstName.toLowerCase();
  const initial = off.initial?.toLowerCase() ?? null;
  return roster
    .filter((agent) => {
      const tokens = agent.name.trim().split(/\s+/);
      if ((tokens[0] ?? "").toLowerCase() !== first) return false;
      if (initial === null) return true;
      const lastName = tokens.length > 1 ? tokens[tokens.length - 1] : null;
      return lastName !== null && lastName[0].toLowerCase() === initial;
    })
    .map((agent) => agent.name);
}

/** Tech names marked OFF by the shared calendar's events. */
export function techsOffFromSharedCalendar(
  events: ReadonlyArray<MsGraphCalendarEvent>,
  roster: ReadonlyArray<RosterAgent>,
): ReadonlySet<string> {
  const off = new Set<string>();
  for (const event of events) {
    for (const tech of techsMatchingOffSubject(event.subject, roster)) off.add(tech);
  }
  return off;
}

// ── Locate + cache shared calendars ───────────────────────────────────
// Shared calendars live in tech mailboxes. Cache each calendar name
// independently so PTO and Saturday Support can be read side by side.

const locatedCalendars = new Map<string, {
  readonly email: string;
  readonly calendarId: string;
}>();

/** Test hook — clears the module-level location cache. */
export function resetPtoCalendarCache(): void {
  locatedCalendars.clear();
}

/**
 * Raw events from a named shared calendar for a window. Null = the
 * calendar could not be located/read (lookupFailed).
 */
export async function fetchSharedCalendarEvents(
  graph: MsGraphClient,
  roster: ReadonlyArray<RosterAgent>,
  calendarName: string,
  startIso: string,
  endIso: string,
): Promise<ReadonlyArray<MsGraphCalendarEvent> | null> {
  const cacheKey = calendarName.trim().toLowerCase();
  const locatedCalendar = locatedCalendars.get(cacheKey) ?? null;
  if (locatedCalendar) {
    const events = await graph.getCalendarViewForCalendar(
      locatedCalendar.email,
      locatedCalendar.calendarId,
      startIso,
      endIso,
    );
    if (events !== null) return events;
    console.warn(
      `[DISPATCH] Shared calendar "${calendarName}" read via ${locatedCalendar.email} failed — invalidating cache and re-probing`,
    );
    locatedCalendars.delete(cacheKey);
  }

  const emails = roster
    .map((agent) => agent.email)
    .filter((email): email is string => email !== null);
  for (const email of emails) {
    const calendarId = await graph.findCalendarIdByName(email, calendarName);
    if (calendarId === null) continue;
    const events = await graph.getCalendarViewForCalendar(email, calendarId, startIso, endIso);
    if (events === null) continue;
    locatedCalendars.set(cacheKey, { email, calendarId });
    console.log(`[DISPATCH] Shared calendar "${calendarName}" located via ${email}`);
    return events;
  }

  console.warn(`[DISPATCH] Shared calendar "${calendarName}" not found on any tech mailbox`);
  return null;
}

/**
 * Techs off today per the shared PTO calendar. Null = the calendar could
 * not be located/read (lookupFailed) — never "nobody is off".
 */
export async function fetchSharedPtoOffTechs(
  graph: MsGraphClient,
  roster: ReadonlyArray<RosterAgent>,
  calendarName: string,
  startIso: string,
  endIso: string,
): Promise<ReadonlySet<string> | null> {
  const events = await fetchSharedCalendarEvents(graph, roster, calendarName, startIso, endIso);
  return events === null ? null : techsOffFromSharedCalendar(events, roster);
}
