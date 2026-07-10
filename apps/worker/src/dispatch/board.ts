import { HELPDESK_TECHNICIANS } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { resolveTechStatus, type TechSignals, type TechStatus } from "./presence.js";
import { attachAiReads } from "./ai-read.js";
import {
  etTodayBounds,
  extensionForTech,
  fetchAppointments,
  fetchRoster,
  fetchThreeCxSnapshot,
  fetchTicketLoads,
  fmtEt,
  isTechOnCall,
  loadForTech,
  namesMatch,
  type DispatchAppointment,
  type RosterAgent,
  type ThreeCxSnapshot,
} from "./board-sources.js";

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
  readonly load: { readonly open: number; readonly wot: number; readonly breaching: number };
  readonly nextCommitment: string | null; // "Onsite — Bentley Electric 2:00 PM"
  readonly aiRead: string | null; // Haiku one-liner; null until first refresh
}

export interface DispatchBoard {
  readonly generatedAt: string;
  readonly sources: { readonly halo: boolean; readonly threecx: boolean; readonly calendar: boolean }; // false = degraded
  readonly techs: ReadonlyArray<DispatchBoardTech>;
}

const CACHE_TTL_MS = 60_000;

// Sort order: available, on_call, meeting, onsite, unknown, unreachable, off.
const STATE_ORDER: Record<TechStatus["state"], number> = {
  available: 0,
  on_call: 1,
  meeting: 2,
  onsite: 3,
  unknown: 4,
  unreachable: 5,
  off: 6,
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
  try {
    const haloConfig = await getCachedHaloConfig(supabase);
    if (haloConfig) halo = new HaloClient(haloConfig);
    else console.warn("[DISPATCH] Halo not configured — roster/appointments unavailable");
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
  const rosterAgents: ReadonlyArray<RosterAgent> =
    roster !== null && roster.length > 0
      ? roster
      : HELPDESK_TECHNICIANS.map((name) => ({ id: -1, name }));

  const withinHours = isWithinBusinessHours(now);
  const techs = rosterAgents.map((agent) =>
    buildTechRow(agent, { loads, threecx, appointments, withinHours, nowMs: now.getTime() }),
  );

  const sorted = [...techs].sort(
    (a, b) => STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] || a.tech.localeCompare(b.tech),
  );

  const board: DispatchBoard = {
    generatedAt: now.toISOString(),
    sources: {
      halo: appointments !== null,
      threecx: threecx.activeCalls !== null,
      calendar: false, // phase 2 (MS Graph)
    },
    techs: attachAiReads(sorted),
  };
  cache = { at: Date.now(), board };
  console.log(
    `[DISPATCH] Board built: ${board.techs.length} techs (halo=${board.sources.halo}, threecx=${board.sources.threecx})`,
  );
  return board;
}

interface TechRowContext {
  readonly loads: ReadonlyMap<string, { readonly open: number; readonly wot: number; readonly breaching: number }> | null;
  readonly threecx: ThreeCxSnapshot;
  readonly appointments: ReadonlyArray<DispatchAppointment> | null;
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
        ? typeof ext.IsRegistered === "boolean"
          ? ext.IsRegistered
          : null
        : false;
  const onCall =
    ctx.threecx.activeCalls === null
      ? null
      : isTechOnCall(ctx.threecx.activeCalls, ext?.Number ?? null, agent.name);

  const signals: TechSignals = {
    onPtoToday: null, // phase 2 (calendar)
    onsiteAppointment: current ? { subject: current.subject, endsAt: current.endsAt } : null,
    inMeetingUntil: null, // phase 2 (calendar)
    onCall,
    extensionRegistered,
    withinBusinessHours: ctx.withinHours,
  };

  return {
    tech: agent.name,
    status: resolveTechStatus(signals),
    load: loadForTech(ctx.loads, agent.name),
    nextCommitment: next ? `${next.subject} ${fmtEt(next.startsAt)}` : null,
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
