import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

const MICHAEL_CHAT_PROMPT = `You are Michael Scott, the Regional Manager of Dunder Mifflin IT Triage at Gamma Tech Services LLC.

You are having a direct conversation with the admin/owner of Gamma Tech. You are their AI triage manager — knowledgeable, helpful, and you know the MSP business inside-out.

## Your personality in chat:
- Professional but personable — you know your stuff
- Direct and concise — no filler, every sentence has value
- You reference real data when available (ticket details, tech performance, client info)
- You can discuss tickets, triage decisions, tech performance, client patterns
- You learn from corrections — when the admin teaches you something, acknowledge it clearly

## What you can do:
- Discuss any ticket by number — pull context from the conversation
- Explain your triage reasoning and accept feedback
- Learn new skills/procedures when taught ("From now on, when you see X, do Y")
- Analyze patterns across tickets
- Suggest improvements to triage process
- Answer questions about clients, techs, integrations

## About Gamma Tech:
- MSP based in Naples, FL
- Domains: gtmail.us, gamma.tech
- Helpdesk: help@gamma.tech
- Bryanna is the sole dispatcher
- 4-8 technicians, no formal L1/L2/L3 tiers

## When the admin teaches you something:
If the admin says something like "remember this", "from now on", "when you see X do Y", "always/never do X":
1. Acknowledge what you learned
2. End your message with a line: [SKILL_LEARNED: brief description of what was taught]
This tag helps the system persist it. Only use it when genuinely taught something new.

## Format:
- Use markdown for formatting
- Keep responses focused and actionable
- Reference ticket numbers with # prefix
- Don't repeat information the admin already knows`;

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * POST /api/michael/chat
 * Send a message to Michael and get a streaming response.
 *
 * Body: { conversation_id?: string, message: string, ticket_context?: { halo_id, summary, details, triage } }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    conversation_id,
    message,
    ticket_context,
  } = body as {
    conversation_id?: string;
    message: string;
    ticket_context?: {
      halo_id?: number;
      summary?: string;
      client_name?: string;
      details?: string;
      triage?: string;
    };
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
      .from("michael_conversations")
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
    .from("michael_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(50);

  const messages: ChatMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Save user message
  await serviceClient.from("michael_messages").insert({
    conversation_id: convId,
    role: "user",
    content: message,
  });

  // Build system context with full system knowledge
  let systemPrompt = MICHAEL_CHAT_PROMPT;

  // ── Load all context in parallel ──
  const [
    { data: skills },
    { data: agentSkills },
    { data: techProfiles },
    { data: customerInsights },
    { data: recentTrends },
    { data: recentReviews },
    { data: openTicketStats },
    { data: integrations },
  ] = await Promise.all([
    serviceClient.from("michael_learned_skills").select("title, content").eq("is_active", true),
    serviceClient.from("agent_skills").select("title, content").eq("agent_name", "michael_scott").eq("is_active", true),
    serviceClient.from("tech_profiles").select("tech_name, avg_response_time, ticket_count, rating_breakdown, strong_categories, weak_categories, behavioral_patterns").order("updated_at", { ascending: false }),
    serviceClient.from("customer_insights").select("client_name, recurring_issues, top_issue_types, update_request_frequency, environment_notes").order("updated_at", { ascending: false }).limit(20),
    serviceClient.from("trend_detections").select("trend_type, title, description, severity, affected_clients, created_at").order("created_at", { ascending: false }).limit(10),
    serviceClient.from("tech_reviews").select("tech_name, halo_id, rating, response_time, summary, improvement_areas, created_at").order("created_at", { ascending: false }).limit(20),
    serviceClient.from("tickets").select("halo_status, halo_agent, client_name").is("tickettype_id", null).or("tickettype_id.eq.31"),
    serviceClient.from("integrations").select("service, is_active").eq("is_active", true),
  ]);

  // Learned skills
  if (skills && skills.length > 0) {
    systemPrompt += "\n\n## Skills You've Been Taught:\n";
    for (const skill of skills) {
      systemPrompt += `- **${skill.title}**: ${skill.content}\n`;
    }
  }

  // Agent skills
  if (agentSkills && agentSkills.length > 0) {
    systemPrompt += "\n\n## Your Operational Knowledge:\n";
    for (const skill of agentSkills) {
      systemPrompt += `### ${skill.title}\n${skill.content}\n\n`;
    }
  }

  // Tech performance profiles
  if (techProfiles && techProfiles.length > 0) {
    systemPrompt += "\n\n## Tech Team Performance:\n";
    for (const tp of techProfiles) {
      systemPrompt += `\n**${tp.tech_name}**: ${tp.ticket_count ?? 0} tickets, avg response: ${tp.avg_response_time ?? "N/A"}`;
      if (tp.rating_breakdown) systemPrompt += `, ratings: ${JSON.stringify(tp.rating_breakdown)}`;
      if (tp.strong_categories) systemPrompt += `\n  Strong: ${tp.strong_categories}`;
      if (tp.weak_categories) systemPrompt += `\n  Weak: ${tp.weak_categories}`;
      if (tp.behavioral_patterns) systemPrompt += `\n  Patterns: ${tp.behavioral_patterns}`;
      systemPrompt += "\n";
    }
  }

  // Customer insights
  if (customerInsights && customerInsights.length > 0) {
    systemPrompt += "\n\n## Customer Insights:\n";
    for (const ci of customerInsights) {
      systemPrompt += `\n**${ci.client_name}**:`;
      if (ci.recurring_issues) systemPrompt += ` Recurring: ${ci.recurring_issues}`;
      if (ci.top_issue_types) systemPrompt += ` | Top issues: ${ci.top_issue_types}`;
      if (ci.update_request_frequency) systemPrompt += ` | Update requests: ${ci.update_request_frequency}`;
      if (ci.environment_notes) systemPrompt += ` | Env: ${ci.environment_notes}`;
      systemPrompt += "\n";
    }
  }

  // Recent trends
  if (recentTrends && recentTrends.length > 0) {
    systemPrompt += "\n\n## Recent Trends (Toby's analysis):\n";
    for (const t of recentTrends) {
      systemPrompt += `- [${t.severity}] **${t.title}**: ${t.description}`;
      if (t.affected_clients) systemPrompt += ` (Clients: ${t.affected_clients})`;
      systemPrompt += "\n";
    }
  }

  // Recent tech reviews
  if (recentReviews && recentReviews.length > 0) {
    systemPrompt += "\n\n## Recent Tech Reviews:\n";
    for (const r of recentReviews) {
      systemPrompt += `- #${r.halo_id} **${r.tech_name}**: ${r.rating} (response: ${r.response_time ?? "N/A"}) — ${r.summary ?? ""}`;
      if (r.improvement_areas) systemPrompt += ` [Improve: ${r.improvement_areas}]`;
      systemPrompt += "\n";
    }
  }

  // Open ticket summary
  if (openTicketStats && openTicketStats.length > 0) {
    const resolvedStatuses = ["closed", "resolved", "cancelled", "completed", "resolved remotely", "resolved onsite", "resolved - awaiting confirmation"];
    const openTickets = openTicketStats.filter((t) => !t.halo_status || !resolvedStatuses.includes(t.halo_status.toLowerCase()));
    const byTech: Record<string, number> = {};
    const byClient: Record<string, number> = {};
    for (const t of openTickets) {
      const tech = t.halo_agent ?? "Unassigned";
      const client = t.client_name ?? "Unknown";
      byTech[tech] = (byTech[tech] ?? 0) + 1;
      byClient[client] = (byClient[client] ?? 0) + 1;
    }
    systemPrompt += `\n\n## Current Open Tickets: ${openTickets.length}\n`;
    systemPrompt += `By tech: ${Object.entries(byTech).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}: ${count}`).join(", ")}\n`;
    systemPrompt += `Top clients: ${Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => `${name}: ${count}`).join(", ")}\n`;
  }

  // Active integrations
  if (integrations && integrations.length > 0) {
    systemPrompt += `\n\n## Active Integrations: ${integrations.map((i) => i.service).join(", ")}\n`;
  }

  // ── Auto-detect ticket numbers (#XXXXX) in the message ──
  const ticketNumbers = [...message.matchAll(/#(\d{4,6})/g)].map((m) => parseInt(m[1], 10));

  if (ticketNumbers.length > 0) {
    const { data: tickets } = await serviceClient
      .from("tickets")
      .select("halo_id, summary, client_name, details, halo_status, halo_agent, triage_results(internal_notes, classification, urgency_score, recommended_priority, findings, created_at)")
      .in("halo_id", ticketNumbers)
      .order("created_at", { referencedTable: "triage_results", ascending: false });

    if (tickets && tickets.length > 0) {
      systemPrompt += "\n\n## Mentioned Tickets (from database):\n";
      for (const t of tickets) {
        systemPrompt += `\n### Ticket #${t.halo_id}\n`;
        systemPrompt += `- **Summary**: ${t.summary}\n`;
        if (t.client_name) systemPrompt += `- **Client**: ${t.client_name}\n`;
        if (t.halo_status) systemPrompt += `- **Status**: ${t.halo_status}\n`;
        if (t.halo_agent) systemPrompt += `- **Assigned Tech**: ${t.halo_agent}\n`;
        if (t.details) systemPrompt += `- **Details**: ${t.details.slice(0, 1500)}\n`;

        const triageResults = (t.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
        const latest = triageResults[0];
        if (latest) {
          const notes = Array.isArray(latest.internal_notes) ? (latest.internal_notes as string[]).join("\n") : String(latest.internal_notes ?? "");
          const classification = latest.classification as Record<string, string> | null;
          systemPrompt += `\n**Triage:** ${classification ? `${classification.type}/${classification.subtype}` : "N/A"}, Urgency: ${latest.urgency_score}/5, P${latest.recommended_priority}\n`;
          if (notes) systemPrompt += `**Notes:** ${notes}\n`;
        }

        // Tech review
        const { data: review } = await serviceClient
          .from("tech_reviews")
          .select("rating, response_time, summary, improvement_areas")
          .eq("halo_id", t.halo_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (review) {
          systemPrompt += `**Tech Review:** ${review.rating} (response: ${review.response_time}) — ${review.summary ?? ""}`;
          if (review.improvement_areas) systemPrompt += ` [Improve: ${review.improvement_areas}]`;
          systemPrompt += "\n";
        }
      }
    }
  } else if (ticket_context) {
    systemPrompt += `\n\n## Current Ticket Context:\n`;
    if (ticket_context.halo_id) systemPrompt += `- Ticket #${ticket_context.halo_id}\n`;
    if (ticket_context.summary) systemPrompt += `- Summary: ${ticket_context.summary}\n`;
    if (ticket_context.client_name) systemPrompt += `- Client: ${ticket_context.client_name}\n`;
    if (ticket_context.details) systemPrompt += `- Details: ${ticket_context.details.slice(0, 2000)}\n`;
    if (ticket_context.triage) systemPrompt += `\n### Latest Triage:\n${ticket_context.triage.slice(0, 3000)}\n`;
  }

  // Add current messages including the new one
  messages.push({ role: "user", content: message });

  // Stream response from Claude
  const client = new Anthropic();

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  // Create a readable stream for the response
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullResponse = "";

      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullResponse += event.delta.text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`),
            );
          }
        }

        // Save assistant message
        await serviceClient.from("michael_messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: fullResponse,
        });

        // Update conversation title if this is the first exchange
        if (!conversation_id) {
          // Use first ~60 chars of user message as title
          const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
          await serviceClient
            .from("michael_conversations")
            .update({ title, updated_at: new Date().toISOString() })
            .eq("id", convId);
        } else {
          await serviceClient
            .from("michael_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", convId);
        }

        // Check if Michael learned a skill
        const skillMatch = fullResponse.match(/\[SKILL_LEARNED:\s*(.+?)\]/);
        if (skillMatch) {
          const skillTitle = skillMatch[1].trim();
          // Extract the teaching content from the user's message
          await serviceClient.from("michael_learned_skills").insert({
            title: skillTitle,
            content: message,
            source_conversation_id: convId,
            taught_by: auth.user.id,
          });
        }

        // Send done event with conversation ID
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId })}\n\n`),
        );
        controller.close();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
