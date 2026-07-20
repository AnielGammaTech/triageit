import { createServiceClient } from "@/lib/supabase/server";
import {
  isCustomerReplyStatus,
  isHelpdeskTechnicianName,
  isWaitingOnTechStatus,
} from "@triageit/shared";

/**
 * Shared Command Center aggregation — consumed by the authenticated dashboard
 * route (/api/command-center) and the key-gated TV route (/api/tv/command).
 *
 * Aggregates open Gamma Default tickets + tech reviews into: metric tiles,
 * status breakdown, live SLA breaches (with breach duration), at-risk tickets
 * (SLA due soon), per-tech stats, wall of shame, and wall of fame.
 */

interface TicketRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly halo_status_id: number | null;
  readonly sla_currently_breached: boolean | null;
  readonly sla_breach_alert_count: number | null;
  readonly sla_fix_by: string | null;
  readonly sla_on_hold: boolean | null;
  readonly last_tech_action_at: string | null;
  readonly last_customer_reply_at: string | null;
  readonly created_at: string;
}

interface ReviewRow {
  readonly tech_name: string | null;
  readonly rating: string | null;
  readonly max_gap_hours: number | null;
  readonly created_at: string;
}

export interface CommandBreach {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly alertCount: number;
  readonly breachingForMin: number | null;
}

export interface CommandAtRisk {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly dueInMin: number;
}

export interface CommandUnassigned {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent?: string | null;
  readonly ageMin: number;
}

export interface CommandTechStat {
  readonly tech: string;
  readonly openTickets: number;
  readonly breaching: number;
  readonly waitingOnTech: number;
  readonly unackedReplies: number;
  readonly poorReviews: number;
  readonly goodReviews: number;
  readonly worstGapHours: number;
}

export interface CommandRanked {
  readonly tech: string;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}

export interface CommandScore {
  readonly tech: string;
  readonly score: number;
  readonly good: number;
  readonly poor: number;
  readonly breaching: number;
  readonly unacked: number;
}

export interface CommandCenterPayload {
  readonly generatedAt: string;
  readonly metrics: {
    readonly open: number;
    readonly breaching: number;
    readonly atRisk: number;
    readonly unassigned: number;
    readonly waitingOnTech: number;
    readonly customerReply: number;
    readonly unackedReplies: number;
    readonly openedToday: number;
    readonly resolvedToday: number;
  };
  readonly statusCounts: ReadonlyArray<{ readonly status: string; readonly count: number; readonly breaching: number }>;
  readonly breaches: ReadonlyArray<CommandBreach>;
  readonly atRisk: ReadonlyArray<CommandAtRisk>;
  readonly unassignedTickets: ReadonlyArray<CommandUnassigned>;
  readonly oldestTickets: ReadonlyArray<CommandUnassigned>;
  readonly customerReplyTickets: ReadonlyArray<CommandUnassigned>;
  readonly techStats: ReadonlyArray<CommandTechStat>;
  readonly wallOfShame: ReadonlyArray<CommandRanked>;
  readonly wallOfFame: ReadonlyArray<CommandRanked>;
  readonly scoreboard: ReadonlyArray<CommandScore>;
  readonly haloBaseUrl: string;
}

const THIRTY_MIN_MS = 30 * 60_000;
const MONTH_MS = 30 * 24 * 3600_000;
const AT_RISK_WINDOW_MS = 2 * 3600_000;
const GAMMA_DEFAULT_TYPE_ID = 31;
const HALO_RESOLVED_STATUS_ID = 9;
const HALO_UNASSIGNED_AGENT_ID = 1;
const HALO_CLOSE_COUNT_CACHE_MS = 30_000;

interface HaloIntegrationConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

let haloTokenCache: { readonly key: string; readonly token: string; readonly expiresAt: number } | null = null;
let haloCloseCountCache: { readonly day: string; readonly count: number; readonly fetchedAt: number } | null = null;

function etDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Match Halo's Waiting on Tech queue exactly; PAST-DUE is a separate status. */
export function isWaitingOnTechQueue(statusId: number | null, statusName: string | null): boolean {
  return isWaitingOnTechStatus(statusId, statusName);
}

/** Match Halo's Customer Reply queue exactly; this is separate from Waiting on Tech. */
export function isCustomerReplyQueue(statusId: number | null, statusName: string | null): boolean {
  return isCustomerReplyStatus(statusId, statusName);
}

function isInCustomerReplyQueue(ticket: TicketRow): boolean {
  // The wallboard is an operational mirror of Halo's Customer Reply queue.
  // Do not infer membership from action timestamps: production contains
  // Waiting on Customer tickets whose imported timestamps look customer-last.
  return isCustomerReplyQueue(ticket.halo_status_id, ticket.halo_status);
}

async function getHaloToken(config: HaloIntegrationConfig): Promise<string> {
  const key = `${config.base_url}|${config.client_id}|${config.tenant ?? ""}`;
  if (haloTokenCache?.key === key && haloTokenCache.expiresAt > Date.now() + 60_000) {
    return haloTokenCache.token;
  }

  const baseUrl = config.base_url.replace(/\/$/, "");
  const authInfoRes = await fetch(`${baseUrl}/api/authinfo`, { cache: "no-store" });
  const authInfo = authInfoRes.ok ? (await authInfoRes.json()) as { token_endpoint?: string } : {};
  let tokenUrl = authInfo.token_endpoint ?? `${baseUrl}/auth/token`;
  if (config.tenant) {
    tokenUrl += `${tokenUrl.includes("?") ? "&" : "?"}tenant=${encodeURIComponent(config.tenant)}`;
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: "all",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Halo auth failed (${response.status})`);
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Halo auth returned no access token");

  haloTokenCache = {
    key,
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 300) * 1000,
  };
  return payload.access_token;
}

async function fetchHaloClosedToday(config: HaloIntegrationConfig, now: Date): Promise<number | null> {
  const day = etDateKey(now);
  if (
    haloCloseCountCache?.day === day &&
    Date.now() - haloCloseCountCache.fetchedAt < HALO_CLOSE_COUNT_CACHE_MS
  ) {
    return haloCloseCountCache.count;
  }

  try {
    const token = await getHaloToken(config);
    const baseUrl = config.base_url.replace(/\/$/, "");
    const query = new URLSearchParams({
      count: "500",
      open_only: "false",
      order: "dateclosed",
      orderdesc: "true",
      includecolumns: "true",
      requesttype_id: String(GAMMA_DEFAULT_TYPE_ID),
    });
    const response = await fetch(`${baseUrl}/api/tickets?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Halo tickets failed (${response.status})`);
    const payload = (await response.json()) as {
      tickets?: ReadonlyArray<{
        readonly status_id?: number;
        readonly agent_id?: number | null;
        readonly dateclosed?: string | null;
      }>;
    };
    const count = (payload.tickets ?? []).filter(
      (ticket) =>
        ticket.status_id === HALO_RESOLVED_STATUS_ID &&
        ticket.agent_id != null &&
        ticket.agent_id !== HALO_UNASSIGNED_AGENT_ID &&
        ticket.dateclosed?.startsWith(day),
    ).length;
    haloCloseCountCache = { day, count, fetchedAt: Date.now() };
    return count;
  } catch (error) {
    console.warn("[COMMAND] Live Halo closed-today count failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Midnight Eastern Time as an ISO timestamp (UTC). */
function etMidnightIso(now: Date): string {
  const etWall = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = now.getTime() - etWall.getTime();
  const etMidnight = new Date(etWall.getFullYear(), etWall.getMonth(), etWall.getDate());
  return new Date(etMidnight.getTime() + offsetMs).toISOString();
}

export async function buildCommandCenterPayload(): Promise<CommandCenterPayload> {
  const supabase = await createServiceClient();
  const nowDate = new Date();
  const now = nowDate.getTime();
  const midnightIso = etMidnightIso(nowDate);

  let haloBaseUrl = "";
  let haloConfig: HaloIntegrationConfig | null = null;
  try {
    const { data: halo } = await supabase.from("integrations").select("config").eq("service", "halo").maybeSingle();
    haloConfig = (halo?.config as HaloIntegrationConfig | null) ?? null;
    haloBaseUrl = (haloConfig?.base_url ?? "").replace(/\/$/, "");
  } catch {
    haloBaseUrl = "";
  }

  const [ticketRes, reviewRes, openedTodayRes, resolvedTodayFallbackRes] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "halo_id, summary, client_name, halo_agent, halo_status, halo_status_id, sla_currently_breached, sla_breach_alert_count, sla_fix_by, sla_on_hold, last_tech_action_at, last_customer_reply_at, created_at",
      )
      .eq("halo_is_open", true)
      .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID),
    supabase
      .from("tech_reviews")
      .select("tech_name, rating, max_gap_hours, created_at")
      .gte("created_at", new Date(now - MONTH_MS).toISOString()),
    supabase
      .from("tickets")
      .select("halo_id", { count: "exact", head: true })
      .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
      .gte("created_at", midnightIso),
    supabase
      .from("tickets")
      .select("halo_id", { count: "exact", head: true })
      .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
      .eq("halo_is_open", false)
      .gte("updated_at", midnightIso),
  ]);

  const tickets = (ticketRes.data ?? []) as TicketRow[];
  const reviews = (reviewRes.data ?? []) as ReviewRow[];
  const haloResolvedToday = haloConfig ? await fetchHaloClosedToday(haloConfig, nowDate) : null;

  // ── Status breakdown ──
  const statusMap = new Map<string, { count: number; breaching: number }>();
  for (const t of tickets) {
    const s = t.halo_status ?? "Unknown";
    const e = statusMap.get(s) ?? { count: 0, breaching: 0 };
    e.count++;
    if (t.sla_currently_breached) e.breaching++;
    statusMap.set(s, e);
  }
  const statusCounts = [...statusMap.entries()]
    .map(([status, v]) => ({ status, ...v }))
    .sort((a, b) => b.count - a.count);

  // ── Currently breaching (worst first: most alerts, then longest breached) ──
  const breachDuration = (t: TicketRow): number | null => {
    if (!t.sla_fix_by) return null;
    const fixBy = new Date(t.sla_fix_by).getTime();
    return fixBy < now ? Math.floor((now - fixBy) / 60_000) : null;
  };
  const breaches: CommandBreach[] = tickets
    .filter((t) => t.sla_currently_breached)
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_agent: t.halo_agent,
      alertCount: t.sla_breach_alert_count ?? 0,
      breachingForMin: breachDuration(t),
    }))
    .sort((a, b) => b.alertCount - a.alertCount || (b.breachingForMin ?? 0) - (a.breachingForMin ?? 0));

  // ── At risk: SLA fix-by inside the next 2h, not yet breached, not on hold ──
  const atRisk: CommandAtRisk[] = tickets
    .filter((t) => {
      if (t.sla_currently_breached || t.sla_on_hold || !t.sla_fix_by) return false;
      const fixBy = new Date(t.sla_fix_by).getTime();
      return fixBy > now && fixBy - now <= AT_RISK_WINDOW_MS;
    })
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_agent: t.halo_agent,
      dueInMin: Math.max(1, Math.floor((new Date(t.sla_fix_by!).getTime() - now) / 60_000)),
    }))
    .sort((a, b) => a.dueInMin - b.dueInMin);

  // ── Unassigned tickets (oldest first — these should always be near zero) ──
  const isUnassigned = (t: TicketRow): boolean => !t.halo_agent || t.halo_agent.toLowerCase() === "unassigned";
  const unassignedTickets: CommandUnassigned[] = tickets
    .filter(isUnassigned)
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_status: t.halo_status,
      ageMin: Math.max(0, Math.floor((now - new Date(t.created_at).getTime()) / 60_000)),
    }))
    .sort((a, b) => b.ageMin - a.ageMin);

  // ── Oldest Waiting-on-Tech tickets — the tech owes the next move, oldest first ──
  const oldestTickets: CommandUnassigned[] = tickets
    .filter((t) => isWaitingOnTechQueue(t.halo_status_id, t.halo_status))
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_status: t.halo_status,
      halo_agent: t.halo_agent,
      ageMin: Math.max(0, Math.floor((now - new Date(t.created_at).getTime()) / 60_000)),
    }))
    .sort((a, b) => b.ageMin - a.ageMin)
    .slice(0, 12);

  // ── Customer Reply tickets — the customer spoke last, oldest reply first ──
  const customerReplyTickets: CommandUnassigned[] = tickets
    .filter(isInCustomerReplyQueue)
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_status: t.halo_status,
      halo_agent: t.halo_agent,
      ageMin: Math.max(
        0,
        Math.floor(
          (now - new Date(t.last_customer_reply_at ?? t.created_at).getTime()) / 60_000,
        ),
      ),
    }))
    .sort((a, b) => b.ageMin - a.ageMin)
    .slice(0, 12);

  // ── Per-tech stats ──
  interface TechAgg {
    tech: string;
    openTickets: number;
    breaching: number;
    waitingOnTech: number;
    unackedReplies: number;
    poorReviews: number;
    goodReviews: number;
    worstGapHours: number;
  }
  const techs = new Map<string, TechAgg>();
  const getTech = (name: string): TechAgg => {
    let t = techs.get(name);
    if (!t) {
      t = { tech: name, openTickets: 0, breaching: 0, waitingOnTech: 0, unackedReplies: 0, poorReviews: 0, goodReviews: 0, worstGapHours: 0 };
      techs.set(name, t);
    }
    return t;
  };

  for (const t of tickets) {
    const name = (t.halo_agent ?? "").trim();
    if (!name || name.toLowerCase() === "unassigned") continue;
    const agg = getTech(name);
    agg.openTickets++;
    if (t.sla_currently_breached) agg.breaching++;
    if (isWaitingOnTechQueue(t.halo_status_id, t.halo_status)) agg.waitingOnTech++;
    if (isInCustomerReplyQueue(t)) {
      const cust = t.last_customer_reply_at ? new Date(t.last_customer_reply_at).getTime() : 0;
      const tech = t.last_tech_action_at ? new Date(t.last_tech_action_at).getTime() : 0;
      if (cust > 0 && cust > tech && now - cust >= THIRTY_MIN_MS) agg.unackedReplies++;
    }
  }
  for (const r of reviews) {
    const name = (r.tech_name ?? "").trim();
    if (!name || name.toUpperCase() === "UNASSIGNED") continue;
    const rating = (r.rating ?? "").toLowerCase();
    const agg = getTech(name);
    if (rating === "poor" || rating === "needs_improvement") {
      agg.poorReviews++;
      if ((r.max_gap_hours ?? 0) > agg.worstGapHours) agg.worstGapHours = r.max_gap_hours ?? 0;
    } else if (rating === "good" || rating === "great") {
      agg.goodReviews++;
    }
  }

  const techStats = [...techs.values()].sort((a, b) => b.openTickets - a.openTickets);

  // ── Wall of Shame — ranked by what works against the team ──
  const wallOfShame: CommandRanked[] = techStats
    .map((t) => {
      const reasons: string[] = [];
      if (t.breaching > 0) reasons.push(`${t.breaching} SLA breach${t.breaching === 1 ? "" : "es"} right now`);
      if (t.unackedReplies > 0) reasons.push(`${t.unackedReplies} customer repl${t.unackedReplies === 1 ? "y" : "ies"} unacknowledged 30m+`);
      if (t.poorReviews > 0) reasons.push(`${t.poorReviews} poor review${t.poorReviews === 1 ? "" : "s"} (30d)`);
      const score = t.breaching * 3 + t.unackedReplies * 2 + t.poorReviews;
      return { tech: t.tech, score, reasons };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  // ── Wall of Fame — positive counterpart: clean board + good reviews ──
  const wallOfFame: CommandRanked[] = techStats
    .map((t) => {
      const clean = t.breaching === 0 && t.unackedReplies === 0;
      const reasons: string[] = [];
      if (t.goodReviews > 0) reasons.push(`${t.goodReviews} good review${t.goodReviews === 1 ? "" : "s"} (30d)`);
      if (clean && t.openTickets > 0) reasons.push(`clean board — ${t.openTickets} open, zero breaches`);
      const score = t.goodReviews * 2 + (clean && t.openTickets > 0 ? 3 : 0) - t.poorReviews * 2;
      return { tech: t.tech, score, reasons };
    })
    .filter((t) => t.score > 0 && t.reasons.length > 0)
    .sort((a, b) => b.score - a.score);

  // ── Tech scoreboard — ONE ranked list (replaces shame/fame confusion):
  // real helpdesk techs only, net score = credits minus live problems.
  const scoreboard: CommandScore[] = techStats
    .filter((t) => isHelpdeskTechnicianName(t.tech))
    .map((t) => ({
      tech: t.tech,
      score: t.goodReviews * 2 - t.poorReviews * 2 - t.breaching * 3 - t.unackedReplies * 2,
      good: t.goodReviews,
      poor: t.poorReviews,
      breaching: t.breaching,
      unacked: t.unackedReplies,
    }))
    .sort((a, b) => b.score - a.score);

  const metrics = {
    open: tickets.length,
    breaching: breaches.length,
    atRisk: atRisk.length,
    unassigned: unassignedTickets.length,
    waitingOnTech: tickets.filter((t) => isWaitingOnTechQueue(t.halo_status_id, t.halo_status)).length,
    customerReply: tickets.filter(isInCustomerReplyQueue).length,
    unackedReplies: techStats.reduce((s, t) => s + t.unackedReplies, 0),
    openedToday: openedTodayRes.count ?? 0,
    resolvedToday: haloResolvedToday ?? resolvedTodayFallbackRes.count ?? 0,
  };

  return {
    generatedAt: nowDate.toISOString(),
    metrics,
    statusCounts,
    breaches,
    atRisk,
    unassignedTickets,
    oldestTickets,
    customerReplyTickets,
    techStats,
    wallOfShame,
    wallOfFame,
    scoreboard,
    haloBaseUrl,
  };
}
