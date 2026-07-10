import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreeCxConfig } from "@triageit/shared";
import { isHelpdeskTechnicianName } from "@triageit/shared";
import { HaloClient } from "../integrations/halo/client.js";
import {
  ThreeCxClient,
  type ThreeCxActiveCall,
  type ThreeCxUserPresence,
} from "../integrations/threecx/client.js";

/**
 * Dispatch board source fetchers. Every source is wrapped in its own try
 * and returns null on failure (lookupFailed pattern) — error ≠ empty.
 */

const GAMMA_DEFAULT_TYPE_ID = 31;

export interface RosterAgent {
  readonly id: number;
  readonly name: string;
}

export interface TechLoad {
  readonly open: number;
  readonly wot: number;
  readonly breaching: number;
}

export interface DispatchAppointment {
  readonly agentId: number | null;
  readonly agentName: string | null;
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface ThreeCxSnapshot {
  readonly activeCalls: ReadonlyArray<ThreeCxActiveCall> | null;
  readonly extensions: ReadonlyArray<ThreeCxUserPresence> | null;
}

// ── Shared helpers ────────────────────────────────────────────────────

export const fmtEt = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

/** Today's [midnight, midnight+24h) in ET, as UTC ISO strings. */
export function etTodayBounds(now: Date): { readonly start: string; readonly end: string } {
  const etWall = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = now.getTime() - etWall.getTime();
  const midnight = new Date(etWall.getFullYear(), etWall.getMonth(), etWall.getDate());
  const startMs = midnight.getTime() + offsetMs;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 3600_000).toISOString(),
  };
}

// Token-overlap name matching — same approach as sla-call's extensionFor
// (whole tokens ≥3 chars, so "Aniel" never matches inside "Danielle").
const tokensOf = (s: string): ReadonlySet<string> =>
  new Set(s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3));

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const want = tokensOf(a);
  const have = tokensOf(b);
  if (want.size === 0 || have.size === 0) return false;
  let overlap = 0;
  for (const t of want) if (have.has(t)) overlap++;
  return overlap >= Math.min(2, want.size, have.size);
}

// ── Halo roster ───────────────────────────────────────────────────────

/** Active Halo agents ∩ helpdesk technicians. Null = roster lookup failed. */
export async function fetchRoster(
  halo: HaloClient | null,
): Promise<ReadonlyArray<RosterAgent> | null> {
  if (!halo) return null;
  try {
    const agents = await halo.getAgents();
    if (agents === null) return null;
    return agents.filter((a) => isHelpdeskTechnicianName(a.name));
  } catch (err) {
    console.warn("[DISPATCH] Roster fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Ticket loads (local DB) ───────────────────────────────────────────

/**
 * Per-agent open/wot/breaching counts from open Gamma Default tickets —
 * same aggregation as the command-center payload (halo_status for WOT,
 * sla_currently_breached for breaches). Null = query failed.
 */
export async function fetchTicketLoads(
  supabase: SupabaseClient,
): Promise<ReadonlyMap<string, TechLoad> | null> {
  try {
    const { data, error } = await supabase
      .from("tickets")
      .select("halo_agent, halo_status, sla_currently_breached")
      .eq("halo_is_open", true)
      .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID);
    if (error) throw new Error(error.message);

    const loads = new Map<string, TechLoad>();
    for (const t of data ?? []) {
      const name = ((t.halo_agent as string | null) ?? "").trim();
      if (!name || name.toLowerCase() === "unassigned") continue;
      const status = ((t.halo_status as string | null) ?? "").toLowerCase();
      const cur = loads.get(name) ?? { open: 0, wot: 0, breaching: 0 };
      loads.set(name, {
        open: cur.open + 1,
        wot: cur.wot + (status.includes("waiting on tech") ? 1 : 0),
        breaching: cur.breaching + (t.sla_currently_breached ? 1 : 0),
      });
    }
    return loads;
  } catch (err) {
    console.warn("[DISPATCH] Ticket load query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Load for a roster tech: exact agent-name match first, then token match. */
export function loadForTech(
  loads: ReadonlyMap<string, TechLoad> | null,
  tech: string,
): TechLoad {
  if (!loads) return { open: 0, wot: 0, breaching: 0 };
  const exact = loads.get(tech);
  if (exact) return exact;
  for (const [name, load] of loads) {
    if (namesMatch(tech, name)) return load;
  }
  return { open: 0, wot: 0, breaching: 0 };
}

// ── 3CX (active calls + extensions) ───────────────────────────────────

export async function fetchThreeCxSnapshot(supabase: SupabaseClient): Promise<ThreeCxSnapshot> {
  try {
    const { data } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "threecx")
      .eq("is_active", true)
      .maybeSingle();
    if (!data?.config) {
      console.warn("[DISPATCH] 3CX not configured — phone signals unavailable");
      return { activeCalls: null, extensions: null };
    }
    const tcx = new ThreeCxClient(data.config as ThreeCxConfig);
    const [activeCalls, extensions] = await Promise.all([
      tcx.getActiveCalls(), // already null on failure
      tcx.listUsersPresence().catch((err: unknown) => {
        console.warn("[DISPATCH] 3CX listUsersPresence failed:", err instanceof Error ? err.message : err);
        return null;
      }),
    ]);
    return { activeCalls, extensions };
  } catch (err) {
    console.warn("[DISPATCH] 3CX snapshot failed:", err instanceof Error ? err.message : err);
    return { activeCalls: null, extensions: null };
  }
}

/** The tech's 3CX extension, matched by name (same matching as sla-call). */
export function extensionForTech(
  extensions: ReadonlyArray<ThreeCxUserPresence>,
  techName: string,
): ThreeCxUserPresence | null {
  return extensions.find((e) => namesMatch(techName, e.name)) ?? null;
}

/** Whether any active call involves the tech's extension number or name. */
export function isTechOnCall(
  activeCalls: ReadonlyArray<ThreeCxActiveCall>,
  extensionNumber: string | null,
  techName: string,
): boolean {
  const extPattern = extensionNumber
    ? new RegExp(`(?:^|\\D)${extensionNumber}(?:\\D|$)`)
    : null;
  return activeCalls.some((call) =>
    [call.Caller, call.Callee]
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .some((party) => (extPattern?.test(party) ?? false) || namesMatch(techName, party)),
  );
}

// ── Halo appointments ─────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function parseAppointment(row: Record<string, unknown>): DispatchAppointment | null {
  const startsAt = str(row.start_date) ?? str(row.startdate) ?? str(row.start);
  const endsAt = str(row.end_date) ?? str(row.enddate) ?? str(row.end);
  if (!startsAt || !endsAt) return null;

  const client = str(row.client_name) ?? str(row.site_name);
  const rawSubject = str(row.subject);
  const subject =
    rawSubject && client && !rawSubject.toLowerCase().includes(client.toLowerCase())
      ? `${client} — ${rawSubject}`
      : (rawSubject ?? client ?? "Appointment");

  return {
    agentId: num(row.agent_id),
    agentName: str(row.agent_name) ?? str(row.username) ?? str(row.user_name),
    subject,
    startsAt,
    endsAt,
  };
}

/** Today's Halo appointments. Null = lookup failed, never "no appointments". */
export async function fetchAppointments(
  halo: HaloClient | null,
  start: string,
  end: string,
): Promise<ReadonlyArray<DispatchAppointment> | null> {
  if (!halo) return null;
  try {
    const rows = await halo.getAppointments(start, end);
    if (rows === null) return null;
    return rows
      .map(parseAppointment)
      .filter((a): a is DispatchAppointment => a !== null);
  } catch (err) {
    console.warn("[DISPATCH] Appointments fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
