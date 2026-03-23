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
- Discuss any ticket by number — use lookup_ticket first, and if not found, use fetch_from_halo to pull it directly from Halo and import it
- Explain your triage reasoning and accept feedback
- Learn new skills/procedures when taught ("From now on, when you see X, do Y")
- Analyze patterns across tickets — use get_dashboard for detailed stats
- Suggest improvements to triage process
- Answer questions about clients, techs, integrations
- **Delegate tasks to your workers** — you manage a team of specialist agents. When the admin asks you to do something actionable, use the appropriate tool to delegate it.

## IMPORTANT — Token efficiency:
- For simple questions (ticket lookup, status check), just use the lookup tool and respond concisely
- Only call get_dashboard when the admin asks about team performance, patterns, or operational metrics
- Don't load heavy context you don't need — keep responses focused and efficient

## Your Team (specialist agents you manage):
- **Ryan Howard** — Classifier. Categorizes tickets by type/subtype, urgency, and security flags.
- **Dwight Schrute** — Hudu documentation & asset lookup. Always runs. Pulls client docs, network diagrams, known issues.
- **Angela Martin** — Security assessment. Flags security concerns and compliance issues.
- **Jim Halpert** — JumpCloud identity & access. Checks user accounts, MFA status, group membership.
- **Andy Bernard** — Datto RMM endpoints. Pulls device health, alerts, patch status.
- **Kelly Kapoor** — 3CX/Twilio telephony. Checks phone system status and call routing.
- **Stanley Hudson** — Vultr cloud infrastructure. Monitors VPS health and resource usage.
- **Phyllis Vance** — Email/DNS (MX Toolbox + DMARC). Checks mail flow, DNS records, deliverability.
- **Meredith Palmer** — Spanning M365 backup. Verifies backup status and coverage.
- **Oscar Martinez** — Cove backup. Checks backup jobs and restore points.
- **Darryl Philbin** — CIPP M365 management. Manages licenses, conditional access, tenant config.
- **Creed Bratton** — UniFi networking. Checks AP status, client connections, network health.
- **Erin Hannon** — Alert summarizer. Handles automated monitoring alerts quickly.
- **Toby Flenderson** — Analytics. Runs daily analysis of tech performance, customer patterns, and triage accuracy.

When you reference your team, be natural about it — "I'll have Dwight pull the Hudu docs for that client" or "Let me get Andy to check the device in Datto."

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

  // ── Load only lightweight context into system prompt ──
  // Heavy data (tech profiles, customer insights, reviews, trends) are available
  // via on-demand tools to keep token usage low.
  const [
    { data: skills },
    { data: agentSkills },
    { data: integrations },
    { count: openTicketCount },
  ] = await Promise.all([
    serviceClient.from("michael_learned_skills").select("title, content").eq("is_active", true),
    serviceClient.from("agent_skills").select("title, content").eq("agent_name", "michael_scott").eq("is_active", true),
    serviceClient.from("integrations").select("service, is_active").eq("is_active", true),
    serviceClient.from("tickets").select("id", { count: "exact", head: true }).or("halo_status.is.null,halo_status.not.ilike.%closed%,halo_status.not.ilike.%resolved%,halo_status.not.ilike.%cancelled%"),
  ]);

  // Learned skills (these are small and directly relevant)
  if (skills && skills.length > 0) {
    systemPrompt += "\n\n## Skills You've Been Taught:\n";
    for (const skill of skills) {
      systemPrompt += `- **${skill.title}**: ${skill.content}\n`;
    }
  }

  // Agent skills (operational knowledge from Toby — kept because it shapes behavior)
  if (agentSkills && agentSkills.length > 0) {
    systemPrompt += "\n\n## Your Operational Knowledge:\n";
    for (const skill of agentSkills) {
      systemPrompt += `### ${skill.title}\n${skill.content}\n\n`;
    }
  }

  // Lightweight summary — details available via tools
  systemPrompt += `\n\n## Quick Stats:\n`;
  systemPrompt += `- Open tickets: ~${openTicketCount ?? 0}\n`;
  if (integrations && integrations.length > 0) {
    systemPrompt += `- Active integrations: ${integrations.map((i) => i.service).join(", ")}\n`;
  }
  systemPrompt += `\nUse the **get_dashboard** tool to see tech workload, customer breakdown, recent trends, and tech reviews when the conversation needs that context. Don't load it preemptively.\n`;

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

  // Define tools Michael can use to delegate tasks
  const tools: Anthropic.Messages.Tool[] = [
    {
      name: "retriage_ticket",
      description: "Retriage a ticket through the full AI pipeline. Use when the admin asks you to retriage, re-evaluate, or re-process a specific ticket.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number", description: "The Halo ticket number (e.g. 33722)" },
        },
        required: ["halo_id"],
      },
    },
    {
      name: "lookup_ticket",
      description: "Look up detailed information about a ticket including triage results, tech review, and current status. Use when you need more context about a ticket.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number", description: "The Halo ticket number" },
        },
        required: ["halo_id"],
      },
    },
    {
      name: "run_toby_analysis",
      description: "Trigger Toby Flenderson's analytics run to refresh tech profiles, customer insights, and trend detections. Use when the admin asks for fresh analytics or to update performance data.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "pull_tickets",
      description: "Sync all open Gamma Default tickets from Halo. Use when the admin wants to refresh the ticket list or catch missed tickets.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "fetch_from_halo",
      description: "Fetch a ticket directly from Halo PSA API and import it into TriageIt if missing. Use when a ticket isn't found in the local database — it might have been missed by the webhook or sync. This will pull the ticket from Halo and queue it for triage.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number", description: "The Halo ticket number to fetch" },
        },
        required: ["halo_id"],
      },
    },
    {
      name: "get_dashboard",
      description: "Get detailed dashboard data: tech workload, customer breakdown, recent trends, tech reviews, and performance profiles. Use when the conversation needs specifics about team performance, client patterns, or operational metrics. Do NOT call this for simple ticket lookups.",
      input_schema: {
        type: "object" as const,
        properties: {
          sections: {
            type: "array",
            items: { type: "string", enum: ["tech_workload", "tech_profiles", "customer_insights", "trends", "reviews"] },
            description: "Which sections to load. Omit to load all. Pick only what's relevant to the question.",
          },
        },
        required: [],
      },
    },
  ];

  // Tool execution helper
  async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";

    switch (name) {
      case "retriage_ticket": {
        const haloId = input.halo_id as number;
        const { data: ticket } = await serviceClient
          .from("tickets")
          .select("id")
          .eq("halo_id", haloId)
          .single();

        if (!ticket) return `Ticket #${haloId} not found in the system.`;

        const res = await fetch(`${workerUrl}/triage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: ticket.id, haloId }),
        });
        return res.ok
          ? `Retriage queued for ticket #${haloId}. The pipeline will run Ryan's classification, then route to the relevant specialists.`
          : `Failed to queue retriage for #${haloId}: ${await res.text()}`;
      }

      case "lookup_ticket": {
        const haloId = input.halo_id as number;
        const { data: ticket } = await serviceClient
          .from("tickets")
          .select("halo_id, summary, client_name, details, halo_status, halo_agent, created_at, triage_results(internal_notes, classification, urgency_score, recommended_priority, findings, created_at)")
          .eq("halo_id", haloId)
          .order("created_at", { referencedTable: "triage_results", ascending: false })
          .single();

        if (!ticket) return `Ticket #${haloId} not found in local database. Use the fetch_from_halo tool to pull it directly from Halo PSA and import it.`;

        let result = `**#${ticket.halo_id}**: ${ticket.summary}\n`;
        result += `Client: ${ticket.client_name ?? "Unknown"} | Status: ${ticket.halo_status ?? "Unknown"} | Tech: ${ticket.halo_agent ?? "Unassigned"}\n`;
        if (ticket.details) result += `Details: ${ticket.details.slice(0, 1000)}\n`;

        const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
        const latest = triageResults[0];
        if (latest) {
          const classification = latest.classification as Record<string, string> | null;
          result += `\nLatest triage: ${classification ? `${classification.type}/${classification.subtype}` : "N/A"}, Urgency: ${latest.urgency_score}/5, P${latest.recommended_priority}`;
          const notes = Array.isArray(latest.internal_notes) ? (latest.internal_notes as string[]).join("\n") : String(latest.internal_notes ?? "");
          if (notes) result += `\nNotes: ${notes.slice(0, 1500)}`;
        }

        const { data: review } = await serviceClient
          .from("tech_reviews")
          .select("rating, response_time, summary, improvement_areas")
          .eq("halo_id", haloId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (review) {
          result += `\nTech Review: ${review.rating} (response: ${review.response_time}) — ${review.summary ?? ""}`;
        }

        // Pull live actions/notes from Halo API (includes internal notes)
        const { data: haloInt } = await serviceClient
          .from("integrations")
          .select("config")
          .eq("service", "halo")
          .eq("is_active", true)
          .single();

        if (haloInt) {
          try {
            const haloCfg = haloInt.config as { base_url: string; client_id: string; client_secret: string; tenant?: string };
            const tokUrl = haloCfg.tenant
              ? `${haloCfg.base_url}/auth/token?tenant=${haloCfg.tenant}`
              : `${haloCfg.base_url}/auth/token`;
            const tokRes = await fetch(tokUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: haloCfg.client_id,
                client_secret: haloCfg.client_secret,
                scope: "all",
              }),
            });

            if (tokRes.ok) {
              const { access_token } = await tokRes.json() as { access_token: string };
              const actRes = await fetch(
                `${haloCfg.base_url}/api/actions?ticket_id=${haloId}&excludesys=true&count=10&order=datecreated&orderdesc=true`,
                { headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" } },
              );

              if (actRes.ok) {
                const actData = await actRes.json() as { actions?: ReadonlyArray<{ note?: string; who?: string; hiddenfromuser?: boolean; datecreated?: string; outcome?: string }> };
                const actions = (actData.actions ?? []).filter((a) => a.note && !a.note.toLowerCase().includes("triageit"));

                if (actions.length > 0) {
                  result += "\n\n## Ticket Actions/Notes (from Halo):\n";
                  for (const a of actions) {
                    const visibility = a.hiddenfromuser ? "[INTERNAL]" : "[VISIBLE]";
                    const date = a.datecreated ? new Date(a.datecreated).toLocaleDateString() : "unknown";
                    result += `- ${visibility} ${a.who ?? "Unknown"} (${date}): ${(a.note ?? "").slice(0, 500)}\n`;
                  }
                }
              }
            }
          } catch {
            // Non-critical — ticket data is still returned without actions
          }
        }

        return result;
      }

      case "run_toby_analysis": {
        const res = await fetch(`${workerUrl}/toby/analyze`, { method: "POST" });
        return res.ok
          ? "Toby's analysis has been triggered. He'll update tech profiles, customer insights, and trend detections. Results will be available shortly."
          : `Failed to trigger Toby: ${await res.text()}`;
      }

      case "pull_tickets": {
        const res = await fetch(`${workerUrl}/ticket-sync`, { method: "POST" });
        return res.ok
          ? `Ticket sync complete. ${JSON.stringify(await res.json())}`
          : `Failed to sync: ${await res.text()}`;
      }

      case "fetch_from_halo": {
        const haloId = input.halo_id as number;

        // First check if it already exists locally
        const { data: existing } = await serviceClient
          .from("tickets")
          .select("id, halo_id, summary, halo_status")
          .eq("halo_id", haloId)
          .maybeSingle();

        if (existing) {
          return `Ticket #${haloId} is already in TriageIt: "${existing.summary}" (status: ${existing.halo_status ?? "unknown"})`;
        }

        // Fetch from Halo API
        const { data: haloIntegration } = await serviceClient
          .from("integrations")
          .select("config")
          .eq("service", "halo")
          .eq("is_active", true)
          .single();

        if (!haloIntegration) return "Halo PSA is not configured.";

        const haloConfig = haloIntegration.config as { base_url: string; client_id: string; client_secret: string; tenant?: string };

        try {
          // Get Halo token
          const tokenUrl = haloConfig.tenant
            ? `${haloConfig.base_url}/auth/token?tenant=${haloConfig.tenant}`
            : `${haloConfig.base_url}/auth/token`;
          const tokenRes = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              client_id: haloConfig.client_id,
              client_secret: haloConfig.client_secret,
              scope: "all",
            }),
          });

          if (!tokenRes.ok) return `Failed to authenticate with Halo: ${tokenRes.status}`;
          const tokenData = await tokenRes.json() as { access_token: string };

          // Fetch the ticket
          const ticketRes = await fetch(
            `${haloConfig.base_url}/api/tickets/${haloId}?includecolumns=true`,
            { headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" } },
          );

          if (!ticketRes.ok) return `Ticket #${haloId} not found in Halo (${ticketRes.status}).`;
          const ticket = await ticketRes.json() as Record<string, unknown>;

          // Insert into local DB
          const { data: inserted, error: insertErr } = await serviceClient
            .from("tickets")
            .insert({
              halo_id: haloId,
              summary: (ticket.summary as string) ?? `Ticket #${haloId}`,
              details: (ticket.details as string) ?? null,
              client_name: (ticket.client_name as string) ?? null,
              client_id: typeof ticket.client_id === "number" ? ticket.client_id : null,
              user_name: (ticket.user_name as string) ?? null,
              user_email: (ticket.user_emailaddress as string) ?? null,
              original_priority: typeof ticket.priority_id === "number" ? ticket.priority_id : null,
              status: "pending",
              halo_status: (ticket.statusname as string) ?? (ticket.status_name as string) ?? null,
              halo_status_id: typeof ticket.status_id === "number" ? ticket.status_id : null,
              halo_agent: (ticket.agent_name as string) ?? null,
              halo_team: (ticket.team as string) ?? null,
              tickettype_id: typeof ticket.tickettype_id === "number" ? ticket.tickettype_id : null,
              raw_data: ticket,
            })
            .select("id")
            .single();

          if (insertErr) return `Found ticket #${haloId} in Halo ("${ticket.summary}") but failed to import: ${insertErr.message}`;

          // Trigger triage
          if (inserted) {
            try {
              await fetch(`${workerUrl}/triage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket_id: inserted.id }),
              });
            } catch {
              // Non-critical
            }
          }

          return `Found and imported ticket #${haloId} from Halo: "${ticket.summary}" (client: ${ticket.client_name ?? "unknown"}, status: ${ticket.statusname ?? "unknown"}). Triage has been queued.`;
        } catch (err) {
          return `Error fetching from Halo: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case "get_dashboard": {
        const sections = (input.sections as string[] | undefined) ?? ["tech_workload", "tech_profiles", "customer_insights", "trends", "reviews"];
        let result = "";

        if (sections.includes("tech_workload")) {
          const { data: tickets } = await serviceClient
            .from("tickets")
            .select("halo_status, halo_agent, client_name")
            .or("halo_status.is.null,halo_status.not.ilike.%closed%,halo_status.not.ilike.%resolved%,halo_status.not.ilike.%cancelled%");

          if (tickets && tickets.length > 0) {
            const byTech: Record<string, number> = {};
            const byClient: Record<string, number> = {};
            for (const t of tickets) {
              byTech[t.halo_agent ?? "Unassigned"] = (byTech[t.halo_agent ?? "Unassigned"] ?? 0) + 1;
              byClient[t.client_name ?? "Unknown"] = (byClient[t.client_name ?? "Unknown"] ?? 0) + 1;
            }
            result += `## Tech Workload (${tickets.length} open tickets)\n`;
            result += Object.entries(byTech).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}: ${c}`).join(", ") + "\n";
            result += `## Top Clients\n`;
            result += Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n}: ${c}`).join(", ") + "\n";
          }
        }

        if (sections.includes("tech_profiles")) {
          const { data: profiles } = await serviceClient
            .from("tech_profiles")
            .select("tech_name, avg_response_time, ticket_count, rating_breakdown, strong_categories, weak_categories, behavioral_patterns")
            .order("updated_at", { ascending: false });

          if (profiles && profiles.length > 0) {
            result += "\n## Tech Profiles\n";
            for (const tp of profiles) {
              result += `**${tp.tech_name}**: ${tp.ticket_count ?? 0} tickets, avg response: ${tp.avg_response_time ?? "N/A"}`;
              if (tp.strong_categories) result += ` | Strong: ${tp.strong_categories}`;
              if (tp.weak_categories) result += ` | Weak: ${tp.weak_categories}`;
              result += "\n";
            }
          }
        }

        if (sections.includes("customer_insights")) {
          const { data: insights } = await serviceClient
            .from("customer_insights")
            .select("client_name, recurring_issues, top_issue_types, update_request_frequency, environment_notes")
            .order("updated_at", { ascending: false })
            .limit(15);

          if (insights && insights.length > 0) {
            result += "\n## Customer Insights\n";
            for (const ci of insights) {
              result += `**${ci.client_name}**:`;
              if (ci.recurring_issues) result += ` Recurring: ${ci.recurring_issues}`;
              if (ci.top_issue_types) result += ` | Top: ${ci.top_issue_types}`;
              result += "\n";
            }
          }
        }

        if (sections.includes("trends")) {
          const { data: trends } = await serviceClient
            .from("trend_detections")
            .select("trend_type, title, description, severity, affected_clients, created_at")
            .order("created_at", { ascending: false })
            .limit(10);

          if (trends && trends.length > 0) {
            result += "\n## Recent Trends\n";
            for (const t of trends) {
              result += `- [${t.severity}] **${t.title}**: ${t.description}\n`;
            }
          }
        }

        if (sections.includes("reviews")) {
          const { data: reviews } = await serviceClient
            .from("tech_reviews")
            .select("tech_name, halo_id, rating, response_time, summary, created_at")
            .order("created_at", { ascending: false })
            .limit(15);

          if (reviews && reviews.length > 0) {
            result += "\n## Recent Tech Reviews\n";
            for (const r of reviews) {
              result += `- #${r.halo_id} **${r.tech_name}**: ${r.rating} (${r.response_time ?? "N/A"}) — ${r.summary ?? ""}\n`;
            }
          }
        }

        return result || "No dashboard data available yet.";
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  // Stream response from Claude with tool use support
  const client = new Anthropic();
  const modelId = "claude-sonnet-4-20250514";

  // Build the message loop — Michael may use tools, then respond with text
  let currentMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullResponse = "";
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      try {
        // Tool use loop — Michael may call tools, get results, then respond
        let iteration = 0;
        const maxIterations = 5;

        while (iteration < maxIterations) {
          iteration++;

          const stream = await client.messages.stream({
            model: modelId,
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          });

          let hasToolUse = false;
          const toolUseBlocks: Array<{ id: string; name: string; input: string }> = [];
          let currentToolId = "";
          let currentToolName = "";
          let currentToolInput = "";

          for await (const event of stream) {
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                fullResponse += event.delta.text;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`),
                );
              } else if (event.delta.type === "input_json_delta") {
                currentToolInput += event.delta.partial_json;
              }
            } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              hasToolUse = true;
              currentToolId = event.content_block.id;
              currentToolName = event.content_block.name;
              currentToolInput = "";
            } else if (event.type === "content_block_stop" && currentToolId) {
              toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: currentToolInput });
              currentToolId = "";
            }
          }

          const finalMsg = await stream.finalMessage();
          totalInputTokens += finalMsg.usage?.input_tokens ?? 0;
          totalOutputTokens += finalMsg.usage?.output_tokens ?? 0;

          if (!hasToolUse || toolUseBlocks.length === 0) break;

          // Execute tools with granular status updates
          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const tool of toolUseBlocks) {
            const parsedInput = tool.input ? JSON.parse(tool.input) : {};

            // Descriptive status for each tool
            const toolLabel = tool.name === "retriage_ticket" ? `Retriaging ticket #${parsedInput.halo_id}...`
              : tool.name === "lookup_ticket" ? `Looking up ticket #${parsedInput.halo_id}...`
              : tool.name === "run_toby_analysis" ? "Running Toby's analytics..."
              : tool.name === "pull_tickets" ? "Syncing tickets from Halo..."
              : tool.name === "fetch_from_halo" ? `Fetching ticket #${parsedInput.halo_id} from Halo...`
              : tool.name === "get_dashboard" ? "Loading dashboard data..."
              : `Running ${tool.name}...`;

            const workerName = tool.name === "retriage_ticket" ? "Ryan + specialist team"
              : tool.name === "lookup_ticket" ? "Database"
              : tool.name === "run_toby_analysis" ? "Toby Flenderson"
              : tool.name === "pull_tickets" ? "Halo PSA"
              : tool.name === "fetch_from_halo" ? "Halo PSA"
              : tool.name === "get_dashboard" ? "Dashboard"
              : tool.name;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ status: toolLabel, worker: workerName, phase: "started" })}\n\n`),
            );

            const result = await executeTool(tool.name, parsedInput);

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ status: `Done: ${toolLabel.replace("...", "")}`, worker: workerName, phase: "completed" })}\n\n`),
            );

            toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: result });
          }

          // Append assistant message with tool calls + tool results for next iteration
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: finalMsg.content },
            { role: "user", content: toolResults },
          ];
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

        // Sonnet 4 pricing: $3/M input, $15/M output
        const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;

        // Send done event with conversation ID, model, and usage
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            done: true,
            conversation_id: convId,
            model: modelId,
            usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, cost_usd: Math.round(cost * 10000) / 10000 },
          })}\n\n`),
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
