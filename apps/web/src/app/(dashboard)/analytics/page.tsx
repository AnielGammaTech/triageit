import { createClient } from "@/lib/supabase/server";
import { PerformanceDashboard } from "./performance-dashboard";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_team: string | null;
  readonly halo_status: string | null;
  readonly halo_is_open: boolean | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_retriage_at: string | null;
  readonly last_customer_reply_at: string | null;
  readonly last_tech_action_at: string | null;
}

interface TriageRow {
  readonly id: string;
  readonly ticket_id: string;
  readonly urgency_score: number;
  readonly recommended_priority: number;
  readonly triage_type: string | null;
  readonly classification: { readonly type?: string; readonly subtype?: string } | null;
  readonly internal_notes: string | null;
  readonly processing_time_ms: number | null;
  readonly created_at: string;
}

const RESOLVED_STATUSES = [
  "closed", "resolved", "cancelled", "completed",
  "resolved remotely", "resolved onsite", "resolved - awaiting confirmation",
];

// halo_is_open is the source of truth (maintained by ticket-sync and used by
// the tickets page tabs) — status-name matching is only a fallback for legacy
// rows where it was never set. This keeps analytics counts consistent with
// the tabs the stat cards link to.
function isResolved(t: { halo_is_open: boolean | null; halo_status: string | null }): boolean {
  if (t.halo_is_open === false) return true;
  if (t.halo_is_open === true) return false;
  if (!t.halo_status) return false;
  return RESOLVED_STATUSES.includes(t.halo_status.toLowerCase());
}

function hoursBetween(d1: string, d2: string): number {
  return (new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60);
}

export interface TechMetrics {
  readonly name: string;
  readonly totalTickets: number;
  readonly openTickets: number;
  readonly resolvedTickets: number;
  readonly needsReviewTickets: number;
  readonly avgResponseHours: number | null;
  readonly avgCustomerWaitHours: number | null;
  readonly staleTickets: number;
  readonly criticalTickets: number;
  readonly oldestOpenDays: number | null;
  readonly ticketsLastWeek: number;
  readonly ticketsLastMonth: number;
}

export interface TeamOverview {
  readonly totalOpen: number;
  readonly totalResolved: number;
  readonly totalNeedsReview: number;
  readonly totalStale: number;
  readonly avgResponseHours: number | null;
  readonly avgCustomerWaitHours: number | null;
  readonly unassignedTickets: number;
  readonly ticketsTriagedToday: number;
  readonly ticketsTriagedThisWeek: number;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  // Supabase caps every request at 1000 rows — .limit(2000) was silently
  // truncated, so all metrics were computed from the newest 1000 rows and the
  // oldest (most overdue) tickets fell off first. Page in batches instead.
  const BATCH = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllRows<T>(applyFilters: () => any, maxRows: number): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; from < maxRows; from += BATCH) {
      const { data } = await applyFilters()
        .order("created_at", { ascending: false })
        .range(from, from + BATCH - 1);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < BATCH) break;
    }
    return rows;
  }

  const ticketFields =
    "id, halo_id, summary, client_name, halo_agent, halo_team, halo_status, halo_is_open, status, created_at, updated_at, last_retriage_at, last_customer_reply_at, last_tech_action_at";
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Gamma Default only (type 31) to match the tickets page tabs: all open
  // tickets regardless of age + everything from the last 90 days
  const [openRows, recentRows, triageRows] = await Promise.all([
    fetchAllRows<TicketRow>(
      () => supabase.from("tickets").select(ticketFields).eq("tickettype_id", 31).eq("halo_is_open", true),
      10_000,
    ),
    fetchAllRows<TicketRow>(
      () => supabase.from("tickets").select(ticketFields).eq("tickettype_id", 31).gte("created_at", ninetyDaysAgo),
      25_000,
    ),
    fetchAllRows<TriageRow>(
      () =>
        supabase
          .from("triage_results")
          .select("id, ticket_id, urgency_score, recommended_priority, triage_type, classification, internal_notes, processing_time_ms, created_at")
          .gte("created_at", ninetyDaysAgo),
      25_000,
    ),
  ]);

  const byId = new Map<string, TicketRow>();
  for (const t of [...openRows, ...recentRows]) byId.set(t.id, t);
  const allTickets: ReadonlyArray<TicketRow> = [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const allTriage: ReadonlyArray<TriageRow> = triageRows;

  const now = new Date().toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  // Group tickets by tech
  const techMap = new Map<string, TicketRow[]>();
  for (const t of allTickets) {
    const agent = t.halo_agent ?? "Unassigned";
    const existing = techMap.get(agent) ?? [];
    techMap.set(agent, [...existing, t]);
  }

  // Build per-tech metrics
  const techMetrics: TechMetrics[] = [];
  for (const [name, techTickets] of techMap) {
    if (name === "Unassigned") continue;

    const open = techTickets.filter((t) => !isResolved(t));
    const resolved = techTickets.filter((t) => isResolved(t));
    const needsReview = techTickets.filter((t) => t.status === "needs_review");

    // Avg response time: time from ticket creation to first tech action
    const responseTimes: number[] = [];
    for (const t of techTickets) {
      if (t.last_tech_action_at) {
        const hours = hoursBetween(t.created_at, t.last_tech_action_at);
        if (hours >= 0 && hours < 720) responseTimes.push(hours); // cap at 30 days
      }
    }
    const avgResponse = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    // Avg customer wait: last customer reply → tech's next action. If the tech
    // has NOT acted since the customer replied, the customer is still waiting
    // — count the wait as "so far" (up to now). Dropping those rows (the old
    // hours >= 0 filter) excluded exactly the worst cases from the metric.
    const customerWaits: number[] = [];
    for (const t of techTickets) {
      if (!t.last_customer_reply_at) continue;
      const answered = t.last_tech_action_at && t.last_tech_action_at > t.last_customer_reply_at;
      const hours = answered
        ? hoursBetween(t.last_customer_reply_at, t.last_tech_action_at!)
        : !isResolved(t)
          ? hoursBetween(t.last_customer_reply_at, now)
          : -1;
      if (hours >= 0 && hours < 720) customerWaits.push(hours);
    }
    const avgCustomerWait = customerWaits.length > 0
      ? customerWaits.reduce((a, b) => a + b, 0) / customerWaits.length
      : null;

    // Stale: open tickets with no activity in 3+ days
    const stale = open.filter((t) => {
      const lastAction = t.last_tech_action_at ?? t.created_at;
      return hoursBetween(lastAction, now) > 72;
    });

    // Critical tickets (urgency 4-5)
    const ticketIds = new Set(techTickets.map((t) => t.id));
    const critical = allTriage.filter(
      (tr) => ticketIds.has(tr.ticket_id) && tr.urgency_score >= 4,
    );

    // Oldest open ticket
    const oldestOpen = open.length > 0
      ? Math.max(...open.map((t) => hoursBetween(t.created_at, now) / 24))
      : null;

    techMetrics.push({
      name,
      totalTickets: techTickets.length,
      openTickets: open.length,
      resolvedTickets: resolved.length,
      needsReviewTickets: needsReview.length,
      avgResponseHours: avgResponse,
      avgCustomerWaitHours: avgCustomerWait,
      staleTickets: stale.length,
      criticalTickets: critical.length,
      oldestOpenDays: oldestOpen ? Math.round(oldestOpen) : null,
      ticketsLastWeek: techTickets.filter((t) => t.created_at >= oneWeekAgo).length,
      ticketsLastMonth: techTickets.filter((t) => t.created_at >= oneMonthAgo).length,
    });
  }

  // Sort by open tickets descending (busiest techs first)
  const sortedMetrics = [...techMetrics].sort((a, b) => b.openTickets - a.openTickets);

  // Team overview
  const allOpen = allTickets.filter((t) => !isResolved(t));
  const allResolved = allTickets.filter((t) => isResolved(t));
  const allResponseTimes: number[] = [];
  const allCustomerWaits: number[] = [];

  for (const t of allTickets) {
    if (t.last_tech_action_at) {
      const h = hoursBetween(t.created_at, t.last_tech_action_at);
      if (h >= 0 && h < 720) allResponseTimes.push(h);
    }
    if (t.last_customer_reply_at) {
      const answered = t.last_tech_action_at && t.last_tech_action_at > t.last_customer_reply_at;
      const h = answered
        ? hoursBetween(t.last_customer_reply_at, t.last_tech_action_at!)
        : !isResolved(t)
          ? hoursBetween(t.last_customer_reply_at, now)
          : -1;
      if (h >= 0 && h < 720) allCustomerWaits.push(h);
    }
  }

  const triagesThisWeek = allTriage.filter((tr) => tr.created_at >= oneWeekAgo);
  const triagesToday = allTriage.filter((tr) => tr.created_at >= todayStart);

  const teamOverview: TeamOverview = {
    totalOpen: allOpen.length,
    totalResolved: allResolved.length,
    totalNeedsReview: allTickets.filter((t) => t.status === "needs_review").length,
    totalStale: allOpen.filter((t) => {
      const last = t.last_tech_action_at ?? t.created_at;
      return hoursBetween(last, now) > 72;
    }).length,
    avgResponseHours: allResponseTimes.length > 0
      ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length
      : null,
    avgCustomerWaitHours: allCustomerWaits.length > 0
      ? allCustomerWaits.reduce((a, b) => a + b, 0) / allCustomerWaits.length
      : null,
    unassignedTickets: allOpen.filter((t) => !t.halo_agent).length,
    ticketsTriagedToday: triagesToday.length,
    ticketsTriagedThisWeek: triagesThisWeek.length,
  };

  return (
    <PerformanceDashboard
      techMetrics={sortedMetrics}
      teamOverview={teamOverview}
    />
  );
}
