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

const WEEK_MS = 7 * 24 * 3600_000;

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

  const [breachRes, callRes] = await Promise.all([
    supabase
      .from("tickets")
      .select("halo_id, summary, client_name, halo_agent, halo_status, halo_sla_status, sla_breach_alert_count, sla_breach_alerted_at, sla_breach_last_alert_text, sla_breach_last_alert_at")
      .not("sla_breach_alerted_at", "is", null)
      .eq("halo_is_open", true)
      .order("sla_breach_alerted_at", { ascending: true }),
    supabase
      .from("sla_call_requests")
      .select("id, halo_id, tech_name, status, objective, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (breachRes.error) {
    console.error("[SLA-HUNTER] breach query failed:", breachRes.error.message);
  }
  if (callRes.error) {
    console.error("[SLA-HUNTER] call query failed:", callRes.error.message);
  }

  const breaches = (breachRes.data ?? []) as BreachRow[];
  const calls = (callRes.data ?? []) as CallRow[];

  const now = Date.now();
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
    callOutsTotal: calls.length,
    callOutsToday: callsToday.length,
    callOutsThisWeek: callsThisWeek.length,
    callOutsByStatus: byStatus,
    callOutsByTech: byTech,
  };

  return NextResponse.json({ breaches, calls, metrics, haloBaseUrl });
}
