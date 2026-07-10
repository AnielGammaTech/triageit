import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import { fetchAppointments, type DispatchAppointment } from "./appointments.js";
import { etWallToUtcMs } from "./et-time.js";
import {
  fetchRoster,
  loadMsGraphIntegration,
  namesMatch,
  type RosterAgent,
} from "./board-sources.js";
import { fetchSharedPtoEvents, techsMatchingOffSubject } from "./pto-calendar.js";

/**
 * Week view data for the dispatch page: per tech, per ET day — Halo
 * appointments (typed Site Visit / Reminder) and PTO days from the shared
 * employee calendar. Sources degrade independently; a failed source simply
 * contributes no events (the live board's source flags cover messaging).
 */

export interface WeekEvent {
  readonly day: string; // YYYY-MM-DD (ET)
  readonly type: "site_visit" | "reminder" | "pto" | "meeting";
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
}

export interface WeekData {
  readonly start: string;
  readonly days: ReadonlyArray<string>;
  readonly techs: ReadonlyArray<{
    readonly tech: string;
    readonly events: ReadonlyArray<WeekEvent>;
  }>;
}

const CACHE_TTL_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;
const MAX_SUBJECT = 60;

let cache: { readonly key: string; readonly at: number; readonly data: WeekData } | null = null;

/** Monday of the current ET week as YYYY-MM-DD. */
function currentEtMonday(now: Date): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() - ((et.getDay() + 6) % 7));
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
      return coveredDays(a.startsAt, a.endsAt, days).map((day) => ({
        day,
        type,
        subject: a.subject.slice(0, MAX_SUBJECT),
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        allDay: false,
      }));
    });
}

export async function buildWeekData(startParam?: string | null): Promise<WeekData> {
  const now = new Date();
  const start =
    startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : currentEtMonday(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  if (cache && cache.key === start && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const startUtcMs = etWallToUtcMs(`${start}T00:00:00`);
  const startUtc = startUtcMs !== null ? new Date(startUtcMs).toISOString() : new Date().toISOString();
  const endUtc = new Date(Date.parse(startUtc) + 7 * DAY_MS).toISOString();

  const supabase = createSupabaseClient();
  let halo: HaloClient | null = null;
  try {
    const haloConfig = await getCachedHaloConfig(supabase);
    if (haloConfig) halo = new HaloClient(haloConfig);
  } catch (err) {
    console.warn("[DISPATCH] Week: Halo config lookup failed:", err instanceof Error ? err.message : err);
  }

  const [roster, appointments, msgraph] = await Promise.all([
    fetchRoster(halo),
    fetchAppointments(halo, startUtc, endUtc),
    loadMsGraphIntegration(supabase),
  ]);
  const rosterAgents = roster ?? [];

  const ptoEvents = msgraph
    ? await fetchSharedPtoEvents(msgraph.graph, rosterAgents, msgraph.ptoCalendarName, startUtc, endUtc)
    : null;

  const techs = rosterAgents.map((agent) => {
    const fromAppointments = appointments ? appointmentEvents(agent, appointments, days) : [];
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
        })),
      );
    const events = [...fromAppointments, ...fromPto].sort(
      (a, b) => a.day.localeCompare(b.day) || Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    return { tech: agent.name, events };
  });

  const data: WeekData = { start, days, techs };
  cache = { key: start, at: Date.now(), data };
  console.log(
    `[DISPATCH] Week built ${start}: ${techs.length} techs, ${techs.reduce((n, t) => n + t.events.length, 0)} events (halo=${appointments !== null}, pto=${ptoEvents !== null})`,
  );
  return data;
}
