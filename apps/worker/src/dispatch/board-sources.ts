import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreeCxConfig } from "@triageit/shared";
import { HaloClient } from "../integrations/halo/client.js";
import { MsGraphClient, type MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import {
  ThreeCxClient,
  type ThreeCxActiveCall,
  type ThreeCxUserPresence,
} from "../integrations/threecx/client.js";
import { DEFAULT_PTO_CALENDAR_NAME, fetchSharedPtoOffTechs } from "./pto-calendar.js";

/**
 * Dispatch board source fetchers. Every source is wrapped in its own try
 * and returns null on failure (lookupFailed pattern) — error ≠ empty.
 *
 * (Halo appointment parsing lives in appointments.ts; ET time helpers in
 * et-time.ts.)
 */

export interface RosterAgent {
  readonly id: number;
  readonly name: string;
  readonly email: string | null;
}

/** Working = In Progress AND the tech acted on it within this window. */
export const WORKING_RECENCY_MS = 60 * 60_000;

export interface TechLoad {
  readonly open: number;
  readonly wot: number;
  readonly customerReply: number;
  readonly breaching: number;
  /** The In Progress ticket the tech most recently touched (within the
   *  recency window) — stale In Progress tickets never count. */
  readonly inProgressTicket: {
    readonly haloId: number;
    readonly summary: string | null;
    readonly touchedMs: number;
  } | null;
}

export interface ThreeCxSnapshot {
  readonly activeCalls: ReadonlyArray<ThreeCxActiveCall> | null;
  readonly extensions: ReadonlyArray<ThreeCxUserPresence> | null;
}

const HALO_CUSTOMER_REPLY_STATUS_ID = 30;
const HALO_PAST_DUE_STATUS_ID = 31;
const HALO_WAITING_ON_TECH_STATUS_ID = 32;

export function isCustomerReplyStatus(statusId: number | null, statusName: string | null): boolean {
  return statusId === HALO_CUSTOMER_REPLY_STATUS_ID || /customer reply/i.test(statusName ?? "");
}

export function isWaitingOnTechStatus(statusId: number | null, statusName: string | null): boolean {
  return statusId === HALO_WAITING_ON_TECH_STATUS_ID
    || statusId === HALO_PAST_DUE_STATUS_ID
    || /waiting on tech|past[ -]?due/i.test(statusName ?? "");
}

// ── Shared helpers ────────────────────────────────────────────────────
// (Time formatting lives in time-format.ts — fmtEt / fmtEtDayAware.)

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

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

// System/placeholder Halo agents that must never appear on the board.
const SYSTEM_AGENT_TOKENS: ReadonlySet<string> = new Set([
  "unassigned",
  "triageit",
  "api",
  "support",
  "help",
]);

// Real people the owner doesn't want on the dispatch board (user decision
// 2026-07-13: hide Bradd).
const HIDDEN_FROM_DISPATCH: ReadonlyArray<string> = ["bradd konert"];

function isSystemAgentName(name: string): boolean {
  const lower = name.toLowerCase();
  if (HIDDEN_FROM_DISPATCH.some((hidden) => namesMatch(lower, hidden))) return true;
  return lower
    .split(/[^a-z0-9]+/)
    .some((token) => SYSTEM_AGENT_TOKENS.has(token));
}

/**
 * Dispatch roster: EVERY active Halo agent that looks like a real person —
 * has an email (real staff are first-name@gamma.tech) and isn't a
 * system/placeholder account. The whole team appears on the board, not
 * just the helpdesk techs (user decision 2026-07-10); the assignment
 * helper separately narrows candidates to techs. Null = lookup failed.
 */
export async function fetchRoster(
  halo: HaloClient | null,
): Promise<ReadonlyArray<RosterAgent> | null> {
  if (!halo) return null;
  try {
    const agents = await halo.getAgents();
    if (agents === null) return null;
    return agents.filter((a) => a.email !== null && !isSystemAgentName(a.name));
  } catch (err) {
    console.warn("[DISPATCH] Roster fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Ticket loads (local DB) ───────────────────────────────────────────

/**
 * Per-agent open/wot/breaching counts from ALL open tickets — every ticket
 * type, matching Halo's own per-agent sidebar counts (user report
 * 2026-07-10: the board said 16 open while Halo showed 18 because Alerts
 * were filtered out). Aggregation matches the command-center payload
 * (halo_status for WOT, sla_currently_breached for breaches). Null = query
 * failed.
 */
export async function fetchTicketLoads(
  supabase: SupabaseClient,
): Promise<ReadonlyMap<string, TechLoad> | null> {
  try {
    const { data, error } = await supabase
      .from("tickets")
      .select("halo_id, summary, halo_agent, halo_status_id, halo_status, sla_currently_breached, last_tech_action_at")
      .eq("halo_is_open", true);
    if (error) throw new Error(error.message);

    const loads = new Map<string, TechLoad>();
    for (const t of data ?? []) {
      const name = ((t.halo_agent as string | null) ?? "").trim();
      if (!name || name.toLowerCase() === "unassigned") continue;
      const statusName = (t.halo_status as string | null) ?? null;
      const statusId = (t.halo_status_id as number | null) ?? null;
      const status = (statusName ?? "").toLowerCase();
      const cur = loads.get(name) ?? EMPTY_LOAD;
      // "In Progress" = the tech is actively working that ticket right now
      // (user decision 2026-07-10) — surfaces as the "working" presence state.
      // "In Progress" alone is unreliable — techs park tickets there for
      // days (user report 2026-07-13). Working = In Progress AND the tech
      // touched it recently; among several, keep the most recently touched.
      const touchedMs = t.last_tech_action_at ? Date.parse(t.last_tech_action_at as string) : NaN;
      const activeNow =
        status === "in progress" &&
        typeof t.halo_id === "number" &&
        Number.isFinite(touchedMs) &&
        Date.now() - touchedMs <= WORKING_RECENCY_MS;
      const inProgressTicket =
        activeNow && (!cur.inProgressTicket || touchedMs > cur.inProgressTicket.touchedMs)
          ? {
              haloId: t.halo_id as number,
              summary: ((t.summary as string | null) ?? "").slice(0, 80) || null,
              touchedMs,
            }
          : cur.inProgressTicket;
      loads.set(name, {
        open: cur.open + 1,
        wot: cur.wot + (isWaitingOnTechStatus(statusId, statusName) ? 1 : 0),
        customerReply: cur.customerReply + (isCustomerReplyStatus(statusId, statusName) ? 1 : 0),
        breaching: cur.breaching + (t.sla_currently_breached ? 1 : 0),
        inProgressTicket,
      });
    }
    return loads;
  } catch (err) {
    console.warn("[DISPATCH] Ticket load query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

const EMPTY_LOAD: TechLoad = { open: 0, wot: 0, customerReply: 0, breaching: 0, inProgressTicket: null };

/** Load for a roster tech: exact agent-name match first, then token match. */
export function loadForTech(
  loads: ReadonlyMap<string, TechLoad> | null,
  tech: string,
): TechLoad {
  if (!loads) return EMPTY_LOAD;
  const exact = loads.get(tech);
  if (exact) return exact;
  for (const [name, load] of loads) {
    if (namesMatch(tech, name)) return load;
  }
  return EMPTY_LOAD;
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

// ── Outlook calendars (MS Graph) ──────────────────────────────────────

export interface MsGraphIntegration {
  readonly graph: MsGraphClient;
  /** Name of the shared employee PTO calendar (config `pto_calendar_name`). */
  readonly ptoCalendarName: string;
}

/**
 * Active msgraph integration → configured Graph client. Null = not
 * connected or the config row is incomplete.
 */
export async function loadMsGraphIntegration(
  supabase: SupabaseClient,
): Promise<MsGraphIntegration | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "msgraph")
    .eq("is_active", true)
    .maybeSingle();
  const config = (data?.config ?? null) as Record<string, unknown> | null;
  const tenantId = str(config?.tenant_id);
  const clientId = str(config?.client_id);
  const clientSecret = str(config?.client_secret);
  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    graph: new MsGraphClient({
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    ptoCalendarName: str(config?.pto_calendar_name) ?? DEFAULT_PTO_CALENDAR_NAME,
  };
}

export interface CalendarTechSignal {
  readonly onPtoToday: boolean;
  readonly inMeetingUntil: string | null; // UTC ISO end of the current busy block
}

export interface CalendarSignals {
  readonly ok: boolean; // at least one calendar read succeeded
  /** Keyed by roster tech name. A missing tech = their read failed or they
   *  have no email — unknown, never "free". */
  readonly byTech: ReadonlyMap<string, CalendarTechSignal>;
}

const BUSY_SHOW_AS: ReadonlySet<string> = new Set(["busy", "tentative"]);

/**
 * PTO/meeting signals from one tech's PERSONAL calendarView events.
 * An all-day event only counts as PTO when it shows as oof/busy — all-day
 * "free" events (birthdays, company holidays) must NOT mark a tech off.
 * A non-all-day oof block still counts.
 */
export function calendarSignalFromEvents(
  events: ReadonlyArray<MsGraphCalendarEvent>,
  nowMs: number,
): CalendarTechSignal {
  const onPtoToday = events.some((e) =>
    e.isAllDay ? e.showAs === "oof" || e.showAs === "busy" : e.showAs === "oof",
  );
  const currentBusy = events
    .filter((e) => !e.isAllDay && BUSY_SHOW_AS.has(e.showAs))
    .filter((e) => Date.parse(e.startsAt) <= nowMs && Date.parse(e.endsAt) > nowMs)
    .reduce<MsGraphCalendarEvent | null>(
      (latest, e) => (!latest || Date.parse(e.endsAt) > Date.parse(latest.endsAt) ? e : latest),
      null,
    );
  return { onPtoToday, inMeetingUntil: currentBusy?.endsAt ?? null };
}

/**
 * Per-tech PTO/meeting signals from Outlook via MS Graph: each tech's
 * personal calendar plus the shared employee PTO calendar (subjects like
 * "Ryan OFF" — a match OVERRIDES the personal-calendar signal). Null =
 * calendar not connected or the lookup blew up entirely. Each tech's read
 * degrades independently — a failed mailbox is simply absent from the map
 * (unknown, never free).
 */
export async function fetchCalendarSignals(
  supabase: SupabaseClient,
  roster: ReadonlyArray<RosterAgent>,
  startIso: string,
  endIso: string,
): Promise<CalendarSignals | null> {
  try {
    const integration = await loadMsGraphIntegration(supabase);
    if (!integration) {
      console.warn("[DISPATCH] Microsoft 365 calendar not connected — PTO/meeting signals unavailable");
      return null;
    }
    const { graph, ptoCalendarName } = integration;

    const withEmail = roster.filter((a): a is RosterAgent & { email: string } => a.email !== null);
    if (withEmail.length === 0) {
      console.warn("[DISPATCH] No tech emails on the roster — calendar signals unavailable");
      return { ok: false, byTech: new Map() };
    }

    const nowMs = Date.now();
    const [sharedOff, results] = await Promise.all([
      // Null = shared calendar not located/read — personal signals still apply.
      fetchSharedPtoOffTechs(graph, roster, ptoCalendarName, startIso, endIso),
      Promise.all(
        withEmail.map(async (a) => ({
          tech: a.name,
          events: await graph.getCalendarView(a.email, startIso, endIso), // null = that tech's read failed
        })),
      ),
    ]);

    const byTech = new Map<string, CalendarTechSignal>();
    for (const r of results) {
      if (r.events !== null) {
        const signal = calendarSignalFromEvents(r.events, nowMs);
        byTech.set(
          r.tech,
          sharedOff?.has(r.tech) ? { ...signal, onPtoToday: true } : signal,
        );
      }
    }
    // Shared-calendar matches stand alone: a tech whose personal read failed
    // (or who has no readable mailbox) is still off when the PTO calendar
    // says so.
    for (const tech of sharedOff ?? []) {
      if (!byTech.has(tech)) byTech.set(tech, { onPtoToday: true, inMeetingUntil: null });
    }

    if (byTech.size === 0 && sharedOff === null) {
      console.warn("[DISPATCH] All Graph calendar reads failed — calendar source degraded");
    }
    return { ok: byTech.size > 0 || sharedOff !== null, byTech };
  } catch (err) {
    console.warn("[DISPATCH] Calendar signals failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
