import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client health score — aggregates triage data to provide
 * a per-client health indicator.
 *
 * Factors:
 * - Ticket volume (last 30 days)
 * - Average urgency score
 * - Security incidents
 * - Repeat issues
 * - Resolution time
 */

export interface ClientHealthScore {
  readonly clientName: string;
  readonly score: number; // 0-100 (100 = healthy)
  readonly grade: "A" | "B" | "C" | "D" | "F";
  readonly ticketCount30d: number;
  readonly avgUrgency: number;
  readonly securityIncidents: number;
  readonly repeatIssueRate: number;
  readonly topIssueTypes: ReadonlyArray<{ readonly type: string; readonly count: number }>;
  readonly trend: "improving" | "stable" | "declining";
  readonly computedAt: string;
}

/**
 * Compute health score for a specific client.
 */
export async function computeClientHealth(
  supabase: SupabaseClient,
  clientName: string,
): Promise<ClientHealthScore> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent tickets with triage results
  const { data: recentTickets } = await supabase
    .from("tickets")
    .select("id, summary, status, created_at")
    .eq("client_name", clientName)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false });

  const tickets = recentTickets ?? [];
  const ticketIds = tickets.map((t) => t.id as string);

  // Fetch triage results for these tickets
  const { data: triageResults } = ticketIds.length > 0
    ? await supabase
        .from("triage_results")
        .select("ticket_id, classification, urgency_score, security_flag")
        .in("ticket_id", ticketIds)
    : { data: [] };

  const results = triageResults ?? [];

  // Previous period for trend comparison
  const { data: prevTickets } = await supabase
    .from("tickets")
    .select("id")
    .eq("client_name", clientName)
    .gte("created_at", sixtyDaysAgo)
    .lt("created_at", thirtyDaysAgo);

  const prevCount = prevTickets?.length ?? 0;

  // Calculate metrics
  const ticketCount = tickets.length;
  const avgUrgency = results.length > 0
    ? results.reduce((sum, r) => sum + ((r.urgency_score as number) ?? 3), 0) / results.length
    : 0;
  const securityIncidents = results.filter((r) => r.security_flag === true).length;

  // Issue type distribution
  const typeCounts = new Map<string, number>();
  for (const r of results) {
    const classification = r.classification as { type?: string } | null;
    const type = classification?.type ?? "unknown";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const topIssueTypes = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Repeat issue rate (same classification type appearing 3+ times)
  const repeatTypes = [...typeCounts.entries()].filter(([, count]) => count >= 3);
  const repeatIssueRate = ticketCount > 0 ? repeatTypes.reduce((sum, [, c]) => sum + c, 0) / ticketCount : 0;

  // Trend: compare current vs previous 30-day period
  const trend: "improving" | "stable" | "declining" =
    ticketCount < prevCount * 0.8 ? "improving" :
    ticketCount > prevCount * 1.2 ? "declining" : "stable";

  // Compute score (100 = perfect health)
  let score = 100;
  // Penalize high ticket volume (>20 tickets/month is concerning)
  score -= Math.min(ticketCount * 1.5, 30);
  // Penalize high average urgency
  score -= Math.max((avgUrgency - 2) * 10, 0);
  // Penalize security incidents heavily
  score -= securityIncidents * 15;
  // Penalize repeat issues
  score -= repeatIssueRate * 20;
  // Bonus for declining trend
  if (trend === "improving") score += 5;
  if (trend === "declining") score -= 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: "A" | "B" | "C" | "D" | "F" =
    score >= 90 ? "A" :
    score >= 75 ? "B" :
    score >= 60 ? "C" :
    score >= 40 ? "D" : "F";

  return {
    clientName,
    score,
    grade,
    ticketCount30d: ticketCount,
    avgUrgency: Math.round(avgUrgency * 10) / 10,
    securityIncidents,
    repeatIssueRate: Math.round(repeatIssueRate * 100) / 100,
    topIssueTypes,
    trend,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute health scores for all clients with recent activity.
 * Returns sorted by score (worst first — these need attention).
 */
export async function computeAllClientHealth(
  supabase: SupabaseClient,
): Promise<ReadonlyArray<ClientHealthScore>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get all unique client names with recent tickets
  const { data: clients } = await supabase
    .from("tickets")
    .select("client_name")
    .gte("created_at", thirtyDaysAgo)
    .not("client_name", "is", null);

  if (!clients) return [];

  const uniqueClients = [...new Set(clients.map((c) => c.client_name as string))];

  // Compute health for each client in parallel
  const scores = await Promise.all(
    uniqueClients.map((name) => computeClientHealth(supabase, name)),
  );

  return scores.sort((a, b) => a.score - b.score);
}
