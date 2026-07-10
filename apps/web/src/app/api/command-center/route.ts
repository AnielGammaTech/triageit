import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/command-center
 *
 * Aggregate operations view: ticket status breakdown, live SLA breaches, per-
 * tech stats, and a "wall of shame" ranking techs by what works against the
 * team (active breaches, poor reviews, unacknowledged customer replies).
 */

interface TicketRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly sla_currently_breached: boolean | null;
  readonly sla_breach_alert_count: number | null;
  readonly last_tech_action_at: string | null;
  readonly last_customer_reply_at: string | null;
}

interface ReviewRow {
  readonly tech_name: string | null;
  readonly rating: string | null;
  readonly max_gap_hours: number | null;
  readonly created_at: string;
}

const THIRTY_MIN_MS = 30 * 60_000;
const MONTH_MS = 30 * 24 * 3600_000;

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "command-center");
  if (rl) return rl;

  const supabase = await createServiceClient();
  const now = Date.now();

  let haloBaseUrl = "";
  try {
    const { data: halo } = await supabase.from("integrations").select("config").eq("service", "halo").maybeSingle();
    haloBaseUrl = ((halo?.config as { base_url?: string } | null)?.base_url ?? "").replace(/\/$/, "");
  } catch {
    haloBaseUrl = "";
  }

  const [ticketRes, reviewRes] = await Promise.all([
    supabase
      .from("tickets")
      .select("halo_id, summary, client_name, halo_agent, halo_status, sla_currently_breached, sla_breach_alert_count, last_tech_action_at, last_customer_reply_at")
      .eq("halo_is_open", true)
      .eq("tickettype_id", 31),
    supabase
      .from("tech_reviews")
      .select("tech_name, rating, max_gap_hours, created_at")
      .gte("created_at", new Date(now - MONTH_MS).toISOString()),
  ]);

  const tickets = (ticketRes.data ?? []) as TicketRow[];
  const reviews = (reviewRes.data ?? []) as ReviewRow[];

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

  // ── Currently breaching ──
  const breaches = tickets
    .filter((t) => t.sla_currently_breached)
    .map((t) => ({
      halo_id: t.halo_id,
      summary: t.summary,
      client_name: t.client_name,
      halo_agent: t.halo_agent,
      alertCount: t.sla_breach_alert_count ?? 0,
    }));

  // ── Per-tech stats ──
  interface TechAgg {
    tech: string;
    openTickets: number;
    breaching: number;
    waitingOnTech: number;
    unackedReplies: number;
    poorReviews: number;
    worstGapHours: number;
  }
  const techs = new Map<string, TechAgg>();
  const getTech = (name: string): TechAgg => {
    let t = techs.get(name);
    if (!t) {
      t = { tech: name, openTickets: 0, breaching: 0, waitingOnTech: 0, unackedReplies: 0, poorReviews: 0, worstGapHours: 0 };
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
    const status = (t.halo_status ?? "").toLowerCase();
    if (status.includes("waiting on tech")) agg.waitingOnTech++;
    if (status.includes("customer reply")) {
      const cust = t.last_customer_reply_at ? new Date(t.last_customer_reply_at).getTime() : 0;
      const tech = t.last_tech_action_at ? new Date(t.last_tech_action_at).getTime() : 0;
      if (cust > 0 && cust > tech && now - cust >= THIRTY_MIN_MS) agg.unackedReplies++;
    }
  }
  for (const r of reviews) {
    const name = (r.tech_name ?? "").trim();
    if (!name || name.toUpperCase() === "UNASSIGNED") continue;
    const rating = (r.rating ?? "").toLowerCase();
    if (rating === "poor" || rating === "needs_improvement") {
      const agg = getTech(name);
      agg.poorReviews++;
      if ((r.max_gap_hours ?? 0) > agg.worstGapHours) agg.worstGapHours = r.max_gap_hours ?? 0;
    }
  }

  const techStats = [...techs.values()].sort((a, b) => b.openTickets - a.openTickets);

  // ── Wall of Shame — ranked by what works against the team ──
  const wallOfShame = techStats
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

  const metrics = {
    open: tickets.length,
    breaching: breaches.length,
    unassigned: tickets.filter((t) => !t.halo_agent || t.halo_agent.toLowerCase() === "unassigned").length,
    waitingOnTech: tickets.filter((t) => (t.halo_status ?? "").toLowerCase().includes("waiting on tech")).length,
    customerReply: tickets.filter((t) => (t.halo_status ?? "").toLowerCase().includes("customer reply")).length,
    unackedReplies: techStats.reduce((s, t) => s + t.unackedReplies, 0),
  };

  return NextResponse.json({ metrics, statusCounts, breaches, techStats, wallOfShame, haloBaseUrl });
}
