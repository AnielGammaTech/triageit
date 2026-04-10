import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

const TOBY_CHAT_PROMPT = `You are Toby Flenderson, the HR/analytics agent at Gamma Tech Services LLC (an MSP in Naples, FL).

You are the owner's brutal truth machine. You see everything — every ticket, every tech's response time, every customer pattern — and you tell it like it is. No sugarcoating. No "they're doing their best." Just data and honest assessment.

## Your personality:
- **Brutally honest.** If a tech is failing, you say it directly: "Matthew has a 4.2-hour average response time this week. That's unacceptable. The standard is under 1 hour." You don't soften bad news.
- **Data-obsessed.** Every claim comes with numbers. Not "they're slow" but "3 tickets with 4+ hour gaps, 2 customer update requests ignored."
- **Standards-driven.** You know what good looks like and you measure everyone against it:
  - First response: under 1 hour during business hours
  - Customer-visible update: every 4 hours for active tickets
  - Internal documentation: every ticket should have tech notes explaining what was done
  - No ticket should sit in "New" for more than 2 hours
- **Pattern detector.** You connect dots — "This is the 4th printer ticket from NABOR this month. Either the printer needs replacing or the tech isn't fixing the root cause."
- **Occasionally Toby.** Dry humor. "Nobody wants to hear from HR... but here I am with the numbers that prove you need to."
- **Protective of the business.** When customers are waiting and techs aren't responding, you flag it as a business risk, not just a metric.

## What you evaluate:
- **Response times** — How fast does each tech respond after a customer message? Compare to the 1-hour standard.
- **Workload balance** — Is one tech overloaded while another has 2 tickets? Flag imbalances.
- **Customer satisfaction signals** — Update requests = customer frustration. Track who generates the most.
- **Documentation quality** — Are techs leaving notes? Or are tickets closing with zero internal documentation?
- **Ticket aging** — What's sitting open too long? What's in "New" with no tech activity?
- **Recurring issues** — Same client, same problem, multiple times = root cause not addressed.
- **Triage accuracy** — Is the AI pipeline correctly classifying and routing tickets?

## How you report:
- Lead with the verdict: "Matthew is underperforming this week" or "The team is meeting standards across the board"
- Back it up with specific numbers and ticket references
- Compare to standards and to other techs on the team
- Call out both failures AND wins — credit where it's due
- End with specific recommendations: "Reassign #34875 to someone who will act on it today"

## Team Roster (KNOW THIS):
**Techs (6):** Dylan Henjum, Raul Tapanes, Jarid Carlson, Matthew Lawyer, Ryan Fitzpatrick, Darren Davillier
**Triage/Dispatcher:** Bryanna — assigns tickets, NOT a tech
**Helpdesk Manager:** David — manages the helpdesk team
**Project Manager:** Jonathan — project work only
**Sales/Account Managers:** Roman Hernandez, Todd — they are NOT techs. Do NOT evaluate them on ticket response times or tech performance.
**Owner:** Aniel — the admin you're talking to

IMPORTANT: Only evaluate the 6 techs on ticket performance. If Roman or Todd appear in ticket data, they're sales — ignore them in tech analysis.

## CRITICAL:
- ONLY state facts from tool results. NEVER fabricate dates, numbers, or details.
- If you can't find data, say so. Don't fill gaps with assumptions.
- Always use your tools — don't answer from the system context alone. Pull fresh data.
- Today: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" })}

## Format:
- Use markdown for formatting
- Use tables when comparing techs or time periods
- Bold the verdicts and key numbers
- Reference ticket numbers with # prefix
- Be concise but complete — the owner is busy

## ABSOLUTE RULE — ZERO FABRICATION:
1. **EVERY number must come from a tool result.** If the tool says 11 tickets, you say 11. Not 52. Not 327. EXACTLY what the tool returned.
2. **NEVER extrapolate or estimate.** Don't round up, don't add numbers together unless the tool gave you the total.
3. **NEVER fill gaps.** If the data doesn't show something, say "I don't have that" and use a tool.
4. **Use tools FIRST.** Don't answer from the system context snapshot. Always pull fresh data with your tools before making claims.
5. **If caught fabricating, you've failed.** The admin relies on you for real data. Making up numbers destroys trust instantly.`;

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const { conversation_id, message } = body as {
    conversation_id?: string;
    message: string;
  };

  if (!message?.trim()) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  // Get or create conversation
  let convId = conversation_id;
  if (!convId) {
    const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
    const { data: conv, error: convError } = await serviceClient
      .from("toby_conversations")
      .insert({ user_id: auth.user.id, title })
      .select("id")
      .single();

    if (convError || !conv) {
      return Response.json({ error: "Failed to create conversation" }, { status: 500 });
    }
    convId = conv.id;
  }

  // Load conversation history
  const { data: history } = await serviceClient
    .from("toby_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(50);

  const messages: ChatMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Save user message
  await serviceClient.from("toby_messages").insert({
    conversation_id: convId,
    role: "user",
    content: message,
  });

  // Build system prompt with context
  let systemPrompt = TOBY_CHAT_PROMPT;

  // Load Toby's latest analysis data summaries (graceful — don't crash if tables are empty)
  let techProfiles: Array<Record<string, unknown>> = [];
  let customerInsights: Array<Record<string, unknown>> = [];
  let recentTrends: Array<Record<string, unknown>> = [];
  let openTicketCount = 0;

  try {
    const [tp, ci, rt, tc] = await Promise.all([
      serviceClient.from("tech_profiles").select("tech_name, avg_response_hours, ticket_count, rating_breakdown, strong_categories, weak_categories").order("updated_at", { ascending: false }).limit(10),
      serviceClient.from("customer_insights").select("client_name, ticket_count, top_issue_types, update_request_count").order("updated_at", { ascending: false }).limit(10),
      serviceClient.from("trend_detections").select("trend_type, description, severity, created_at").order("created_at", { ascending: false }).limit(5),
      serviceClient.from("tickets").select("id", { count: "exact", head: true }).or("halo_status.is.null,halo_status.not.ilike.%closed%,halo_status.not.ilike.%resolved%,halo_status.not.ilike.%cancelled%"),
    ]);
    techProfiles = (tp.data ?? []) as Array<Record<string, unknown>>;
    customerInsights = (ci.data ?? []) as Array<Record<string, unknown>>;
    recentTrends = (rt.data ?? []) as Array<Record<string, unknown>>;
    openTicketCount = tc.count ?? 0;
  } catch {
    // Non-critical — Toby can still work without cached profiles
  }

  systemPrompt += `\n\n## Current Data Snapshot (use tools for deeper dives):\n`;
  systemPrompt += `- Open tickets: ~${openTicketCount ?? 0}\n`;

  if (techProfiles && techProfiles.length > 0) {
    systemPrompt += "\n### Tech Profiles:\n";
    for (const tp of techProfiles) {
      const avgH = typeof tp.avg_response_hours === "number" ? tp.avg_response_hours.toFixed(1) : "?";
      systemPrompt += `- **${String(tp.tech_name ?? "?")}**: ${String(tp.ticket_count ?? "?")} tickets, avg response ${avgH}h, strong: ${String(tp.strong_categories ?? "?")}, weak: ${String(tp.weak_categories ?? "?")}\n`;
    }
  }

  if (customerInsights && customerInsights.length > 0) {
    systemPrompt += "\n### Top Clients:\n";
    for (const ci of customerInsights) {
      systemPrompt += `- **${String(ci.client_name ?? "?")}**: ${String(ci.ticket_count ?? "?")} tickets, top issues: ${String(ci.top_issue_types ?? "?")}, update requests: ${String(ci.update_request_count ?? 0)}\n`;
    }
  }

  if (recentTrends && recentTrends.length > 0) {
    systemPrompt += "\n### Recent Trends:\n";
    for (const t of recentTrends) {
      systemPrompt += `- [${String(t.severity ?? "?")}] ${String(t.trend_type ?? "?")}: ${String(t.description ?? "?")}\n`;
    }
  }

  // Auto-detect ticket numbers
  const ticketNumbers = [...message.matchAll(/#(\d{4,6})/g)].map((m) => parseInt(m[1], 10));
  if (ticketNumbers.length > 0) {
    const { data: tickets } = await serviceClient
      .from("tickets")
      .select("halo_id, summary, client_name, halo_status, halo_agent, triage_results(internal_notes, classification, urgency_score, recommended_priority, created_at)")
      .in("halo_id", ticketNumbers)
      .order("created_at", { referencedTable: "triage_results", ascending: false });

    if (tickets && tickets.length > 0) {
      systemPrompt += "\n\n## Mentioned Tickets:\n";
      for (const t of tickets) {
        systemPrompt += `- **#${t.halo_id}**: ${t.summary} | ${t.client_name ?? "?"} | ${t.halo_status ?? "?"} | Tech: ${t.halo_agent ?? "Unassigned"}\n`;
      }
    }
  }

  messages.push({ role: "user", content: message });

  // Toby's analytics tools
  const tools: Anthropic.Messages.Tool[] = [
    {
      name: "get_tech_performance",
      description: "Deep dive on a technician's performance: assigned tickets, response times, reviews, patterns, strengths, and areas for improvement.",
      input_schema: {
        type: "object" as const,
        properties: {
          tech_name: { type: "string", description: "The tech's name (partial match)" },
          days_back: { type: "number", description: "Analysis window in days (default: 30)" },
        },
        required: ["tech_name"],
      },
    },
    {
      name: "get_client_analysis",
      description: "Full client analysis: ticket history, recurring issues, assigned techs, resolution patterns, satisfaction signals.",
      input_schema: {
        type: "object" as const,
        properties: {
          client_name: { type: "string", description: "The client/company name (partial match)" },
        },
        required: ["client_name"],
      },
    },
    {
      name: "search_tickets",
      description: "Search tickets with filters to find patterns. Use for questions like 'how many tickets this week?' or 'what email issues have we had?'",
      input_schema: {
        type: "object" as const,
        properties: {
          client_name: { type: "string", description: "Filter by client (partial match)" },
          tech_name: { type: "string", description: "Filter by tech (partial match)" },
          status: { type: "string", description: "Filter by halo_status" },
          keyword: { type: "string", description: "Search in summary and details" },
          days_back: { type: "number", description: "Only tickets from last N days (default: 30)" },
          limit: { type: "number", description: "Max results (default: 20)" },
        },
        required: [],
      },
    },
    {
      name: "lookup_ticket",
      description: "Look up detailed ticket info including triage results, tech review, and status.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number", description: "The Halo ticket number" },
        },
        required: ["halo_id"],
      },
    },
    {
      name: "get_team_overview",
      description: "Overview of the entire tech team: workload distribution, average response times, review ratings, and who needs attention.",
      input_schema: {
        type: "object" as const,
        properties: {
          days_back: { type: "number", description: "Analysis window in days (default: 7)" },
        },
        required: [],
      },
    },
    {
      name: "get_triage_accuracy",
      description: "Evaluate triage system accuracy: compare AI predictions vs actual outcomes for resolved tickets.",
      input_schema: {
        type: "object" as const,
        properties: {
          days_back: { type: "number", description: "Analysis window in days (default: 30)" },
        },
        required: [],
      },
    },
    {
      name: "run_fresh_analysis",
      description: "Trigger a fresh Toby analysis run to update all profiles, insights, and trends. Takes a few minutes.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];

  // Tool execution
  async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";
    const formatDate = (iso: string | null | undefined): string => {
      if (!iso) return "?";
      return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    };

    switch (name) {
      case "get_tech_performance": {
        const techName = input.tech_name as string;
        const daysBack = (input.days_back as number) ?? 30;
        const since = new Date(Date.now() - daysBack * 86400000).toISOString();

        const [{ data: tickets }, { data: reviews }, { data: profile }] = await Promise.all([
          serviceClient.from("tickets").select("halo_id, summary, client_name, halo_status, created_at").ilike("halo_agent", `%${techName}%`).gte("created_at", since).order("created_at", { ascending: false }).limit(30),
          serviceClient.from("tech_reviews").select("halo_id, rating, response_time, summary, improvement_areas, max_gap_hours, created_at").ilike("tech_name", `%${techName}%`).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
          serviceClient.from("tech_profiles").select("*").ilike("tech_name", `%${techName}%`).limit(1).maybeSingle(),
        ]);

        let result = `## Tech Analysis: ${techName} (last ${daysBack} days)\n\n`;

        if (profile) {
          result += `**Profile:** ${profile.ticket_count} total tickets, avg response ${profile.avg_response_hours?.toFixed(1) ?? "?"}h\n`;
          result += `Strong: ${profile.strong_categories ?? "none"} | Weak: ${profile.weak_categories ?? "none"}\n\n`;
        }

        result += `**Recent Tickets (${tickets?.length ?? 0}):**\n`;
        for (const t of tickets ?? []) {
          result += `- #${t.halo_id}: ${t.summary} [${t.halo_status ?? "?"}] (${formatDate(t.created_at)})\n`;
        }

        result += `\n**Reviews (${reviews?.length ?? 0}):**\n`;
        const ratingCounts: Record<string, number> = {};
        for (const r of reviews ?? []) {
          ratingCounts[r.rating] = (ratingCounts[r.rating] ?? 0) + 1;
          result += `- #${r.halo_id}: ${r.rating} (response: ${r.response_time}, gap: ${r.max_gap_hours?.toFixed(1) ?? "?"}h) — ${r.summary ?? ""}\n`;
        }
        result += `\nRating breakdown: ${JSON.stringify(ratingCounts)}\n`;

        return result;
      }

      case "get_client_analysis": {
        const clientName = input.client_name as string;

        const [{ data: tickets }, { data: insights }] = await Promise.all([
          serviceClient.from("tickets").select("halo_id, summary, halo_status, halo_agent, created_at").ilike("client_name", `%${clientName}%`).order("created_at", { ascending: false }).limit(30),
          serviceClient.from("customer_insights").select("*").ilike("client_name", `%${clientName}%`).limit(1).maybeSingle(),
        ]);

        let result = `## Client Analysis: ${clientName}\n\n`;

        if (insights) {
          result += `**Insights:** ${insights.ticket_count} total tickets, update requests: ${insights.update_request_count}\n`;
          result += `Top issues: ${insights.top_issue_types ?? "?"}\n\n`;
        }

        result += `**Recent Tickets (${tickets?.length ?? 0}):**\n`;
        for (const t of tickets ?? []) {
          result += `- #${t.halo_id}: ${t.summary} [${t.halo_status ?? "?"}] Tech: ${t.halo_agent ?? "Unassigned"} (${formatDate(t.created_at)})\n`;
        }

        return result;
      }

      case "search_tickets": {
        const daysBack = (input.days_back as number) ?? 30;
        const limit = Math.min((input.limit as number) ?? 20, 50);
        const since = new Date(Date.now() - daysBack * 86400000).toISOString();

        let query = serviceClient.from("tickets").select("halo_id, summary, client_name, halo_status, halo_agent, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);

        if (input.client_name) query = query.ilike("client_name", `%${input.client_name}%`);
        if (input.tech_name) query = query.ilike("halo_agent", `%${input.tech_name}%`);
        if (input.status) query = query.ilike("halo_status", `%${input.status}%`);
        if (input.keyword) query = query.or(`summary.ilike.%${input.keyword}%,details.ilike.%${input.keyword}%`);

        const { data: tickets } = await query;

        let result = `Found ${tickets?.length ?? 0} tickets (last ${daysBack} days):\n\n`;
        for (const t of tickets ?? []) {
          result += `- **#${t.halo_id}**: ${t.summary} | ${t.client_name ?? "?"} | ${t.halo_status ?? "?"} | ${t.halo_agent ?? "Unassigned"} | ${formatDate(t.created_at)}\n`;
        }
        return result;
      }

      case "lookup_ticket": {
        const haloId = input.halo_id as number;
        const { data: ticket } = await serviceClient
          .from("tickets")
          .select("halo_id, summary, client_name, details, halo_status, halo_agent, created_at, triage_results(internal_notes, classification, urgency_score, recommended_priority, created_at)")
          .eq("halo_id", haloId)
          .order("created_at", { referencedTable: "triage_results", ascending: false })
          .single();

        if (!ticket) return `Ticket #${haloId} not found.`;

        let result = `**#${ticket.halo_id}**: ${ticket.summary}\n`;
        result += `Client: ${ticket.client_name ?? "?"} | Status: ${ticket.halo_status ?? "?"} | Tech: ${ticket.halo_agent ?? "Unassigned"}\n`;
        if (ticket.details) result += `Details: ${ticket.details.slice(0, 1000)}\n`;

        const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
        const latest = triageResults[0];
        if (latest) {
          const classification = latest.classification as Record<string, string> | null;
          result += `\nTriage: ${classification ? `${classification.type}/${classification.subtype}` : "N/A"}, Urgency: ${latest.urgency_score}/5, P${latest.recommended_priority}\n`;
          const notes = String(latest.internal_notes ?? "");
          if (notes) result += `Notes: ${notes.slice(0, 1500)}\n`;
        }

        return result;
      }

      case "get_team_overview": {
        const daysBack = (input.days_back as number) ?? 7;
        const since = new Date(Date.now() - daysBack * 86400000).toISOString();

        const [{ data: openTickets }, { data: recentTickets }, { data: reviews }] = await Promise.all([
          // Currently open Gamma Default tickets only
          serviceClient.from("tickets").select("halo_agent, halo_status").eq("tickettype_id", 31).eq("halo_is_open", true),
          // Tickets created in the period (for volume tracking)
          serviceClient.from("tickets").select("halo_agent, halo_status, halo_is_open").eq("tickettype_id", 31).gte("created_at", since),
          serviceClient.from("tech_reviews").select("tech_name, rating, response_time, max_gap_hours").gte("created_at", since),
        ]);

        // Workload by tech — based on currently open tickets
        const workload: Record<string, { total: number; open: number }> = {};
        for (const t of recentTickets ?? []) {
          const tech = t.halo_agent ?? "Unassigned";
          if (!workload[tech]) workload[tech] = { total: 0, open: 0 };
          workload[tech].total++;
        }
        // Open count from the live open query
        for (const t of openTickets ?? []) {
          const tech = t.halo_agent ?? "Unassigned";
          if (!workload[tech]) workload[tech] = { total: 0, open: 0 };
          workload[tech].open++;
        }

        // Review stats by tech
        const reviewStats: Record<string, { count: number; ratings: Record<string, number> }> = {};
        for (const r of reviews ?? []) {
          const tech = r.tech_name ?? "Unknown";
          if (!reviewStats[tech]) reviewStats[tech] = { count: 0, ratings: {} };
          reviewStats[tech].count++;
          reviewStats[tech].ratings[r.rating] = (reviewStats[tech].ratings[r.rating] ?? 0) + 1;
        }

        let result = `## Team Overview (last ${daysBack} days)\n\n`;
        result += `| Tech | Tickets | Open | Reviews | Ratings |\n|------|---------|------|---------|---------|\n`;
        for (const [tech, w] of Object.entries(workload).sort((a, b) => b[1].total - a[1].total)) {
          const rs = reviewStats[tech];
          result += `| ${tech} | ${w.total} | ${w.open} | ${rs?.count ?? 0} | ${rs ? JSON.stringify(rs.ratings) : "-"} |\n`;
        }

        return result;
      }

      case "get_triage_accuracy": {
        const daysBack = (input.days_back as number) ?? 30;
        const { data: evals } = await serviceClient
          .from("triage_evaluations")
          .select("*")
          .gte("created_at", new Date(Date.now() - daysBack * 86400000).toISOString())
          .order("created_at", { ascending: false })
          .limit(20);

        if (!evals || evals.length === 0) return "No triage evaluations found. Run a fresh analysis to generate them.";

        let result = `## Triage Accuracy (last ${daysBack} days, ${evals.length} evaluations)\n\n`;
        for (const e of evals) {
          result += `- ${JSON.stringify(e)}\n`;
        }
        return result;
      }

      case "run_fresh_analysis": {
        const res = await fetch(`${workerUrl}/toby/analyze`, { method: "POST" });
        return res.ok
          ? "Fresh analysis triggered. I'll update tech profiles, customer insights, and trend detections. This takes a few minutes."
          : `Failed to trigger analysis: ${await res.text()}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  // Streaming response with tool use loop
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const anthropic = new Anthropic();
        let currentMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let model = "";

        // Tool use loop
        for (let iteration = 0; iteration < 10; iteration++) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages: currentMessages,
          });

          model = response.model;
          totalInputTokens += response.usage.input_tokens;
          totalOutputTokens += response.usage.output_tokens;

          // Process response blocks
          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === "text" && block.text) {
              send({ text: block.text });
            }

            if (block.type === "tool_use") {
              send({ status: `Querying ${block.name}...`, worker: block.name, phase: "running" });

              const result = await executeTool(block.name, block.input as Record<string, unknown>);

              send({ status: `${block.name} complete`, worker: block.name, phase: "completed" });

              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.slice(0, 10000),
              });
            }
          }

          // If there were tool uses, continue the conversation
          if (toolResults.length > 0) {
            currentMessages = [
              ...currentMessages,
              { role: "assistant", content: response.content },
              { role: "user", content: toolResults },
            ];
            continue;
          }

          // No more tool calls — we're done
          const fullText = response.content
            .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");

          // Calculate cost
          const inputCost = totalInputTokens * 0.003 / 1000;
          const outputCost = totalOutputTokens * 0.015 / 1000;

          // Save assistant response
          await serviceClient.from("toby_messages").insert({
            conversation_id: convId,
            role: "assistant",
            content: fullText,
            metadata: {
              model,
              input_tokens: totalInputTokens,
              output_tokens: totalOutputTokens,
              cost_usd: inputCost + outputCost,
            },
          });

          // Update conversation
          await serviceClient
            .from("toby_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", convId);

          send({
            done: true,
            conversation_id: convId,
            model,
            usage: {
              input_tokens: totalInputTokens,
              output_tokens: totalOutputTokens,
              cost_usd: inputCost + outputCost,
            },
          });

          break;
        }
      } catch (err) {
        send({ error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
