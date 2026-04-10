import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type TurnContext,
  ActivityTypes,
  MessageFactory,
} from "botbuilder";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseClient } from "../../db/supabase.js";

// ── Config ──────────────────────────────────────────────────────────────

const botAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.TEAMS_BOT_APP_ID ?? "",
  MicrosoftAppPassword: process.env.TEAMS_BOT_APP_SECRET ?? "",
  MicrosoftAppType: "SingleTenant",
  MicrosoftAppTenantId: process.env.TEAMS_BOT_TENANT_ID ?? "",
});

export const botAdapter = new CloudAdapter(botAuth);

// Error handler
botAdapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error(`[TEAMS-BOT] Error: ${error.message}`);
  await context.sendActivity("Sorry, something went wrong. Try again.");
};

// ── Agent configs ───────────────────────────────────────────────────────

const MICHAEL_PROMPT = `You are Prison Mike (Michael Scott), the Regional Manager at Gamma Tech Services LLC, an MSP in Naples, FL. You're chatting via Microsoft Teams with the admin/owner.

Be concise — Teams messages should be shorter than web chat. Use markdown (Teams supports it).

## Team Roster:
Techs: Dylan Henjum, Raul Tapanes, Jarid Carlson, Matthew Lawyer, Ryan Fitzpatrick, Darren Davillier
Dispatcher: Bryanna | Manager: David | Projects: Jonathan | Sales: Roman, Todd

## Rules:
- Use your tools to look up real data before answering. NEVER make up numbers.
- Keep responses under 500 words for Teams readability.
- Reference ticket numbers with #.
- Today: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;

const TOBY_PROMPT = `You are Toby Flenderson, the analytics agent at Gamma Tech Services LLC, an MSP in Naples, FL. You're chatting via Microsoft Teams with the admin/owner.

You're the brutal truth machine. Every claim backed by data. If a tech is failing, you say it with numbers.

## Standards:
- First response: under 1 hour
- Customer update: every 4 hours
- No ticket in "New" for more than 2 hours

## Team Roster:
Techs: Dylan Henjum, Raul Tapanes, Jarid Carlson, Matthew Lawyer, Ryan Fitzpatrick, Darren Davillier
Dispatcher: Bryanna | Manager: David | Projects: Jonathan | Sales: Roman, Todd (NOT techs — don't evaluate them)

## Rules:
- Use tools FIRST. NEVER fabricate numbers.
- Keep responses under 500 words for Teams readability.
- Today: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;

// ── Tools (shared between both agents) ──────────────────────────────────

function getTools(): Anthropic.Messages.Tool[] {
  return [
    {
      name: "search_tickets",
      description: "Search tickets by client, tech, status, or keyword.",
      input_schema: {
        type: "object" as const,
        properties: {
          client_name: { type: "string" },
          tech_name: { type: "string" },
          status: { type: "string" },
          keyword: { type: "string" },
          days_back: { type: "number" },
          limit: { type: "number" },
        },
        required: [],
      },
    },
    {
      name: "lookup_ticket",
      description: "Get full details on a specific ticket.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number", description: "Halo ticket number" },
        },
        required: ["halo_id"],
      },
    },
    {
      name: "get_team_overview",
      description: "Workload and review stats for all techs.",
      input_schema: {
        type: "object" as const,
        properties: {
          days_back: { type: "number" },
        },
        required: [],
      },
    },
    {
      name: "get_tech_performance",
      description: "Deep dive on a specific tech's tickets, reviews, and patterns.",
      input_schema: {
        type: "object" as const,
        properties: {
          tech_name: { type: "string" },
          days_back: { type: "number" },
        },
        required: ["tech_name"],
      },
    },
  ];
}

// ── Tool execution ──────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const supabase = createSupabaseClient();
  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return "?";
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  switch (name) {
    case "search_tickets": {
      const daysBack = (input.days_back as number) ?? 14;
      const limit = Math.min((input.limit as number) ?? 15, 30);
      const since = new Date(Date.now() - daysBack * 86400000).toISOString();

      let query = supabase.from("tickets").select("halo_id, summary, client_name, halo_status, halo_agent, created_at").eq("tickettype_id", 31).gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
      if (input.client_name) query = query.ilike("client_name", `%${input.client_name}%`);
      if (input.tech_name) query = query.ilike("halo_agent", `%${input.tech_name}%`);
      if (input.status) query = query.ilike("halo_status", `%${input.status}%`);
      if (input.keyword) query = query.or(`summary.ilike.%${input.keyword}%,details.ilike.%${input.keyword}%`);

      const { data: tickets } = await query;
      let result = `Found ${tickets?.length ?? 0} tickets:\n`;
      for (const t of tickets ?? []) {
        result += `- #${t.halo_id}: ${t.summary} | ${t.client_name ?? "?"} | ${t.halo_status ?? "?"} | ${t.halo_agent ?? "Unassigned"} | ${formatDate(t.created_at)}\n`;
      }
      return result;
    }

    case "lookup_ticket": {
      const haloId = input.halo_id as number;
      const { data: ticket } = await supabase
        .from("tickets")
        .select("halo_id, summary, client_name, details, halo_status, halo_agent, created_at, triage_results(internal_notes, classification, urgency_score, recommended_priority, created_at)")
        .eq("halo_id", haloId)
        .order("created_at", { referencedTable: "triage_results", ascending: false })
        .single();

      if (!ticket) return `Ticket #${haloId} not found.`;

      let result = `**#${ticket.halo_id}**: ${ticket.summary}\nClient: ${ticket.client_name ?? "?"} | Status: ${ticket.halo_status ?? "?"} | Tech: ${ticket.halo_agent ?? "Unassigned"}\n`;
      if (ticket.details) result += `Details: ${ticket.details.slice(0, 500)}\n`;

      const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
      const latest = triageResults[0];
      if (latest) {
        const classification = latest.classification as Record<string, string> | null;
        result += `\nTriage: ${classification ? `${classification.type}/${classification.subtype}` : "N/A"}, Urgency: ${latest.urgency_score}/5\n`;
        const notes = String(latest.internal_notes ?? "");
        if (notes) result += `Notes: ${notes.slice(0, 800)}\n`;
      }
      return result;
    }

    case "get_team_overview": {
      const daysBack = (input.days_back as number) ?? 7;
      const since = new Date(Date.now() - daysBack * 86400000).toISOString();

      const [{ data: openTickets }, { data: recentTickets }, { data: reviews }] = await Promise.all([
        supabase.from("tickets").select("halo_agent").eq("tickettype_id", 31).eq("halo_is_open", true),
        supabase.from("tickets").select("halo_agent").eq("tickettype_id", 31).gte("created_at", since),
        supabase.from("tech_reviews").select("tech_name, rating").gte("created_at", since),
      ]);

      const TECH_NAMES = ["Dylan Henjum", "Raul Tapanes", "Jarid Carlson", "Matthew Lawyer", "Ryan Fitzpatrick", "Darren Davillier"];
      const stats: Record<string, { open: number; recent: number; ratings: Record<string, number> }> = {};
      for (const n of TECH_NAMES) stats[n] = { open: 0, recent: 0, ratings: {} };

      for (const t of openTickets ?? []) {
        const match = TECH_NAMES.find((n) => (t.halo_agent ?? "").toLowerCase().includes(n.split(" ")[0].toLowerCase()));
        if (match) stats[match].open++;
      }
      for (const t of recentTickets ?? []) {
        const match = TECH_NAMES.find((n) => (t.halo_agent ?? "").toLowerCase().includes(n.split(" ")[0].toLowerCase()));
        if (match) stats[match].recent++;
      }
      for (const r of reviews ?? []) {
        const match = TECH_NAMES.find((n) => (r.tech_name ?? "").toLowerCase().includes(n.split(" ")[0].toLowerCase()));
        if (match) stats[match].ratings[r.rating] = (stats[match].ratings[r.rating] ?? 0) + 1;
      }

      let result = `## Team Overview (last ${daysBack} days)\n| Tech | Open | Recent | Reviews |\n|------|------|--------|---------|\n`;
      for (const [name, s] of Object.entries(stats).sort((a, b) => b[1].open - a[1].open)) {
        result += `| ${name} | ${s.open} | ${s.recent} | ${JSON.stringify(s.ratings)} |\n`;
      }
      return result;
    }

    case "get_tech_performance": {
      const techName = input.tech_name as string;
      const daysBack = (input.days_back as number) ?? 14;
      const since = new Date(Date.now() - daysBack * 86400000).toISOString();

      const [{ data: tickets }, { data: reviews }] = await Promise.all([
        supabase.from("tickets").select("halo_id, summary, halo_status, created_at").ilike("halo_agent", `%${techName}%`).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
        supabase.from("tech_reviews").select("halo_id, rating, response_time, summary, max_gap_hours").ilike("tech_name", `%${techName}%`).gte("created_at", since).order("created_at", { ascending: false }).limit(15),
      ]);

      let result = `## ${techName} (last ${daysBack} days)\n`;
      result += `**Tickets (${tickets?.length ?? 0}):**\n`;
      for (const t of tickets ?? []) {
        result += `- #${t.halo_id}: ${t.summary} [${t.halo_status ?? "?"}] ${formatDate(t.created_at)}\n`;
      }
      result += `\n**Reviews (${reviews?.length ?? 0}):**\n`;
      const ratingCounts: Record<string, number> = {};
      for (const r of reviews ?? []) {
        ratingCounts[r.rating] = (ratingCounts[r.rating] ?? 0) + 1;
        result += `- #${r.halo_id}: ${r.rating} (response: ${r.response_time}, gap: ${r.max_gap_hours?.toFixed(1) ?? "?"}h)\n`;
      }
      result += `\nRatings: ${JSON.stringify(ratingCounts)}\n`;
      return result;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Chat handler ────────────────────────────────────────────────────────

// Conversation history (in-memory, keyed by Teams conversation ID)
const conversationHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

async function chat(
  agentName: "michael" | "toby",
  message: string,
  conversationId: string,
): Promise<string> {
  const systemPrompt = agentName === "michael" ? MICHAEL_PROMPT : TOBY_PROMPT;
  const tools = getTools();
  const anthropic = new Anthropic();

  // Get or create conversation history
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  const history = conversationHistory.get(conversationId)!;
  history.push({ role: "user", content: message });

  // Keep last 20 messages to manage context
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  // Tool use loop
  let currentMessages: Anthropic.Messages.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages: currentMessages,
    });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.slice(0, 8000),
        });
      }
    }

    if (toolResults.length > 0) {
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
      continue;
    }

    // Done — extract text
    const fullText = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    history.push({ role: "assistant", content: fullText });
    return fullText;
  }

  return "I ran out of thinking steps. Try a simpler question.";
}

// ── Bot message handler ─────────────────────────────────────────────────

export async function handleTeamsMessage(context: TurnContext): Promise<void> {
  if (context.activity.type !== ActivityTypes.Message) return;

  const text = (context.activity.text ?? "").trim();
  const conversationId = context.activity.conversation?.id ?? "default";

  // Determine which agent to use based on mention or prefix
  // @Prison Mike or /mike → Michael
  // @Toby or /toby → Toby
  // Default → Michael
  const removedMentions = text.replace(/<at>[^<]*<\/at>/g, "").trim();
  const lower = removedMentions.toLowerCase();

  let agent: "michael" | "toby" = "michael";
  let cleanMessage = removedMentions;

  if (lower.startsWith("/toby ") || lower.startsWith("toby ") || lower.startsWith("toby,")) {
    agent = "toby";
    cleanMessage = removedMentions.replace(/^\/?(toby)\s*,?\s*/i, "");
  } else if (lower.startsWith("/mike ") || lower.startsWith("mike ") || lower.startsWith("michael ")) {
    agent = "michael";
    cleanMessage = removedMentions.replace(/^\/?(mike|michael)\s*,?\s*/i, "");
  }

  if (!cleanMessage) {
    await context.sendActivity("What do you need? Start with `toby` for analytics or just ask me (Prison Mike) anything.");
    return;
  }

  // Show typing indicator
  await context.sendActivity({ type: ActivityTypes.Typing });

  try {
    // Use conversation ID + agent name for separate histories
    const historyKey = `${conversationId}:${agent}`;
    const response = await chat(agent, cleanMessage, historyKey);

    // Send response (Teams supports markdown)
    await context.sendActivity(MessageFactory.text(response));
  } catch (err) {
    console.error(`[TEAMS-BOT] Chat error:`, err);
    await context.sendActivity("Something went wrong. Try again.");
  }
}
