import type { SupabaseClient } from "@supabase/supabase-js";
import { isHelpdeskTechnicianName } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { buildDispatchBoard } from "./board.js";
import { namesMatch } from "./board-sources.js";
import {
  scoreTechForTicket,
  type Suggestion,
  type TechCandidate,
  type TicketToAssign,
} from "./scorer.js";

/**
 * Dispatch assignment helper — deterministic top-3 tech ranking for every
 * unassigned or New open Gamma Default ticket. Suggest-only: no Halo
 * assignment write-back anywhere. No LLM in the ranking.
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
}

const GAMMA_DEFAULT_TYPE_ID = 31;
const THIRTY_DAYS_MS = 30 * 24 * 3600_000;
const TOP_N = 3;
/** Keep the helper scannable — the queue view covers the long tail. */
const MAX_TICKETS = 8;
/** Automated alerts are triaged, not dispatched — never suggest assignees. */
const ALERT_CLIENT_RE = /^alerts?$/i;
const ALERT_TYPE_RE = /alert|notification|monitor/i;

interface TargetTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
}

export async function buildSuggestions(): Promise<DispatchSuggestions> {
  const supabase = createSupabaseClient();
  const board = await buildDispatchBoard();

  const { data, error } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_agent, halo_status")
    .eq("halo_is_open", true)
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID);
  if (error) throw new Error(`Dispatch suggest tickets query failed: ${error.message}`);

  const isUnassigned = (agent: string | null): boolean =>
    !agent || !agent.trim() || agent.trim().toLowerCase() === "unassigned";
  const targets: ReadonlyArray<TargetTicket> = (data ?? [])
    .filter(
      (t) =>
        isUnassigned(t.halo_agent as string | null) ||
        ((t.halo_status as string | null) ?? "").trim().toLowerCase() === "new",
    )
    .map((t) => ({
      id: t.id as string,
      halo_id: t.halo_id as number,
      summary: (t.summary as string | null) ?? null,
      client_name: (t.client_name as string | null) ?? null,
      halo_status: (t.halo_status as string | null) ?? null,
    }));
  if (targets.length === 0) return { haloBaseUrl: board.haloBaseUrl, tickets: [], omitted: 0 };

  const [typeByTicketId, profiles] = await Promise.all([
    fetchLatestTypes(supabase, targets.map((t) => t.id)),
    fetchTechProfiles(supabase),
  ]);

  // Alerts are handled by the triage pipeline, not the dispatcher — drop
  // anything classified as an alert or filed under the Alerts client, and
  // fold duplicate storms (same client + summary) into one entry.
  const dispatchable = targets.filter((t) => {
    if (t.client_name && ALERT_CLIENT_RE.test(t.client_name.trim())) return false;
    const type = typeByTicketId.get(t.id);
    if (type && ALERT_TYPE_RE.test(type)) return false;
    return true;
  });
  const grouped = new Map<string, { ticket: TargetTicket; duplicates: number }>();
  for (const t of dispatchable) {
    const key = `${(t.client_name ?? "").toLowerCase()}|${(t.summary ?? "").trim().toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) grouped.set(key, { ...existing, duplicates: existing.duplicates + 1 });
    else grouped.set(key, { ticket: t, duplicates: 0 });
  }
  const groupedList = [...grouped.values()];
  const shown = groupedList.slice(0, MAX_TICKETS);
  const omitted = groupedList.length - shown.length;
  if (groupedList.length === 0) return { haloBaseUrl: board.haloBaseUrl, tickets: [], omitted: 0 };
  const clients = [...new Set(targets.map((t) => t.client_name).filter((c): c is string => !!c))];
  const recentSimilar = await fetchRecentSimilar(supabase, clients);

  // The board now carries the WHOLE team (owner, sales, PM included) —
  // assignment candidates stay techs-only.
  const candidates = board.techs.filter((bt) => isHelpdeskTechnicianName(bt.tech));

  const tickets = shown.map(({ ticket: t, duplicates }) => {
    const ticket: TicketToAssign = {
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      ticketType: typeByTicketId.get(t.id) ?? null,
    };
    const suggestions = candidates
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
    return {
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      status: t.halo_status,
      duplicates,
      suggestions,
    };
  });

  console.log(
    `[DISPATCH] Suggestions built: ${tickets.length} shown, ${omitted} omitted, ${targets.length - dispatchable.length} alert tickets excluded`,
  );
  return { haloBaseUrl: board.haloBaseUrl, tickets, omitted };
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
