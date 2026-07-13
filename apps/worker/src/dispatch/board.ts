import { DISPATCHER, HELPDESK_TECHNICIANS } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
/**
 * Dispatch uses the FULL workday (7:00-18:00 ET Mon-Fri, per CLAUDE.md) —
 * NOT the teams-alert window (8:00-17:15), which is deliberately narrow so
 * alerts/calls don't fire at the edges of the day. A registered tech at
 * 5:30 PM is still assignable.
 */
function isDispatchBusinessHours(now: Date): boolean {
  const hour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const day = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
  return hour >= 7 && hour < 18 && !["Sat", "Sun"].includes(day);
}
import { resolveTechStatus, type TechSignals, type TechStatus } from "./presence.js";
import { attachAiReads } from "./ai-read.js";
import {
  extensionForTech,
  fetchCalendarSignals,
  fetchRoster,
  fetchThreeCxSnapshot,
  fetchTicketLoads,
  isTechOnCall,
  loadForTech,
  namesMatch,
  type CalendarSignals,
  type RosterAgent,
  type TechLoad,
  type ThreeCxSnapshot,
} from "./board-sources.js";
import {
  currentCommitmentLabel,
  effectiveOnsiteEnd,
  fetchAppointments,
  nextCommitmentLabel,
  type DispatchAppointment,
} from "./appointments.js";
import { etTodayBounds } from "./et-time.js";

/**
 * Dispatch board assembler — live "Right Now" tech availability from
 * Halo (roster + appointments), 3CX (active calls + extensions), and the
 * local tickets table. 60s in-memory cache; every source degrades
 * independently to null (sources flags reflect it) — never a blank board
 * and never fabricated availability.
 */

export interface DispatchBoardTech {
  readonly tech: string;
  readonly status: TechStatus;
  /** Raw 3CX view for the row: profile (Available/Away/DND/...), registration, live call. */
  readonly phone: {
    readonly profile: string | null;
    readonly registered: boolean | null;
    readonly onCall: boolean;
  } | null;
  readonly load: { readonly open: number; readonly wot: number; readonly breaching: number };
  /** Halo id of the tech's In Progress ticket — lets the UI link the status detail. */
  readonly workingTicketId: number | null;
  /** Halo ticket represented by the active onsite/working status. */
  readonly statusTicketId: number | null;
  readonly nextCommitment: string | null; // "Onsite — Bentley Electric 2:00 PM"
  readonly aiRead: string | null; // Haiku one-liner; null until first refresh
}

export interface DispatchBoard {
  readonly generatedAt: string;
  readonly sources: { readonly halo: boolean; readonly threecx: boolean; readonly calendar: boolean }; // false = degraded
  /** Halo web base URL (no trailing slash) for ticket links; "" when Halo isn't configured. */
  readonly haloBaseUrl: string;
  readonly techs: ReadonlyArray<DispatchBoardTech>;
}

const CACHE_TTL_MS = 60_000;

// Sort order: free-est first, off last.
const STATE_ORDER: Record<TechStatus["state"], number> = {
  available: 0,
  working: 1,
  on_call: 2,
  meeting: 3,
  onsite: 4,
  dnd: 5,
  away: 6,
  after_hours: 7,
  unknown: 8,
  unreachable: 9,
  off: 10,
};

let cache: { readonly at: number; readonly board: DispatchBoard } | null = null;

export async function buildDispatchBoard(): Promise<DispatchBoard> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    // Same snapshot, but aiRead lines may have landed since it was built —
    // re-attach from the read cache (new objects, nothing mutated).
    return { ...cache.board, techs: attachAiReads(cache.board.techs) };
  }

  const supabase = createSupabaseClient();

  let halo: HaloClient | null = null;
  let haloBaseUrl = "";
  try {
    const haloConfig = await getCachedHaloConfig(supabase);
    if (haloConfig) {
      halo = new HaloClient(haloConfig);
      haloBaseUrl = (haloConfig.base_url ?? "").replace(/\/$/, "");
    } else console.warn("[DISPATCH] Halo not configured — roster/appointments unavailable");
  } catch (err) {
    console.warn("[DISPATCH] Halo config lookup failed:", err instanceof Error ? err.message : err);
  }

  const now = new Date();
  const { start, end } = etTodayBounds(now);

  const [roster, loads, threecx, appointments] = await Promise.all([
    fetchRoster(halo),
    fetchTicketLoads(supabase),
    fetchThreeCxSnapshot(supabase),
    fetchAppointments(halo, start, end),
  ]);

  if (roster === null) {
    console.warn("[DISPATCH] Halo roster unavailable — using static helpdesk roster");
  }
  const resolvedRoster: ReadonlyArray<RosterAgent> =
    roster !== null && roster.length > 0
      ? roster
      : HELPDESK_TECHNICIANS.map((name) => ({ id: -1, name, email: null }));
  // The dispatcher coordinates the board but is not a technician presence
  // or assignment candidate.
  const rosterAgents = resolvedRoster.filter((agent) => !namesMatch(agent.name, DISPATCHER));

  // Needs the resolved roster (tech emails), so it runs after the first batch.
  const calendar = await fetchCalendarSignals(supabase, rosterAgents, start, end);

  const withinHours = isDispatchBusinessHours(now);
  const techs = rosterAgents.map((agent) =>
    buildTechRow(agent, { loads, threecx, appointments, calendar, withinHours, nowMs: now.getTime() }),
  );

  const sorted = [...techs].sort(
    (a, b) => STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] || a.tech.localeCompare(b.tech),
  );

  const board: DispatchBoard = {
    generatedAt: now.toISOString(),
    sources: {
      halo: appointments !== null,
      threecx: threecx.activeCalls !== null,
      calendar: calendar?.ok ?? false, // false = not connected or all reads failed
    },
    haloBaseUrl,
    techs: attachAiReads(sorted),
  };
  cache = { at: Date.now(), board };
  console.log(
    `[DISPATCH] Board built: ${board.techs.length} techs (halo=${board.sources.halo}, threecx=${board.sources.threecx}, calendar=${board.sources.calendar})`,
  );
  return board;
}

interface TechRowContext {
  readonly loads: ReadonlyMap<string, TechLoad> | null;
  readonly threecx: ThreeCxSnapshot;
  readonly appointments: ReadonlyArray<DispatchAppointment> | null;
  readonly calendar: CalendarSignals | null;
  readonly withinHours: boolean;
  readonly nowMs: number;
}

function buildTechRow(agent: RosterAgent, ctx: TechRowContext): Omit<DispatchBoardTech, "aiRead"> {
  const mine = appointmentsForAgent(agent, ctx.appointments);
  const current =
    mine?.find((a) => Date.parse(a.startsAt) <= ctx.nowMs && Date.parse(a.endsAt) > ctx.nowMs) ?? null;
  const next =
    mine
      ?.filter((a) => Date.parse(a.startsAt) > ctx.nowMs)
      .reduce<DispatchAppointment | null>(
        (earliest, a) => (!earliest || Date.parse(a.startsAt) < Date.parse(earliest.startsAt) ? a : earliest),
        null,
      ) ?? null;

  const ext = ctx.threecx.extensions ? extensionForTech(ctx.threecx.extensions, agent.name) : null;
  const extensionRegistered =
    ctx.threecx.extensions === null
      ? null // 3CX unavailable — unknown, never "unreachable"
      : ext
        ? ext.isRegistered
        : false;
  const onCall =
    ctx.threecx.activeCalls === null
      ? null
      : isTechOnCall(ctx.threecx.activeCalls, ext?.number ?? null, agent.name);

  // Missing from the map = that tech's calendar read failed or they have no
  // email — unknown (null), never "not on PTO / not in a meeting".
  const cal = ctx.calendar?.byTech.get(agent.name) ?? null;

  // Malformed long Site Visits are normalized to their same-day wall-clock
  // end time, so a bad end date cannot hide a real onsite window for weeks.
  const onsiteNow =
    mine
      ?.map((appointment) => ({ appointment, endsAt: effectiveOnsiteEnd(appointment) }))
      .find(
        ({ appointment, endsAt }) =>
          endsAt !== null && Date.parse(appointment.startsAt) <= ctx.nowMs && Date.parse(endsAt) > ctx.nowMs,
      ) ?? null;

  const load = loadForTech(ctx.loads, agent.name);
  const signals: TechSignals = {
    onPtoToday: cal ? cal.onPtoToday : null,
    onsiteAppointment: onsiteNow
      ? { subject: onsiteNow.appointment.subject, endsAt: onsiteNow.endsAt!, ticketId: onsiteNow.appointment.ticketId }
      : null,
    inMeetingUntil: cal?.inMeetingUntil ?? null,
    onCall,
    workingTicket: load.inProgressTicket,
    phoneProfile: ext?.profileName ?? null,
    extensionRegistered,
    withinBusinessHours: ctx.withinHours,
  };

  return {
    tech: agent.name,
    status: resolveTechStatus(signals),
    phone:
      ctx.threecx.extensions === null && ctx.threecx.activeCalls === null
        ? null
        : {
            profile: ext?.profileName ?? null,
            registered: extensionRegistered,
            onCall: onCall === true,
          },
    load: { open: load.open, wot: load.wot, breaching: load.breaching },
    workingTicketId: load.inProgressTicket?.haloId ?? null,
    statusTicketId: onsiteNow?.appointment.ticketId ?? load.inProgressTicket?.haloId ?? null,
    // Labeled with the appointment type, e.g. "Site Visit: Jenn :: Laptop
    // Setup — Mon 1:00 PM". A current reminder or untyped appointment
    // surfaces here as context when nothing later is scheduled.
    nextCommitment: next
      ? nextCommitmentLabel(next, new Date(ctx.nowMs))
      : current && !onsiteNow && effectiveOnsiteEnd(current) === null
        ? currentCommitmentLabel(current, new Date(ctx.nowMs))
        : null,
  };
}

function appointmentsForAgent(
  agent: RosterAgent,
  appointments: ReadonlyArray<DispatchAppointment> | null,
): ReadonlyArray<DispatchAppointment> | null {
  if (appointments === null) return null;
  return appointments.filter(
    (a) => (agent.id > 0 && a.agentId === agent.id) || namesMatch(agent.name, a.agentName),
  );
}
