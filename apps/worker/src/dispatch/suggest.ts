import type { SupabaseClient } from "@supabase/supabase-js";
import { isHelpdeskTechnicianName } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import {
  deriveDispatchAction,
  type DispatchActionDecision,
  type DispatchActionLane,
} from "./action-queue.js";
import { buildDispatchBoard } from "./board.js";
import { namesMatch } from "./board-sources.js";
import {
  scoreTechForTicket,
  type Suggestion,
  type TechCandidate,
  type TicketToAssign,
} from "./scorer.js";

/**
 * Dispatch operating queue plus deterministic top-3 tech ranking for every
 * unassigned or New open Gamma Default ticket. Suggest-only: no Halo writes.
 * No LLM participates in ordering or ranking.
 */

export interface DispatchSuggestions {
  /** Halo web base URL (no trailing slash) for ticket links; "" when Halo isn't configured. */
  readonly haloBaseUrl: string;
  readonly tickets: ReadonlyArray<{
    readonly halo_id: number;
    readonly summary: string | null;
    readonly client_name: string | null;
    readonly status: string | null;
    /** How many other open tickets share this client+summary (grouped duplicates). */
    readonly duplicates: number;
    readonly suggestions: ReadonlyArray<Suggestion>; // top 3
  }>;
  /** Tickets beyond the display cap (after grouping). */
  readonly omitted: number;
  /** Prioritized operating queue; every row has one reason and one next action. */
  readonly actions: ReadonlyArray<DispatchActionDecision & {
    readonly halo_id: number;
    readonly summary: string | null;
    readonly client_name: string | null;
    readonly status: string | null;
    readonly assignedTo: string | null;
    readonly priority: number | null;
    readonly suggestions: ReadonlyArray<Suggestion>;
  }>;
  readonly actionCounts: Readonly<Record<DispatchActionLane | "total", number>>;
  readonly actionOmitted: number;
}

const GAMMA_DEFAULT_TYPE_ID = 31;
const THIRTY_DAYS_MS = 30 * 24 * 3600_000;
const TOP_N = 3;
/** Keep the helper scannable — the queue view covers the long tail. */
const MAX_TICKETS = 8;
/** Keep each client-side lane useful even when another lane has a large backlog. */
const MAX_ACTIONS_PER_LANE = 25;
/** Automated alerts are triaged, not dispatched — never suggest assignees. */
const ALERT_CLIENT_RE = /^alerts?$/i;
const ALERT_TYPE_RE = /alert|notification|monitor/i;

interface OpenTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
  readonly original_priority: number | null;
  readonly created_at: string;
  readonly last_customer_reply_at: string | null;
  readonly last_tech_action_at: string | null;
  readonly sla_currently_breached: boolean;
  readonly sla_fix_by: string | null;
  readonly sla_respond_by: string | null;
  readonly sla_on_hold: boolean;
}

const isUnassigned = (agent: string | null): boolean =>
  !agent || !agent.trim() || agent.trim().toLowerCase() === "unassigned";

const emptyActionCounts = (): Record<DispatchActionLane | "total", number> => ({
  now: 0,
  today: 0,
  watch: 0,
  total: 0,
});

export async function buildSuggestions(): Promise<DispatchSuggestions> {
  const supabase = createSupabaseClient();
  const board = await buildDispatchBoard();

  const { data, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_agent, halo_status, original_priority, created_at, last_customer_reply_at, last_tech_action_at, sla_currently_breached, sla_fix_by, sla_respond_by, sla_on_hold")
    .eq("halo_is_open", true)
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID);
  if (error) throw new Error(`Dispatch suggest tickets query failed: ${error.message}`);

  const openTickets: ReadonlyArray<OpenTicket> = (data ?? []).map((t) => ({
    id: t.id as string,
    halo_id: t.halo_id as number,
    summary: (t.summary as string | null) ?? null,
    client_name: (t.client_name as string | null) ?? null,
    halo_status: (t.halo_status as string | null) ?? null,
    halo_agent: (t.halo_agent as string | null) ?? null,
    original_priority: (t.original_priority as number | null) ?? null,
    created_at: (t.created_at as string | null) ?? new Date().toISOString(),
    last_customer_reply_at: (t.last_customer_reply_at as string | null) ?? null,
    last_tech_action_at: (t.last_tech_action_at as string | null) ?? null,
    sla_currently_breached: t.sla_currently_breached === true,
    sla_fix_by: (t.sla_fix_by as string | null) ?? null,
    sla_respond_by: (t.sla_respond_by as string | null) ?? null,
    sla_on_hold: t.sla_on_hold === true,
  }));

  const typeByTicketId = await fetchLatestTypes(supabase, openTickets.map((t) => t.id));

  // Alerts are handled by triage, not dispatch. Apply this once so the
  // assignment list and the operating queue can never disagree.
  const dispatchable = openTickets.filter((t) => {
    if (t.client_name && ALERT_CLIENT_RE.test(t.client_name.trim())) return false;
    const type = typeByTicketId.get(t.id);
    if (type && ALERT_TYPE_RE.test(type)) return false;
    return true;
  });
  const targets = dispatchable.filter(
    (t) => isUnassigned(t.halo_agent) || normalize(t.halo_status) === "new",
  );

  const clients = [...new Set(targets.map((t) => t.client_name).filter((c): c is string => !!c))];
  const [profiles, recentSimilar] = targets.length > 0
    ? await Promise.all([fetchTechProfiles(supabase), fetchRecentSimilar(supabase, clients)])
    : [[], new Map<string, number>()] as const;

  // The board carries the whole staff roster; assignment candidates remain
  // the five helpdesk technicians defined in shared workflow constants.
  const candidates = board.techs.filter((bt) => isHelpdeskTechnicianName(bt.tech));
  const suggestionsFor = (t: OpenTicket): ReadonlyArray<Suggestion> => {
    const ticket: TicketToAssign = {
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      ticketType: typeByTicketId.get(t.id) ?? null,
    };
    return candidates
      .map((bt) => {
        const profile = profiles.find((p) => namesMatch(bt.tech, p.tech_name)) ?? null;
        const candidate: TechCandidate = {
          tech: bt.tech,
          status: bt.status,
          openTickets: bt.load.open,
          breaching: bt.load.breaching,
          strongCategories: profile?.strong ?? [],
          weakCategories: profile?.weak ?? [],
          recentSimilarForClient:
            recentSimilar.get(similarKey(bt.tech, t.client_name, ticket.ticketType)) ?? 0,
        };
        return scoreTechForTicket(candidate, ticket);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
  };

  const decisions = dispatchable
    .map((t) => {
      const owner = board.techs.find((bt) => namesMatch(bt.tech, t.halo_agent)) ?? null;
      const decision = deriveDispatchAction({
        haloId: t.halo_id,
        status: t.halo_status,
        assignedTo: t.halo_agent,
        priority: t.original_priority,
        createdAt: t.created_at,
        lastCustomerReplyAt: t.last_customer_reply_at,
        lastTechActionAt: t.last_tech_action_at,
        slaCurrentlyBreached: t.sla_currently_breached,
        slaFixBy: t.sla_fix_by,
        slaRespondBy: t.sla_respond_by,
        slaOnHold: t.sla_on_hold,
        ownerState: owner?.status.state ?? null,
      });
      return decision ? { ticket: t, decision } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort(
      (a, b) =>
        b.decision.rank - a.decision.rank ||
        a.ticket.created_at.localeCompare(b.ticket.created_at),
    );

  const actionCounts = decisions.reduce(
    (counts, entry) => ({
      ...counts,
      [entry.decision.lane]: counts[entry.decision.lane] + 1,
      total: counts.total + 1,
    }),
    emptyActionCounts(),
  );
  const returnedPerLane: Record<DispatchActionLane, number> = { now: 0, today: 0, watch: 0 };
  const returnedDecisions = decisions.filter(({ decision }) => {
    if (returnedPerLane[decision.lane] >= MAX_ACTIONS_PER_LANE) return false;
    returnedPerLane[decision.lane] += 1;
    return true;
  });
  const actions = returnedDecisions.map(({ ticket: t, decision }) => ({
    ...decision,
    halo_id: t.halo_id,
    summary: t.summary,
    client_name: t.client_name,
    status: t.halo_status,
    assignedTo: t.halo_agent,
    priority: t.original_priority,
    suggestions: isUnassigned(t.halo_agent) || normalize(t.halo_status) === "new" ? suggestionsFor(t) : [],
  }));
  const actionOmitted = Math.max(0, decisions.length - returnedDecisions.length);

  // Fold duplicate assignment storms into one entry.
  const grouped = new Map<string, { ticket: OpenTicket; duplicates: number }>();
  for (const t of targets) {
    const key = `${(t.client_name ?? "").toLowerCase()}|${(t.summary ?? "").trim().toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) grouped.set(key, { ...existing, duplicates: existing.duplicates + 1 });
    else grouped.set(key, { ticket: t, duplicates: 0 });
  }
  const rankByHaloId = new Map(decisions.map((entry) => [entry.ticket.halo_id, entry.decision.rank]));
  const groupedList = [...grouped.values()].sort(
    (a, b) => (rankByHaloId.get(b.ticket.halo_id) ?? 0) - (rankByHaloId.get(a.ticket.halo_id) ?? 0),
  );
  const shown = groupedList.slice(0, MAX_TICKETS);
  const omitted = groupedList.length - shown.length;

  const tickets = shown.map(({ ticket: t, duplicates }) => {
    return {
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      status: t.halo_status,
      duplicates,
      suggestions: suggestionsFor(t),
    };
  });

  console.log(
    `[DISPATCH] Queue built: ${actions.length}/${decisions.length} actions, ${tickets.length} assignments, ${openTickets.length - dispatchable.length} alerts excluded`,
  );
  return {
    haloBaseUrl: board.haloBaseUrl,
    tickets,
    omitted,
    actions,
    actionCounts,
    actionOmitted,
  };
}

// ── Batched lookups (each degrades independently — never blocks ranking) ──

/** Latest triage classification type per ticket, one `in` query. */
async function fetchLatestTypes(
  supabase: SupabaseClient,
  ticketIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ticketIds.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("triage_results")
      .select("ticket_id, classification, created_at")
      .in("ticket_id", [...ticketIds])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = row.ticket_id as string;
      if (map.has(id)) continue; // ordered desc — first row per ticket is latest
      const cls = row.classification as { type?: unknown } | null;
      map.set(id, typeof cls?.type === "string" ? cls.type : null);
    }
  } catch (err) {
    console.warn(
      "[DISPATCH] Classification lookup failed — ranking without ticket types:",
      err instanceof Error ? err.message : err,
    );
  }
  return map;
}

interface TechProfileLite {
  readonly tech_name: string;
  readonly strong: ReadonlyArray<string>;
  readonly weak: ReadonlyArray<string>;
}

const toStringArray = (v: unknown): ReadonlyArray<string> =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Toby's tech_profiles strong/weak categories — optional skill-fit source. */
async function fetchTechProfiles(supabase: SupabaseClient): Promise<ReadonlyArray<TechProfileLite>> {
  try {
    const { data, error } = await supabase
      .from("tech_profiles")
      .select("tech_name, strong_categories, weak_categories");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((r) => typeof r.tech_name === "string" && r.tech_name)
      .map((r) => ({
        tech_name: r.tech_name as string,
        strong: toStringArray(r.strong_categories),
        weak: toStringArray(r.weak_categories),
      }));
  } catch (err) {
    console.warn(
      "[DISPATCH] tech_profiles unavailable — skill fit disabled:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

const normalize = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const similarKey = (tech: string, client: string | null, type: string | null): string =>
  `${normalize(tech)}|${normalize(client)}|${normalize(type)}`;

/**
 * Resolved tickets (30d) per tech+client+type — one grouped pass over two
 * batched queries (closed tickets for the target clients, then their latest
 * classifications), never N per-ticket queries.
 */
async function fetchRecentSimilar(
  supabase: SupabaseClient,
  clients: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  if (clients.length === 0) return counts;
  try {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const { data, error } = await supabase
      .from("tickets")
      .select("id, halo_agent, client_name")
      .eq("halo_is_open", false)
      .in("client_name", [...clients])
      .gte("updated_at", since)
      .limit(1000);
    if (error) throw new Error(error.message);

    const resolved = (data ?? []).filter(
      (t) => t.halo_agent && (t.halo_agent as string).trim().toLowerCase() !== "unassigned",
    );
    if (resolved.length === 0) return counts;

    const { data: triages, error: triageError } = await supabase
      .from("triage_results")
      .select("ticket_id, classification, created_at")
      .in("ticket_id", resolved.map((t) => t.id as string))
      .order("created_at", { ascending: false });
    if (triageError) throw new Error(triageError.message);

    const typeById = new Map<string, string>();
    for (const row of triages ?? []) {
      const id = row.ticket_id as string;
      if (typeById.has(id)) continue;
      const cls = row.classification as { type?: unknown } | null;
      if (typeof cls?.type === "string") typeById.set(id, cls.type);
    }

    for (const t of resolved) {
      const type = typeById.get(t.id as string);
      if (!type) continue;
      const key = similarKey(t.halo_agent as string, t.client_name as string | null, type);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } catch (err) {
    console.warn(
      "[DISPATCH] Recent-similar lookup failed — recency signal disabled:",
      err instanceof Error ? err.message : err,
    );
  }
  return counts;
}
