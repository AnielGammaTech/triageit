import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/sla-hunter
 *
 * Powers the SLA Hunter tab. Returns:
 *  - breaches: open tickets currently flagged SLA-breached (the exact set the
 *    scan maintains + alerts on — sla_breach_alerted_at is set on breach,
 *    cleared on recovery).
 *  - calls: every automated SLA call-out the system placed (sla_call_requests)
 *    — the accountability log of who got called and why.
 *  - metrics: rollups for the header tiles.
 */

interface BreachRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly halo_sla_status: string | null;
  readonly sla_breach_alert_count: number | null;
  readonly sla_breach_alerted_at: string | null;
  readonly sla_breach_last_alert_text: string | null;
  readonly sla_breach_last_alert_at: string | null;
}

interface CallRow {
  readonly id: string;
  readonly halo_id: number;
  readonly tech_name: string | null;
  readonly status: string | null;
  readonly objective: string | null;
  readonly created_at: string;
}

interface AtRiskTicketRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly sla_fix_by: string | null;
  readonly sla_respond_by: string | null;
  readonly resolution_time_at: string | null;
}

const WEEK_MS = 7 * 24 * 3600_000;
// Upcoming-breach horizon — 96h covers a weekend so Friday-afternoon tickets
// due Monday morning surface before everyone leaves.
const AT_RISK_HORIZON_MS = 96 * 3600_000;

// Working window: 8:00am–5:15pm ET (the 15-min grace covers normal
// stay-a-bit-late — a 5:00pm deadline is NOT after hours). Mon–Fri.
const BH_START_MIN = 8 * 60; // 8:00am
const BH_END_MIN = 17 * 60 + 15; // 5:15pm

function etParts(iso: string): { minsOfDay: number; day: string } {
  const d = new Date(iso);
  const hour = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const minute = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "numeric" }));
  return {
    minsOfDay: (hour % 24) * 60 + minute,
    day: d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" }),
  };
}
/** Would this instant fall outside working hours (8:00am–5:15pm ET, Mon–Fri)? */
function isAfterHoursET(iso: string): boolean {
  const { minsOfDay, day } = etParts(iso);
  return !(minsOfDay >= BH_START_MIN && minsOfDay <= BH_END_MIN && !["Sat", "Sun"].includes(day));
}
/** Does this instant fall on a Saturday or Sunday (ET)? */
function isWeekendET(iso: string): boolean {
  return ["Sat", "Sun"].includes(etParts(iso).day);
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 30, 60_000, "sla-hunter");
  if (rateLimited) return rateLimited;

  const supabase = await createServiceClient();

  // Halo base URL for "Open in Halo" links (best-effort — never fail the page).
  let haloBaseUrl = "";
  try {
    const { data: halo } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .maybeSingle();
    haloBaseUrl = ((halo?.config as { base_url?: string } | null)?.base_url ?? "").replace(/\/$/, "");
  } catch {
    haloBaseUrl = "";
  }

  const [breachRes, callRes, atRiskRes] = await Promise.all([
    supabase
      .from("tickets")
      .select("halo_id, summary, client_name, halo_agent, halo_status, halo_sla_status, sla_breach_alert_count, sla_breach_alerted_at, sla_breach_last_alert_text, sla_breach_last_alert_at")
      // Live breach state maintained by the SLA scan — reflects what's ACTUALLY
      // breaching now, not the sticky alert flag (on-hold/waiting tickets clear).
      .eq("sla_currently_breached", true)
      .eq("halo_is_open", true)
      .order("sla_fix_by", { ascending: true }),
    supabase
      .from("sla_call_requests")
      .select("id, halo_id, tech_name, status, objective, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    // Upcoming breaches: open, not-yet-breached, not on hold, with a deadline.
    supabase
      .from("tickets")
      .select("halo_id, summary, client_name, halo_agent, halo_status, sla_fix_by, sla_respond_by, resolution_time_at")
      .eq("halo_is_open", true)
      .eq("tickettype_id", 31)
      .eq("sla_currently_breached", false)
      .eq("sla_on_hold", false),
  ]);

  if (breachRes.error) {
    console.error("[SLA-HUNTER] breach query failed:", breachRes.error.message);
  }
  if (callRes.error) {
    console.error("[SLA-HUNTER] call query failed:", callRes.error.message);
  }
  if (atRiskRes.error) {
    console.error("[SLA-HUNTER] at-risk query failed:", atRiskRes.error.message);
  }

  const breaches = (breachRes.data ?? []) as BreachRow[];
  const calls = (callRes.data ?? []) as CallRow[];

  const now = Date.now();

  // Nearest FUTURE deadline per ticket (fix-by is the true SLA breach signal;
  // fall back to respond-by, then Halo's resolution deadline). Keep only those
  // due within the horizon. Flag the ones that fall outside business hours —
  // those breach while no one is working, so they must be cleared before EOD.
  const atRisk = ((atRiskRes.data ?? []) as AtRiskTicketRow[])
    .map((t) => {
      const candidates = [t.sla_fix_by, t.sla_respond_by, t.resolution_time_at]
        .filter((v): v is string => Boolean(v))
        .map((v) => ({ iso: v, ms: new Date(v).getTime() }))
        .filter((v) => Number.isFinite(v.ms) && v.ms > now && v.ms - now <= AT_RISK_HORIZON_MS);
      if (candidates.length === 0) return null;
      const nearest = candidates.reduce((a, b) => (b.ms < a.ms ? b : a));
      return {
        halo_id: t.halo_id,
        summary: t.summary,
        client_name: t.client_name,
        halo_agent: t.halo_agent,
        halo_status: t.halo_status,
        deadline: nearest.iso,
        afterHours: isAfterHoursET(nearest.iso),
        weekend: isWeekendET(nearest.iso),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const callsToday = calls.filter((c) => new Date(c.created_at).getTime() >= todayStart.getTime());
  const callsThisWeek = calls.filter((c) => now - new Date(c.created_at).getTime() <= WEEK_MS);

  const byStatus: Record<string, number> = {};
  for (const c of calls) {
    const s = (c.status ?? "unknown").toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  // Per-tech call-out accountability (this week) — who got called, how often.
  const byTechMap = new Map<string, number>();
  for (const c of callsThisWeek) {
    const t = (c.tech_name ?? "").trim();
    if (!t) continue;
    byTechMap.set(t, (byTechMap.get(t) ?? 0) + 1);
  }
  const byTech = [...byTechMap.entries()]
    .map(([tech, count]) => ({ tech, count }))
    .sort((a, b) => b.count - a.count);

  const metrics = {
    currentlyBreaching: breaches.length,
    escalated: breaches.filter((b) => (b.sla_breach_alert_count ?? 0) >= 2).length,
    atRisk: atRisk.length,
    atRiskAfterHours: atRisk.filter((t) => t.afterHours).length,
    callOutsTotal: calls.length,
    callOutsToday: callsToday.length,
    callOutsThisWeek: callsThisWeek.length,
    callOutsByStatus: byStatus,
    callOutsByTech: byTech,
  };

  return NextResponse.json({ breaches, atRisk, calls, metrics, haloBaseUrl });
}
