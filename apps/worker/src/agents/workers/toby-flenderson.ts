import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { MemoryManager } from "../../memory/memory-manager.js";
import { SkillLoader } from "../../memory/skill-loader.js";

/**
 * Toby Flenderson — Learning & Analytics Agent
 *
 * Runs daily (2 AM ET) during idle time. Analyzes all tickets, tech behavior,
 * customer patterns, and triage accuracy. Produces:
 * 1. Tech profiles — per-tech behavioral scorecards
 * 2. Customer insights — per-client recurring patterns
 * 3. Trend detections — cross-ticket anomalies and spikes
 * 4. Triage evaluations — self-assessment of AI accuracy on resolved tickets
 *
 * Stores insights in DB tables, feeds key findings into Michael's memory
 * and agent_skills, and sends a Teams summary.
 */

// ── Types ────────────────────────────────────────────────────────────

interface TechProfileAnalysis {
  readonly tech_name: string;
  readonly avg_response_hours: number;
  readonly tickets_handled_30d: number;
  readonly avg_rating_score: number;
  readonly avg_communication_score: number;
  readonly strong_categories: string[];
  readonly weak_categories: string[];
  readonly patterns: Record<string, unknown>;
  readonly summary: string;
}

interface CustomerInsightAnalysis {
  readonly client_name: string;
  readonly tickets_30d: number;
  readonly top_issue_types: string[];
  readonly recurring_issues: string[];
  readonly avg_urgency: number;
  readonly update_request_count_30d: number;
  readonly environment_notes: Record<string, unknown>;
  readonly summary: string;
}

interface TrendAnalysis {
  readonly trends: ReadonlyArray<{
    readonly trend_type: string;
    readonly title: string;
    readonly description: string;
    readonly severity: string;
    readonly affected_entity: string | null;
    readonly affected_entity_type: string | null;
    readonly evidence: Record<string, unknown>;
    readonly recommendation: string;
  }>;
}

interface TriageEvaluation {
  readonly ticket_id: string;
  readonly halo_id: number;
  readonly triage_result_id: string;
  readonly predicted_priority: number;
  readonly predicted_type: string;
  readonly predicted_urgency: number;
  readonly actual_resolution_hours: number;
  readonly priority_accurate: boolean;
  readonly type_accurate: boolean;
  readonly urgency_accurate: boolean;
  readonly overall_accuracy: number;
  readonly what_we_missed: string | null;
  readonly what_we_got_right: string | null;
  readonly improvement_suggestion: string | null;
}

export interface TobyRunResult {
  readonly runId: string;
  readonly techProfilesUpdated: number;
  readonly customerInsightsUpdated: number;
  readonly trendsDetected: number;
  readonly triagesEvaluated: number;
  readonly memoriesCreated: number;
  readonly skillsUpdated: number;
  readonly tokensUsed: number;
  readonly processingTimeMs: number;
  readonly summary: string;
}

// ── Rating helpers ───────────────────────────────────────────────────

const RATING_SCORES: Record<string, number> = {
  great: 4,
  good: 3,
  needs_improvement: 2,
  poor: 1,
};

// ── Main Analysis Runner ─────────────────────────────────────────────

export async function runTobyAnalysis(
  supabase: SupabaseClient,
  runType: "daily" | "manual" | "weekly" = "daily",
): Promise<TobyRunResult> {
  const startTime = Date.now();
  let tokensUsed = 0;

  const anthropic = new Anthropic();
  const memoryManager = new MemoryManager(supabase);
  const skillLoader = new SkillLoader(supabase);

  // Create run log entry
  const { data: runLog } = await supabase
    .from("toby_run_log")
    .insert({ run_type: runType, status: "running" })
    .select("id")
    .single();

  const runId = runLog?.id ?? crypto.randomUUID();

  let techProfilesUpdated = 0;
  let customerInsightsUpdated = 0;
  let trendsDetected = 0;
  let triagesEvaluated = 0;
  let memoriesCreated = 0;
  let skillsUpdated = 0;

  try {
    // ── Phase 1: Gather raw data ───────────────────────────────────
    console.log("[TOBY] Phase 1: Gathering data...");

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [
      { data: recentTickets },
      { data: allReviews },
      { data: recentTriageResults },
      { data: resolvedTickets },
      { data: existingEvals },
    ] = await Promise.all([
      supabase
        .from("tickets")
        .select("id, halo_id, summary, details, client_name, client_id, original_priority, status, halo_status, halo_agent, created_at, updated_at, last_customer_reply_at, last_tech_action_at")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false }),
      supabase
        .from("tech_reviews")
        .select("*")
        .gte("created_at", thirtyDaysAgo),
      supabase
        .from("triage_results")
        .select("id, ticket_id, classification, urgency_score, recommended_priority, triage_type, created_at")
        .gte("created_at", thirtyDaysAgo),
      supabase
        .from("tickets")
        .select("id, halo_id, summary, client_name, original_priority, status, halo_status, halo_agent, created_at, updated_at")
        .in("status", ["triaged", "re-triaged"])
        .or("halo_status.ilike.%resolved%,halo_status.ilike.%closed%"),
      supabase
        .from("triage_evaluations")
        .select("ticket_id")
        .gte("created_at", thirtyDaysAgo),
    ]);

    const tickets = recentTickets ?? [];
    const reviews = allReviews ?? [];
    const triageResults = recentTriageResults ?? [];
    const alreadyEvaluatedIds = new Set(
      (existingEvals ?? []).map((e) => e.ticket_id),
    );

    console.log(
      `[TOBY] Data gathered: ${tickets.length} tickets, ${reviews.length} reviews, ${triageResults.length} triage results, ${(resolvedTickets ?? []).length} resolved`,
    );

    // ── Phase 2: Tech Profiles ─────────────────────────────────────
    console.log("[TOBY] Phase 2: Analyzing tech profiles...");

    const techNames = [
      ...new Set(
        tickets
          .map((t) => t.halo_agent)
          .filter((name): name is string => !!name && name.length > 0),
      ),
    ];

    for (const techName of techNames) {
      try {
        const techTickets = tickets.filter((t) => t.halo_agent === techName);
        const techReviews = reviews.filter((r) => r.tech_name === techName);

        if (techTickets.length === 0) continue;

        // Calculate stats directly from data
        const ratingCounts = { great: 0, good: 0, needs_improvement: 0, poor: 0 };
        let totalRating = 0;
        let totalComm = 0;
        let maxGapSum = 0;

        for (const review of techReviews) {
          const r = review.rating as keyof typeof ratingCounts;
          if (r in ratingCounts) ratingCounts[r]++;
          totalRating += RATING_SCORES[review.rating] ?? 0;
          totalComm += review.communication_score ?? 0;
          maxGapSum += review.max_gap_hours ?? 0;
        }

        const avgRating = techReviews.length > 0 ? totalRating / techReviews.length : 0;
        const avgComm = techReviews.length > 0 ? totalComm / techReviews.length : 0;
        const avgResponseHours = techReviews.length > 0 ? maxGapSum / techReviews.length : 0;

        // Get all-time count
        const { count: allTimeCount } = await supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("halo_agent", techName);

        // Use AI to analyze patterns and generate summary
        const techContext = [
          `Tech: ${techName}`,
          `Tickets last 30 days: ${techTickets.length}`,
          `Tickets all time: ${allTimeCount ?? techTickets.length}`,
          `Average rating: ${avgRating.toFixed(2)}/4 (great=4, good=3, needs_improvement=2, poor=1)`,
          `Average communication: ${avgComm.toFixed(2)}/5`,
          `Average response gap: ${avgResponseHours.toFixed(1)} hours`,
          `Rating breakdown: ${JSON.stringify(ratingCounts)}`,
          ``,
          `Recent ticket types:`,
          ...techTickets.slice(0, 20).map(
            (t) => `  - #${t.halo_id}: ${t.summary} (${t.client_name ?? "?"}) [${t.status}]`,
          ),
          ``,
          `Recent reviews:`,
          ...techReviews.slice(0, 10).map(
            (r) => `  - ${r.rating} (comm: ${r.communication_score}/5): ${r.summary}`,
          ),
        ].join("\n");

        const profileResponse = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: `You analyze IT technician performance data. Identify what ticket categories they're strong/weak at, their work patterns, and write a brief behavioral summary. Respond with ONLY valid JSON:
{
  "strong_categories": ["categories they excel at based on ticket types and ratings"],
  "weak_categories": ["categories where they struggle or have poor ratings"],
  "patterns": {"key behavioral observations as key-value pairs"},
  "summary": "2-3 sentence profile of this tech's work style, strengths, and areas to watch"
}`,
          messages: [{ role: "user", content: techContext }],
        });

        tokensUsed +=
          profileResponse.usage.input_tokens +
          profileResponse.usage.output_tokens;

        const profileText =
          profileResponse.content[0].type === "text"
            ? profileResponse.content[0].text
            : "{}";
        const profile = parseLlmJson<TechProfileAnalysis>(profileText);

        // Upsert tech profile
        await supabase.from("tech_profiles").upsert(
          {
            tech_name: techName,
            avg_response_hours: avgResponseHours,
            median_response_hours: avgResponseHours, // approximate
            tickets_handled_30d: techTickets.length,
            tickets_handled_all_time: allTimeCount ?? techTickets.length,
            avg_rating_score: avgRating,
            avg_communication_score: avgComm,
            great_count: ratingCounts.great,
            good_count: ratingCounts.good,
            needs_improvement_count: ratingCounts.needs_improvement,
            poor_count: ratingCounts.poor,
            strong_categories: profile.strong_categories ?? [],
            weak_categories: profile.weak_categories ?? [],
            patterns: profile.patterns ?? {},
            summary: profile.summary ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tech_name" },
        );

        techProfilesUpdated++;
      } catch (err) {
        console.error(`[TOBY] Failed to analyze tech ${techName}:`, err);
      }
    }

    // ── Phase 3: Customer Insights ─────────────────────────────────
    console.log("[TOBY] Phase 3: Analyzing customer patterns...");

    const clientNames = [
      ...new Set(
        tickets
          .map((t) => t.client_name)
          .filter((name): name is string => !!name && name.length > 0),
      ),
    ];

    for (const clientName of clientNames) {
      try {
        const clientTickets = tickets.filter(
          (t) => t.client_name === clientName,
        );

        if (clientTickets.length < 2) continue; // Skip clients with very few tickets

        // Get matching triage results for classification data
        const clientTicketIds = clientTickets.map((t) => t.id);
        const clientTriages = triageResults.filter((tr) =>
          clientTicketIds.includes(tr.ticket_id),
        );

        // Count update requests
        const updateRequestTickets = clientTickets.filter(
          (t) => t.last_customer_reply_at && !t.last_tech_action_at,
        );

        // Calculate average urgency from triages
        const urgencies = clientTriages
          .map((tr) => tr.urgency_score)
          .filter((u): u is number => u !== null && u !== undefined);
        const avgUrgency =
          urgencies.length > 0
            ? urgencies.reduce((a, b) => a + b, 0) / urgencies.length
            : 0;

        // Extract classification types
        const classTypes = clientTriages
          .map((tr) => {
            const c = tr.classification as { type?: string } | null;
            return c?.type ?? null;
          })
          .filter((t): t is string => !!t);

        const typeCounts: Record<string, number> = {};
        for (const t of classTypes) {
          typeCounts[t] = (typeCounts[t] ?? 0) + 1;
        }
        const topTypes = Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([type]) => type);

        // All-time count
        const { count: allTimeCount } = await supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("client_name", clientName);

        // Use AI to find recurring issues and environment notes
        const clientContext = [
          `Client: ${clientName}`,
          `Tickets last 30 days: ${clientTickets.length}`,
          `All time: ${allTimeCount ?? clientTickets.length}`,
          `Average urgency: ${avgUrgency.toFixed(1)}/5`,
          `Top issue types: ${topTypes.join(", ") || "N/A"}`,
          `Update requests (customer waiting, no tech response): ${updateRequestTickets.length}`,
          ``,
          `Recent tickets:`,
          ...clientTickets.slice(0, 25).map(
            (t) =>
              `  - #${t.halo_id}: ${t.summary} [${t.status}] (${t.created_at})`,
          ),
        ].join("\n");

        const insightResponse = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: `You analyze MSP client ticket patterns. Identify recurring issues, environmental patterns, and notable trends. Respond with ONLY valid JSON:
{
  "recurring_issues": ["issues that keep coming back for this client"],
  "environment_notes": {"key observations about their environment — e.g. common apps, hardware, known quirks"},
  "summary": "2-3 sentence profile of this client's typical support needs and patterns"
}`,
          messages: [{ role: "user", content: clientContext }],
        });

        tokensUsed +=
          insightResponse.usage.input_tokens +
          insightResponse.usage.output_tokens;

        const insightText =
          insightResponse.content[0].type === "text"
            ? insightResponse.content[0].text
            : "{}";
        const insight = parseLlmJson<CustomerInsightAnalysis>(insightText);

        await supabase.from("customer_insights").upsert(
          {
            client_name: clientName,
            client_id: clientTickets[0]?.client_id ?? null,
            tickets_30d: clientTickets.length,
            tickets_all_time: allTimeCount ?? clientTickets.length,
            top_issue_types: topTypes,
            recurring_issues: insight.recurring_issues ?? [],
            avg_urgency: avgUrgency,
            update_request_count_30d: updateRequestTickets.length,
            environment_notes: insight.environment_notes ?? {},
            summary: insight.summary ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_name" },
        );

        customerInsightsUpdated++;
      } catch (err) {
        console.error(
          `[TOBY] Failed to analyze client ${clientName}:`,
          err,
        );
      }
    }

    // ── Phase 4: Trend Detection ───────────────────────────────────
    console.log("[TOBY] Phase 4: Detecting trends...");

    try {
      const trendContext = [
        `## Ticket Data (last 30 days)`,
        `Total tickets: ${tickets.length}`,
        ``,
        `### By Client:`,
        ...clientNames.map((c) => {
          const count = tickets.filter((t) => t.client_name === c).length;
          return `  - ${c}: ${count} tickets`;
        }),
        ``,
        `### By Tech:`,
        ...techNames.map((t) => {
          const count = tickets.filter((tk) => tk.halo_agent === t).length;
          return `  - ${t}: ${count} tickets assigned`;
        }),
        ``,
        `### Recent Ticket Subjects (last 50):`,
        ...tickets.slice(0, 50).map(
          (t) =>
            `  - [${t.created_at?.slice(0, 10)}] ${t.client_name}: ${t.summary}`,
        ),
        ``,
        `### Classification Types:`,
        ...Object.entries(
          triageResults.reduce(
            (acc, tr) => {
              const c = tr.classification as { type?: string } | null;
              const type = c?.type ?? "unknown";
              acc[type] = (acc[type] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
        )
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .map(([type, count]) => `  - ${type}: ${count}`),
      ].join("\n");

      const trendResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: `You are an MSP analytics expert. Analyze the ticket data and detect notable trends, spikes, recurring patterns, anomalies, or correlations. Focus on actionable insights that management should know about.

Respond with ONLY valid JSON:
{
  "trends": [
    {
      "trend_type": "spike|recurring|seasonal|anomaly|correlation|improvement|degradation",
      "title": "Short descriptive title",
      "description": "What you observed",
      "severity": "critical|warning|info",
      "affected_entity": "tech name, client name, or category (null if global)",
      "affected_entity_type": "tech|client|category|global",
      "evidence": {"supporting data points"},
      "recommendation": "What should be done about this"
    }
  ]
}

Only include trends that are genuinely notable. Don't manufacture patterns from noise. 3-8 trends max.`,
        messages: [{ role: "user", content: trendContext }],
      });

      tokensUsed +=
        trendResponse.usage.input_tokens +
        trendResponse.usage.output_tokens;

      const trendText =
        trendResponse.content[0].type === "text"
          ? trendResponse.content[0].text
          : '{"trends":[]}';
      const trendResult = parseLlmJson<TrendAnalysis>(trendText);

      for (const trend of trendResult.trends ?? []) {
        await supabase.from("trend_detections").insert({
          trend_type: trend.trend_type,
          title: trend.title,
          description: trend.description,
          severity: trend.severity,
          affected_entity: trend.affected_entity,
          affected_entity_type: trend.affected_entity_type,
          evidence: trend.evidence ?? {},
          recommendation: trend.recommendation,
        });
        trendsDetected++;
      }
    } catch (err) {
      console.error("[TOBY] Failed to detect trends:", err);
    }

    // ── Phase 5: Triage Self-Evaluation ────────────────────────────
    console.log("[TOBY] Phase 5: Evaluating triage accuracy...");

    const unevaluatedResolved = (resolvedTickets ?? []).filter(
      (t) => !alreadyEvaluatedIds.has(t.id),
    );

    for (const ticket of unevaluatedResolved.slice(0, 20)) {
      try {
        // Get the initial triage result for this ticket
        const { data: triageResult } = await supabase
          .from("triage_results")
          .select("*")
          .eq("ticket_id", ticket.id)
          .eq("triage_type", "initial")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!triageResult) continue;

        const classification = triageResult.classification as {
          type?: string;
          subtype?: string;
        } | null;

        // Calculate actual resolution time
        const createdAt = new Date(ticket.created_at).getTime();
        const resolvedAt = new Date(ticket.updated_at).getTime();
        const actualResolutionHours =
          (resolvedAt - createdAt) / (1000 * 60 * 60);

        const evalContext = [
          `## Triage Prediction vs Reality`,
          `Ticket #${ticket.halo_id}: ${ticket.summary}`,
          `Client: ${ticket.client_name ?? "Unknown"}`,
          ``,
          `### What we predicted:`,
          `- Priority: P${triageResult.recommended_priority}`,
          `- Type: ${classification?.type ?? "unknown"}/${classification?.subtype ?? "unknown"}`,
          `- Urgency: ${triageResult.urgency_score}/5`,
          `- Reasoning: ${triageResult.urgency_reasoning ?? "N/A"}`,
          ``,
          `### What actually happened:`,
          `- Original priority (from Halo): P${ticket.original_priority ?? "?"}`,
          `- Resolution time: ${actualResolutionHours.toFixed(1)} hours`,
          `- Final status: ${ticket.status} / ${ticket.halo_status ?? "unknown"}`,
        ].join("\n");

        const evalResponse = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: `You evaluate triage prediction accuracy for an MSP help desk AI. Compare what was predicted vs what happened. Be honest — if the prediction was wrong, say so. Respond with ONLY valid JSON:
{
  "priority_accurate": true/false,
  "type_accurate": true/false,
  "urgency_accurate": true/false,
  "overall_accuracy": 0.0-1.0,
  "what_we_missed": "what the triage got wrong (null if accurate)",
  "what_we_got_right": "what the triage nailed",
  "improvement_suggestion": "how to triage this type of ticket better next time (null if perfect)"
}`,
          messages: [{ role: "user", content: evalContext }],
        });

        tokensUsed +=
          evalResponse.usage.input_tokens +
          evalResponse.usage.output_tokens;

        const evalText =
          evalResponse.content[0].type === "text"
            ? evalResponse.content[0].text
            : "{}";
        const evaluation = parseLlmJson<TriageEvaluation>(evalText);

        await supabase.from("triage_evaluations").insert({
          ticket_id: ticket.id,
          halo_id: ticket.halo_id,
          triage_result_id: triageResult.id,
          predicted_priority: triageResult.recommended_priority,
          predicted_type: classification?.type ?? "unknown",
          predicted_urgency: triageResult.urgency_score,
          actual_resolution_hours: actualResolutionHours,
          actual_was_escalated: false,
          actual_required_onsite: false,
          priority_accurate: evaluation.priority_accurate ?? true,
          type_accurate: evaluation.type_accurate ?? true,
          urgency_accurate: evaluation.urgency_accurate ?? true,
          overall_accuracy: evaluation.overall_accuracy ?? 0.5,
          what_we_missed: evaluation.what_we_missed ?? null,
          what_we_got_right: evaluation.what_we_got_right ?? null,
          improvement_suggestion: evaluation.improvement_suggestion ?? null,
        });

        triagesEvaluated++;

        // If we found an improvement suggestion, store as memory for Michael
        if (evaluation.improvement_suggestion) {
          await memoryManager.createMemory({
            agent_name: "michael_scott",
            ticket_id: ticket.id,
            content: `Triage self-evaluation for ticket #${ticket.halo_id} (${classification?.type ?? "unknown"}): ${evaluation.improvement_suggestion}. What we got right: ${evaluation.what_we_got_right ?? "N/A"}. What we missed: ${evaluation.what_we_missed ?? "nothing"}. Overall accuracy: ${((evaluation.overall_accuracy ?? 0.5) * 100).toFixed(0)}%.`,
            summary: `Triage eval #${ticket.halo_id}: ${evaluation.improvement_suggestion}`,
            memory_type: "insight",
            confidence: evaluation.overall_accuracy ?? 0.5,
            metadata: {
              source: "toby_flenderson",
              eval_type: "triage_accuracy",
              halo_id: ticket.halo_id,
            },
          });
          memoriesCreated++;
        }
      } catch (err) {
        console.error(
          `[TOBY] Failed to evaluate ticket ${ticket.halo_id}:`,
          err,
        );
      }
    }

    // ── Phase 6: Feed insights into Michael's memory & skills ──────
    console.log("[TOBY] Phase 6: Feeding insights to Michael...");

    try {
      // Build a combined insight for Michael from all analyses
      const { data: techProfiles } = await supabase
        .from("tech_profiles")
        .select("tech_name, summary, strong_categories, weak_categories, avg_response_hours, avg_rating_score")
        .order("updated_at", { ascending: false });

      const { data: customerData } = await supabase
        .from("customer_insights")
        .select("client_name, summary, recurring_issues, top_issue_types, update_request_count_30d")
        .gt("tickets_30d", 2)
        .order("tickets_30d", { ascending: false });

      const { data: recentTrends } = await supabase
        .from("trend_detections")
        .select("title, description, severity, recommendation")
        .order("created_at", { ascending: false })
        .limit(10);

      // Create a shared memory with the latest analysis
      const insightContent = [
        `## Toby's Daily Analysis — ${new Date().toISOString().slice(0, 10)}`,
        ``,
        `### Tech Profiles`,
        ...(techProfiles ?? []).map(
          (p) =>
            `- **${p.tech_name}**: ${p.summary ?? "No summary"} (avg response: ${p.avg_response_hours?.toFixed(1) ?? "?"}h, rating: ${p.avg_rating_score?.toFixed(1) ?? "?"}/4)`,
        ),
        ``,
        `### Customer Patterns`,
        ...(customerData ?? []).map(
          (c) =>
            `- **${c.client_name}**: ${c.summary ?? "No summary"}${c.recurring_issues?.length ? ` Recurring: ${c.recurring_issues.join(", ")}` : ""}`,
        ),
        ``,
        `### Active Trends`,
        ...(recentTrends ?? []).map(
          (t) => `- [${t.severity}] ${t.title}: ${t.description}`,
        ),
      ].join("\n");

      // Store as shared memory (available to all agents)
      await memoryManager.createSharedMemory({
        ticket_id: null,
        content: insightContent,
        summary: `Toby's daily analysis: ${techProfilesUpdated} tech profiles, ${customerInsightsUpdated} customer insights, ${trendsDetected} trends detected`,
        memory_type: "insight",
        confidence: 0.85,
        metadata: {
          source: "toby_flenderson",
          run_id: runId,
          date: new Date().toISOString().slice(0, 10),
        },
      });
      memoriesCreated++;

      // Update Michael's skill with latest tech + customer context
      // (deactivate old Toby skills, insert fresh ones)
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
          metadata: { source: "toby_flenderson", generated_at: new Date().toISOString() },
        });
        skillsUpdated++;
      }

      if ((customerData ?? []).length > 0) {
        const customerSkillContent = (customerData ?? [])
          .slice(0, 15) // Top 15 clients by ticket volume
          .map(
            (c) =>
              `**${c.client_name}**: ${c.summary ?? "No data"}. Top issues: ${c.top_issue_types?.join(", ") || "N/A"}.${c.recurring_issues?.length ? ` Recurring: ${c.recurring_issues.join(", ")}.` : ""}${c.update_request_count_30d > 2 ? ` ⚠ Frequent update requests (${c.update_request_count_30d} in 30d).` : ""}`,
          )
          .join("\n");

        await supabase.from("agent_skills").insert({
          agent_name: "michael_scott",
          title: "Toby's Customer Profiles",
          content: `Current client patterns and insights (updated ${new Date().toISOString().slice(0, 10)}):\n\n${customerSkillContent}\n\nUse these profiles to provide client-specific context during triage. Flag recurring issues and patterns.`,
          skill_type: "context",
          is_active: true,
          metadata: { source: "toby_flenderson", generated_at: new Date().toISOString() },
        });
        skillsUpdated++;
      }

      // Clear Michael's skill cache so he picks up new skills immediately
      skillLoader.clearCache("michael_scott");
    } catch (err) {
      console.error("[TOBY] Failed to feed insights to Michael:", err);
    }

    // ── Finalize ───────────────────────────────────────────────────
    const processingTimeMs = Date.now() - startTime;
    const summary = `Toby's daily analysis complete: ${techProfilesUpdated} tech profiles, ${customerInsightsUpdated} customer insights, ${trendsDetected} trends, ${triagesEvaluated} triage evals, ${memoriesCreated} memories, ${skillsUpdated} skills updated. ${tokensUsed} tokens in ${(processingTimeMs / 1000).toFixed(1)}s.`;

    console.log(`[TOBY] ${summary}`);

    // Update run log
    await supabase
      .from("toby_run_log")
      .update({
        completed_at: new Date().toISOString(),
        tickets_analyzed: tickets.length,
        tech_profiles_updated: techProfilesUpdated,
        customer_insights_updated: customerInsightsUpdated,
        trends_detected: trendsDetected,
        triages_evaluated: triagesEvaluated,
        memories_created: memoriesCreated,
        skills_updated: skillsUpdated,
        tokens_used: tokensUsed,
        processing_time_ms: processingTimeMs,
        status: "completed",
        summary,
      })
      .eq("id", runId);

    return {
      runId,
      techProfilesUpdated,
      customerInsightsUpdated,
      trendsDetected,
      triagesEvaluated,
      memoriesCreated,
      skillsUpdated,
      tokensUsed,
      processingTimeMs,
      summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[TOBY] Analysis failed:", message);

    await supabase
      .from("toby_run_log")
      .update({
        completed_at: new Date().toISOString(),
        status: "error",
        error_message: message,
        processing_time_ms: Date.now() - startTime,
      })
      .eq("id", runId);

    throw err;
  }
}
