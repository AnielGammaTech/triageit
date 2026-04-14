import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { SkillLoader } from "../../memory/skill-loader.js";

/**
 * Toby Incremental Learning — Runs after EVERY triage
 *
 * Lightweight, fast profile updates without AI calls for most tickets.
 * Uses Haiku for AI-enriched summaries every Nth ticket or when patterns shift.
 *
 * This makes Toby a true HR agent: learning continuously, not just nightly.
 */

// How often to refresh AI-generated summaries (every N tickets for a given entity)
const AI_REFRESH_INTERVAL = 5;

// ── Types ────────────────────────────────────────────────────────────

interface IncrementalInput {
  readonly ticketId: string;
  readonly haloId: number;
  readonly clientName: string | null;
  readonly techName: string | null;
  readonly classificationType: string | null;
  readonly classificationSubtype: string | null;
  readonly urgencyScore: number;
  readonly summary: string;
}

interface IncrementalResult {
  readonly techProfileUpdated: boolean;
  readonly customerInsightUpdated: boolean;
  readonly aiRefreshed: boolean;
  readonly durationMs: number;
}

// ── Main Entry Point ─────────────────────────────────────────────────

export async function runTobyIncremental(
  supabase: SupabaseClient,
  input: IncrementalInput,
): Promise<IncrementalResult> {
  const startTime = Date.now();
  let techProfileUpdated = false;
  let customerInsightUpdated = false;
  let aiRefreshed = false;

  // Run tech and customer updates in parallel
  const [techResult, customerResult] = await Promise.allSettled([
    input.techName
      ? updateTechProfile(supabase, input)
      : Promise.resolve({ updated: false, needsAiRefresh: false }),
    input.clientName
      ? updateCustomerInsight(supabase, input)
      : Promise.resolve({ updated: false, needsAiRefresh: false }),
  ]);

  if (techResult.status === "fulfilled") {
    techProfileUpdated = techResult.value.updated;
    if (techResult.value.needsAiRefresh) {
      aiRefreshed = true;
    }
  } else {
    console.error("[TOBY-LIVE] Tech profile update failed:", techResult.reason);
  }

  if (customerResult.status === "fulfilled") {
    customerInsightUpdated = customerResult.value.updated;
    if (customerResult.value.needsAiRefresh) {
      aiRefreshed = true;
    }
  } else {
    console.error("[TOBY-LIVE] Customer insight update failed:", customerResult.reason);
  }

  // If any AI refresh was triggered, update Michael's skills
  if (aiRefreshed) {
    try {
      await refreshMichaelSkills(supabase);
    } catch (err) {
      console.error("[TOBY-LIVE] Failed to refresh Michael's skills:", err);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[TOBY-LIVE] Incremental update for #${input.haloId}: tech=${techProfileUpdated}, customer=${customerInsightUpdated}, ai=${aiRefreshed} (${durationMs}ms)`,
  );

  return { techProfileUpdated, customerInsightUpdated, aiRefreshed, durationMs };
}

// ── Tech Profile Update ──────────────────────────────────────────────

async function updateTechProfile(
  supabase: SupabaseClient,
  input: IncrementalInput,
): Promise<{ updated: boolean; needsAiRefresh: boolean }> {
  const techName = input.techName!;

  // Get existing profile
  const { data: existing } = await supabase
    .from("tech_profiles")
    .select("*")
    .eq("tech_name", techName)
    .maybeSingle();

  // Count tickets for this tech (30d and all-time)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: count30d }, { count: countAll }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("halo_agent", techName)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("halo_agent", techName),
  ]);

  // Get latest reviews for rating stats
  const { data: recentReviews } = await supabase
    .from("tech_reviews")
    .select("rating, communication_score, max_gap_hours")
    .eq("tech_name", techName)
    .gte("created_at", thirtyDaysAgo);

  const reviews = recentReviews ?? [];
  const ratingCounts = { great: 0, good: 0, needs_improvement: 0, poor: 0 };
  const RATING_SCORES: Record<string, number> = {
    great: 4, good: 3, needs_improvement: 2, poor: 1,
  };
  let totalRating = 0;
  let totalComm = 0;
  let totalGap = 0;

  for (const review of reviews) {
    const r = review.rating as keyof typeof ratingCounts;
    if (r in ratingCounts) ratingCounts[r]++;
    totalRating += RATING_SCORES[review.rating] ?? 0;
    totalComm += review.communication_score ?? 0;
    totalGap += review.max_gap_hours ?? 0;
  }

  const avgRating = reviews.length > 0 ? totalRating / reviews.length : (existing?.avg_rating_score ?? 0);
  const avgComm = reviews.length > 0 ? totalComm / reviews.length : (existing?.avg_communication_score ?? 0);
  const avgResponse = reviews.length > 0 ? totalGap / reviews.length : (existing?.avg_response_hours ?? 0);

  // Append this ticket's classification to the pattern history
  const currentPatterns = (existing?.patterns ?? {}) as Record<string, unknown>;
  const ticketHistory = (currentPatterns.recent_ticket_types as string[] ?? []);
  const updatedHistory = [
    input.classificationType ?? "unknown",
    ...ticketHistory,
  ].slice(0, 50); // Keep last 50

  // Determine if AI refresh is needed
  const ticketsHandled = count30d ?? 0;
  const previousCount = existing?.tickets_handled_30d ?? 0;
  const needsAiRefresh =
    !existing ||
    (ticketsHandled > 0 && ticketsHandled % AI_REFRESH_INTERVAL === 0) ||
    (ticketsHandled - previousCount >= AI_REFRESH_INTERVAL);

  let strongCategories = existing?.strong_categories ?? [];
  let weakCategories = existing?.weak_categories ?? [];
  let summary = existing?.summary ?? null;

  if (needsAiRefresh) {
    const aiResult = await refreshTechSummary(supabase, techName, ticketsHandled, avgRating, avgResponse, ratingCounts, updatedHistory);
    if (aiResult) {
      strongCategories = aiResult.strong_categories;
      weakCategories = aiResult.weak_categories;
      summary = aiResult.summary;
    }
  }

  await supabase.from("tech_profiles").upsert(
    {
      tech_name: techName,
      avg_response_hours: avgResponse,
      median_response_hours: avgResponse,
      tickets_handled_30d: count30d ?? 0,
      tickets_handled_all_time: countAll ?? 0,
      avg_rating_score: avgRating,
      avg_communication_score: avgComm,
      great_count: ratingCounts.great,
      good_count: ratingCounts.good,
      needs_improvement_count: ratingCounts.needs_improvement,
      poor_count: ratingCounts.poor,
      strong_categories: strongCategories,
      weak_categories: weakCategories,
      patterns: { ...currentPatterns, recent_ticket_types: updatedHistory },
      summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tech_name" },
  );

  return { updated: true, needsAiRefresh };
}

// ── Customer Insight Update ──────────────────────────────────────────

async function updateCustomerInsight(
  supabase: SupabaseClient,
  input: IncrementalInput,
): Promise<{ updated: boolean; needsAiRefresh: boolean }> {
  const clientName = input.clientName!;

  // Get existing insight
  const { data: existing } = await supabase
    .from("customer_insights")
    .select("*")
    .eq("client_name", clientName)
    .maybeSingle();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: count30d }, { count: countAll }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("client_name", clientName)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("client_name", clientName),
  ]);

  // Get classification distribution for this customer
  const { data: recentTriages } = await supabase
    .from("triage_results")
    .select("classification, urgency_score")
    .in(
      "ticket_id",
      (await supabase
        .from("tickets")
        .select("id")
        .eq("client_name", clientName)
        .gte("created_at", thirtyDaysAgo)
      ).data?.map((t) => t.id) ?? [],
    );

  const triages = recentTriages ?? [];

  // Calculate top issue types
  const typeCounts: Record<string, number> = {};
  const urgencies: number[] = [];
  for (const tr of triages) {
    const c = tr.classification as { type?: string } | null;
    const t = c?.type;
    if (t) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    if (tr.urgency_score != null) urgencies.push(tr.urgency_score);
  }

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type]) => type);

  const avgUrgency = urgencies.length > 0
    ? urgencies.reduce((a, b) => a + b, 0) / urgencies.length
    : (existing?.avg_urgency ?? 0);

  // Count update requests (customer replied, no tech response)
  const { count: updateRequestCount } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("client_name", clientName)
    .gte("created_at", thirtyDaysAgo)
    .not("last_customer_reply_at", "is", null)
    .is("last_tech_action_at", null);

  // Track issue history in environment_notes
  const currentEnv = (existing?.environment_notes ?? {}) as Record<string, unknown>;
  const issueTimeline = (currentEnv.issue_timeline as Array<{ date: string; type: string; summary: string }>) ?? [];
  const updatedTimeline = [
    {
      date: new Date().toISOString().slice(0, 10),
      type: input.classificationType ?? "unknown",
      summary: input.summary.slice(0, 120),
    },
    ...issueTimeline,
  ].slice(0, 100); // Keep last 100

  // Determine if AI refresh needed
  const ticketsHandled = count30d ?? 0;
  const previousCount = existing?.tickets_30d ?? 0;
  const needsAiRefresh =
    !existing ||
    (ticketsHandled > 0 && ticketsHandled % AI_REFRESH_INTERVAL === 0) ||
    (ticketsHandled - previousCount >= AI_REFRESH_INTERVAL);

  let recurringIssues = existing?.recurring_issues ?? [];
  let summary = existing?.summary ?? null;
  let environmentNotes = { ...currentEnv, issue_timeline: updatedTimeline };

  if (needsAiRefresh) {
    const aiResult = await refreshCustomerSummary(
      supabase, clientName, ticketsHandled, topTypes, avgUrgency, updatedTimeline,
    );
    if (aiResult) {
      recurringIssues = aiResult.recurring_issues;
      summary = aiResult.summary;
      environmentNotes = {
        ...environmentNotes,
        ...(aiResult.environment_notes ?? {}),
        issue_timeline: updatedTimeline,
      };
    }
  }

  await supabase.from("customer_insights").upsert(
    {
      client_name: clientName,
      client_id: null, // Will be filled by daily batch
      tickets_30d: count30d ?? 0,
      tickets_all_time: countAll ?? 0,
      top_issue_types: topTypes,
      recurring_issues: recurringIssues,
      avg_urgency: avgUrgency,
      update_request_count_30d: updateRequestCount ?? 0,
      environment_notes: environmentNotes,
      summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_name" },
  );

  return { updated: true, needsAiRefresh };
}

// ── AI Summary Refreshers (Haiku — cheap and fast) ───────────────────

async function refreshTechSummary(
  supabase: SupabaseClient,
  techName: string,
  ticketCount: number,
  avgRating: number,
  avgResponse: number,
  ratingCounts: Record<string, number>,
  recentTypes: string[],
): Promise<{ strong_categories: string[]; weak_categories: string[]; summary: string } | null> {
  try {
    // Get recent ticket subjects for richer analysis
    const { data: recentTickets } = await supabase
      .from("tickets")
      .select("halo_id, summary, client_name, status, halo_status")
      .eq("halo_agent", techName)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: recentReviews } = await supabase
      .from("tech_reviews")
      .select("rating, summary, communication_score")
      .eq("tech_name", techName)
      .order("created_at", { ascending: false })
      .limit(10);

    const context = [
      `Tech: ${techName}`,
      `Tickets (30d): ${ticketCount}`,
      `Avg rating: ${avgRating.toFixed(2)}/4`,
      `Avg response: ${avgResponse.toFixed(1)}h`,
      `Ratings: great=${ratingCounts.great}, good=${ratingCounts.good}, needs_improvement=${ratingCounts.needs_improvement}, poor=${ratingCounts.poor}`,
      `Recent ticket types: ${[...new Set(recentTypes.slice(0, 20))].join(", ")}`,
      ``,
      `Recent tickets:`,
      ...(recentTickets ?? []).map((t) => `  - #${t.halo_id}: ${t.summary} (${t.client_name ?? "?"}) [${t.halo_status ?? t.status}]`),
      ``,
      `Recent reviews:`,
      ...(recentReviews ?? []).map((r) => `  - ${r.rating} (comm: ${r.communication_score}/5): ${r.summary}`),
    ].join("\n");

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You analyze IT technician performance. Identify strengths, weaknesses, and behavioral patterns. Be specific and actionable. Respond with ONLY valid JSON:
{
  "strong_categories": ["specific ticket categories they handle well"],
  "weak_categories": ["specific categories where they struggle"],
  "summary": "2-3 sentence profile: work style, reliability, what they're known for, what to watch"
}`,
      messages: [{ role: "user", content: context }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    return parseLlmJson(text);
  } catch (err) {
    console.error(`[TOBY-LIVE] AI refresh failed for tech ${techName}:`, err);
    return null;
  }
}

async function refreshCustomerSummary(
  supabase: SupabaseClient,
  clientName: string,
  ticketCount: number,
  topTypes: string[],
  avgUrgency: number,
  issueTimeline: Array<{ date: string; type: string; summary: string }>,
): Promise<{ recurring_issues: string[]; environment_notes: Record<string, unknown>; summary: string } | null> {
  try {
    const { data: recentTickets } = await supabase
      .from("tickets")
      .select("halo_id, summary, status, halo_status, created_at")
      .eq("client_name", clientName)
      .order("created_at", { ascending: false })
      .limit(25);

    const context = [
      `Client: ${clientName}`,
      `Tickets (30d): ${ticketCount}`,
      `Avg urgency: ${avgUrgency.toFixed(1)}/5`,
      `Top issue types: ${topTypes.join(", ") || "N/A"}`,
      ``,
      `Issue timeline (recent first):`,
      ...issueTimeline.slice(0, 30).map((e) => `  - [${e.date}] ${e.type}: ${e.summary}`),
      ``,
      `Recent tickets:`,
      ...(recentTickets ?? []).map((t) => `  - #${t.halo_id}: ${t.summary} [${t.halo_status ?? t.status}] (${t.created_at?.slice(0, 10)})`),
    ].join("\n");

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You analyze MSP client support patterns. Identify recurring issues, infrastructure patterns, and risk signals. Be specific. Respond with ONLY valid JSON:
{
  "recurring_issues": ["specific issues that keep coming back"],
  "environment_notes": {"key observations about their IT environment, infrastructure, common apps, or known quirks"},
  "summary": "2-3 sentence profile: what kind of client they are, their pain points, how they typically submit tickets"
}`,
      messages: [{ role: "user", content: context }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    return parseLlmJson(text);
  } catch (err) {
    console.error(`[TOBY-LIVE] AI refresh failed for client ${clientName}:`, err);
    return null;
  }
}

// ── Refresh Michael's Skills After AI Updates ────────────────────────

async function refreshMichaelSkills(supabase: SupabaseClient): Promise<void> {
  const skillLoader = new SkillLoader(supabase);

  const { data: techProfiles } = await supabase
    .from("tech_profiles")
    .select("tech_name, summary, strong_categories, weak_categories, avg_response_hours, avg_rating_score")
    .order("updated_at", { ascending: false });

  const { data: customerData } = await supabase
    .from("customer_insights")
    .select("client_name, summary, recurring_issues, top_issue_types, update_request_count_30d")
    .gt("tickets_30d", 0)
    .order("tickets_30d", { ascending: false });

  // Deactivate old Toby skills
  await supabase
    .from("agent_skills")
    .update({ is_active: false })
    .eq("agent_name", "michael_scott")
    .like("title", "Toby's%");

  if ((techProfiles ?? []).length > 0) {
    const techSkillContent = (techProfiles ?? [])
      .map(
        (p) =>
          `**${p.tech_name}**: ${p.summary ?? "No data"}. Strong at: ${p.strong_categories?.join(", ") || "N/A"}. Weak at: ${p.weak_categories?.join(", ") || "N/A"}. Avg response: ${p.avg_response_hours?.toFixed(1) ?? "?"}h.`,
      )
      .join("\n");

    await supabase.from("agent_skills").insert({
      agent_name: "michael_scott",
      title: "Toby's Tech Profiles",
      content: `Current technician behavioral profiles (updated ${new Date().toISOString().slice(0, 10)}):\n\n${techSkillContent}\n\nUse these profiles when recommending which tech to assign a ticket to, and when evaluating tech performance.`,
      skill_type: "context",
      is_active: true,
      metadata: { source: "toby_incremental", generated_at: new Date().toISOString() },
    });
  }

  if ((customerData ?? []).length > 0) {
    const customerSkillContent = (customerData ?? [])
      .slice(0, 20)
      .map(
        (c) =>
          `**${c.client_name}**: ${c.summary ?? "No data"}. Top issues: ${c.top_issue_types?.join(", ") || "N/A"}.${c.recurring_issues?.length ? ` Recurring: ${c.recurring_issues.join(", ")}.` : ""}${c.update_request_count_30d > 2 ? ` Warning: Frequent update requests (${c.update_request_count_30d} in 30d).` : ""}`,
      )
      .join("\n");

    await supabase.from("agent_skills").insert({
      agent_name: "michael_scott",
      title: "Toby's Customer Profiles",
      content: `Current client patterns and insights (updated ${new Date().toISOString().slice(0, 10)}):\n\n${customerSkillContent}\n\nUse these profiles to provide client-specific context during triage. Flag recurring issues and patterns.`,
      skill_type: "context",
      is_active: true,
      metadata: { source: "toby_incremental", generated_at: new Date().toISOString() },
    });
  }

  skillLoader.clearCache("michael_scott");
  console.log("[TOBY-LIVE] Michael's skills refreshed with latest profiles");
}
