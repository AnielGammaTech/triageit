import { createClient } from "@/lib/supabase/server";
import { PerformanceDashboard } from "./performance-dashboard";
import { TobyDashboard } from "./toby/toby-dashboard";
import { AnalyticsTabs } from "./analytics-tabs";
import type {
  TechProfileRow,
  TrendDetectionRow,
  TriageEvaluationRow,
  TobyRunLogRow,
} from "./toby/page";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_team: string | null;
  readonly halo_status: string | null;
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

function isResolved(status: string | null): boolean {
  if (!status) return false;
  return RESOLVED_STATUSES.includes(status.toLowerCase());
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

  // Fetch all tickets with their triage results
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, halo_agent, halo_team, halo_status, status, created_at, updated_at, last_retriage_at, last_customer_reply_at, last_tech_action_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  const { data: triageResults } = await supabase
    .from("triage_results")
    .select("id, ticket_id, urgency_score, recommended_priority, triage_type, classification, internal_notes, processing_time_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);

  const allTickets = (tickets ?? []) as ReadonlyArray<TicketRow>;
  const allTriage = (triageResults ?? []) as ReadonlyArray<TriageRow>;

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

    const open = techTickets.filter((t) => !isResolved(t.halo_status));
    const resolved = techTickets.filter((t) => isResolved(t.halo_status));
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

    // Avg customer wait: time from last customer reply to last tech action
    const customerWaits: number[] = [];
    for (const t of techTickets) {
      if (t.last_customer_reply_at && t.last_tech_action_at) {
        const hours = hoursBetween(t.last_customer_reply_at, t.last_tech_action_at);
        if (hours >= 0 && hours < 720) customerWaits.push(hours);
      }
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
  const allOpen = allTickets.filter((t) => !isResolved(t.halo_status));
  const allResolved = allTickets.filter((t) => isResolved(t.halo_status));
  const allResponseTimes: number[] = [];
  const allCustomerWaits: number[] = [];

  for (const t of allTickets) {
    if (t.last_tech_action_at) {
      const h = hoursBetween(t.created_at, t.last_tech_action_at);
      if (h >= 0 && h < 720) allResponseTimes.push(h);
    }
    if (t.last_customer_reply_at && t.last_tech_action_at) {
      const h = hoursBetween(t.last_customer_reply_at, t.last_tech_action_at);
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

  // Fetch Toby data
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [techProfilesRes, trendsRes, evaluationsRes, runLogRes] = await Promise.all([
    supabase
      .from("tech_profiles")
      .select("*")
      .order("avg_rating_score", { ascending: false }),
    supabase
      .from("trend_detections")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("triage_evaluations")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false }),
    supabase
      .from("toby_run_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  const techProfiles = (techProfilesRes.data ?? []) as ReadonlyArray<TechProfileRow>;
  const trends = (trendsRes.data ?? []) as ReadonlyArray<TrendDetectionRow>;
  const evaluations = (evaluationsRes.data ?? []) as ReadonlyArray<TriageEvaluationRow>;
  const runLog = (runLogRes.data ?? []) as ReadonlyArray<TobyRunLogRow>;

  return (
    <AnalyticsTabs
      performanceTab={
        <PerformanceDashboard
          techMetrics={sortedMetrics}
          teamOverview={teamOverview}
        />
      }
      tobyTab={
        <TobyDashboard
          techProfiles={techProfiles}
          trends={trends}
          evaluations={evaluations}
          runLog={runLog}
        />
      }
    />
  );
}
