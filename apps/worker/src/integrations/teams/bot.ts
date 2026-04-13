import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseClient } from "../../db/supabase.js";

/**
 * Lightweight Teams bot — no botbuilder SDK dependency.
 * Handles Bot Framework messages directly via HTTP.
 * Azure Bot Service sends Activity objects; we respond inline.
 */

// ── Inbound auth — verify tokens FROM Azure Bot Service ────────────────

// Cache the OpenID signing keys from Microsoft
let cachedJwks: { keys: Array<{ kid: string; x5c?: string[]; n?: string; e?: string }>; expires: number } | null = null;

async function getOpenIdKeys(): Promise<Array<{ kid: string; x5c?: string[]; n?: string; e?: string }>> {
  if (cachedJwks && Date.now() < cachedJwks.expires) return cachedJwks.keys;

  try {
    // Bot Framework OpenID config
    const configRes = await fetch("https://login.botframework.com/v1/.well-known/openidconfiguration");
    const config = (await configRes.json()) as { jwks_uri: string };
    const jwksRes = await fetch(config.jwks_uri);
    const jwks = (await jwksRes.json()) as { keys: Array<{ kid: string; x5c?: string[]; n?: string; e?: string }> };
    cachedJwks = { keys: jwks.keys, expires: Date.now() + 24 * 60 * 60 * 1000 };
    return jwks.keys;
  } catch {
    return [];
  }
}

/**
 * Verify that an incoming request is from Azure Bot Service.
 * Decodes the JWT header to check issuer and audience without a full JWT library.
 */
export async function verifyBotToken(token: string): Promise<boolean> {
  const appId = process.env.TEAMS_BOT_APP_ID ?? "";
  if (!appId) return false;

  try {
    // Decode JWT payload (base64url)
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as { iss?: string; aud?: string; exp?: number; serviceurl?: string };

    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.warn("[TEAMS-BOT] Token expired");
      return false;
    }

    // Check audience matches our app ID
    if (payload.aud !== appId) {
      console.warn(`[TEAMS-BOT] Token audience mismatch: ${payload.aud} !== ${appId}`);
      return false;
    }

    // Check issuer is Microsoft
    const validIssuers = [
      "https://api.botframework.com",
      "https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/",
      "https://sts.windows.net/f8cdef31-a31e-4b4a-93e4-5f571e91255a/",
      `https://login.microsoftonline.com/${process.env.TEAMS_BOT_TENANT_ID ?? ""}/v2.0`,
    ];
    if (payload.iss && !validIssuers.some((iss) => payload.iss!.startsWith(iss.split("/v2.0")[0]))) {
      console.warn(`[TEAMS-BOT] Token issuer not recognized: ${payload.iss}`);
      return false;
    }

    // Verify the signing key exists in Microsoft's published keys
    const header = JSON.parse(
      Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as { kid?: string };

    if (header.kid) {
      const keys = await getOpenIdKeys();
      const matchingKey = keys.find((k) => k.kid === header.kid);
      if (!matchingKey) {
        console.warn(`[TEAMS-BOT] Token kid not found in Microsoft's JWKS: ${header.kid}`);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error("[TEAMS-BOT] Token verification failed:", err);
    return false;
  }
}

// ── Outbound auth — get tokens TO send messages back ───────────────────

let cachedToken: { token: string; expires: number } | null = null;

async function getBotToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.token;

  const appId = process.env.TEAMS_BOT_APP_ID ?? "";
  const appSecret = process.env.TEAMS_BOT_APP_SECRET ?? "";
  const tenantId = process.env.TEAMS_BOT_TENANT_ID ?? "";

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      scope: "https://api.botframework.com/.default",
    }),
  });

  if (!res.ok) throw new Error(`Bot auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

// ── Send reply to Teams ─────────────────────────────────────────────────

async function sendTeamsReply(serviceUrl: string, conversationId: string, activityId: string, text: string): Promise<void> {
  const token = await getBotToken();
  const url = `${serviceUrl}v3/conversations/${conversationId}/activities/${activityId}`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "message",
      text,
      textFormat: "markdown",
    }),
  });
}

async function sendTypingIndicator(serviceUrl: string, conversationId: string): Promise<void> {
  const token = await getBotToken();
  const url = `${serviceUrl}v3/conversations/${conversationId}/activities`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "typing" }),
  }).catch(() => { /* non-critical */ });
}

// ── Agent prompts ───────────────────────────────────────────────────────

function getMichaelPrompt(): string {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return `You are Prison Mike (Michael Scott), the Regional Manager at Gamma Tech Services LLC, an MSP in Naples, FL. Chatting via Teams.

Be concise — Teams messages should be short. Use markdown.

Team: Dylan Henjum, Raul Tapanes, Jarid Carlson, Matthew Lawyer, Ryan Fitzpatrick, Darren Davillier (techs). Bryanna (dispatcher). David (manager). Roman, Todd (sales — NOT techs).

RULES: Use tools for data. NEVER make up numbers. Every number must come from a tool. Today: ${today}`;
}

function getTobyPrompt(): string {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return `You are Toby Flenderson, analytics agent at Gamma Tech Services LLC. Chatting via Teams. Brutally honest, data-driven.

Standards: first response under 1hr, customer update every 4hr, no ticket in New over 2hr.

Team: Dylan, Raul, Jarid, Matthew, Ryan, Darren (techs). Roman/Todd are sales — don't evaluate them.

RULES: Use tools FIRST. NEVER fabricate. Every number from tool results only. Today: ${today}`;
}

// ── Tools ───────────────────────────────────────────────────────────────

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
        },
        required: [],
      },
    },
    {
      name: "lookup_ticket",
      description: "Get full details on a specific ticket by Halo ID.",
      input_schema: {
        type: "object" as const,
        properties: { halo_id: { type: "number" } },
        required: ["halo_id"],
      },
    },
    {
      name: "get_team_overview",
      description: "Workload and review stats for all techs.",
      input_schema: {
        type: "object" as const,
        properties: { days_back: { type: "number" } },
        required: [],
      },
    },
    {
      name: "get_tech_performance",
      description: "Deep dive on a specific tech.",
      input_schema: {
        type: "object" as const,
        properties: { tech_name: { type: "string" } },
        required: ["tech_name"],
      },
    },
    {
      name: "retriage_ticket",
      description: "Retriage a ticket through the full AI pipeline. Use when asked to re-evaluate or re-process a ticket.",
      input_schema: {
        type: "object" as const,
        properties: { halo_id: { type: "number", description: "Halo ticket number" } },
        required: ["halo_id"],
      },
    },
    {
      name: "post_halo_note",
      description: "Post an internal note to a Halo ticket. Use to ping a tech, flag something, or leave a message.",
      input_schema: {
        type: "object" as const,
        properties: {
          halo_id: { type: "number" },
          note: { type: "string", description: "The note content (plain text or HTML)" },
        },
        required: ["halo_id", "note"],
      },
    },
    {
      name: "get_client_history",
      description: "Full client analysis: tickets, recurring issues, assigned techs.",
      input_schema: {
        type: "object" as const,
        properties: { client_name: { type: "string" } },
        required: ["client_name"],
      },
    },
    {
      name: "run_toby_analysis",
      description: "Trigger Toby's analytics run to refresh tech profiles, customer insights, and trends.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "sync_tickets",
      description: "Force sync all open tickets from Halo. Use when tickets seem out of date.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}

// ── Tool execution ──────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const supabase = createSupabaseClient();
  const fmt = (iso: string | null | undefined): string => {
    if (!iso) return "?";
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  switch (name) {
    case "search_tickets": {
      const days = (input.days_back as number) ?? 14;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      let q = supabase.from("tickets").select("halo_id, summary, client_name, halo_status, halo_agent, created_at").eq("tickettype_id", 31).gte("created_at", since).order("created_at", { ascending: false }).limit(15);
      if (input.client_name) q = q.ilike("client_name", `%${input.client_name}%`);
      if (input.tech_name) q = q.ilike("halo_agent", `%${input.tech_name}%`);
      if (input.status) q = q.ilike("halo_status", `%${input.status}%`);
      if (input.keyword) q = q.or(`summary.ilike.%${input.keyword}%,details.ilike.%${input.keyword}%`);
      const { data } = await q;
      return (data ?? []).map((t) => `#${t.halo_id}: ${t.summary} | ${t.client_name ?? "?"} | ${t.halo_status ?? "?"} | ${t.halo_agent ?? "?"} | ${fmt(t.created_at)}`).join("\n") || "No tickets found.";
    }
    case "lookup_ticket": {
      const { data: t } = await supabase.from("tickets").select("halo_id, summary, client_name, details, halo_status, halo_agent, triage_results(internal_notes, urgency_score, classification)").eq("halo_id", input.halo_id as number).order("created_at", { referencedTable: "triage_results", ascending: false }).single();
      if (!t) return `#${input.halo_id} not found.`;
      const tr = (t.triage_results as ReadonlyArray<Record<string, unknown>>)?.[0];
      return `#${t.halo_id}: ${t.summary}\nClient: ${t.client_name ?? "?"} | Status: ${t.halo_status ?? "?"} | Tech: ${t.halo_agent ?? "?"}\n${t.details ? `Details: ${t.details.slice(0, 500)}` : ""}\n${tr ? `Triage: urgency ${tr.urgency_score}/5\nNotes: ${String(tr.internal_notes ?? "").slice(0, 800)}` : ""}`;
    }
    case "get_team_overview": {
      const days = (input.days_back as number) ?? 7;
      const TECHS = ["Dylan Henjum", "Raul Tapanes", "Jarid Carlson", "Matthew Lawyer", "Ryan Fitzpatrick", "Darren Davillier"];
      const [{ data: open }, { data: reviews }] = await Promise.all([
        supabase.from("tickets").select("halo_agent").eq("tickettype_id", 31).eq("halo_is_open", true),
        supabase.from("tech_reviews").select("tech_name, rating").gte("created_at", new Date(Date.now() - days * 86400000).toISOString()),
      ]);
      const stats: Record<string, { open: number; ratings: Record<string, number> }> = {};
      for (const n of TECHS) stats[n] = { open: 0, ratings: {} };
      for (const t of open ?? []) { const m = TECHS.find((n) => (t.halo_agent ?? "").toLowerCase().includes(n.split(" ")[0].toLowerCase())); if (m) stats[m].open++; }
      for (const r of reviews ?? []) { const m = TECHS.find((n) => (r.tech_name ?? "").toLowerCase().includes(n.split(" ")[0].toLowerCase())); if (m) stats[m].ratings[r.rating] = (stats[m].ratings[r.rating] ?? 0) + 1; }
      return Object.entries(stats).sort((a, b) => b[1].open - a[1].open).map(([n, s]) => `${n}: ${s.open} open | reviews: ${JSON.stringify(s.ratings)}`).join("\n");
    }
    case "get_tech_performance": {
      const name = input.tech_name as string;
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const [{ data: tickets }, { data: reviews }] = await Promise.all([
        supabase.from("tickets").select("halo_id, summary, halo_status, created_at").ilike("halo_agent", `%${name}%`).gte("created_at", since).limit(15),
        supabase.from("tech_reviews").select("halo_id, rating, response_time, max_gap_hours").ilike("tech_name", `%${name}%`).gte("created_at", since).limit(10),
      ]);
      let r = `Tickets (${tickets?.length ?? 0}):\n`;
      for (const t of tickets ?? []) r += `#${t.halo_id}: ${t.summary} [${t.halo_status ?? "?"}] ${fmt(t.created_at)}\n`;
      r += `\nReviews (${reviews?.length ?? 0}):\n`;
      for (const rv of reviews ?? []) r += `#${rv.halo_id}: ${rv.rating} (resp: ${rv.response_time}, gap: ${rv.max_gap_hours?.toFixed(1) ?? "?"}h)\n`;
      return r;
    }
    case "retriage_ticket": {
      const haloId = input.halo_id as number;
      const { data: ticket } = await supabase.from("tickets").select("id").eq("halo_id", haloId).single();
      if (!ticket) return `Ticket #${haloId} not found.`;
      const workerUrl = `http://localhost:${process.env.PORT ?? 3001}`;
      const res = await fetch(`${workerUrl}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticket.id }),
      });
      return res.ok ? `Retriage queued for #${haloId}. Pipeline will run classification + specialists.` : `Failed to queue retriage: ${await res.text()}`;
    }
    case "post_halo_note": {
      const haloId = input.halo_id as number;
      const note = input.note as string;
      const { data: haloInt } = await supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).single();
      if (!haloInt) return "Halo not configured.";
      const { HaloClient } = await import("../../integrations/halo/client.js");
      const halo = new HaloClient(haloInt.config as { base_url: string; client_id: string; client_secret: string; tenant?: string });
      await halo.addInternalNote(haloId, note);
      return `Internal note posted to #${haloId}.`;
    }
    case "get_client_history": {
      const clientName = input.client_name as string;
      const { data: tickets } = await supabase.from("tickets").select("halo_id, summary, halo_status, halo_agent, created_at").ilike("client_name", `%${clientName}%`).order("created_at", { ascending: false }).limit(20);
      let r = `## ${clientName} — ${tickets?.length ?? 0} tickets\n`;
      for (const t of tickets ?? []) r += `#${t.halo_id}: ${t.summary} [${t.halo_status ?? "?"}] ${t.halo_agent ?? "?"} ${fmt(t.created_at)}\n`;
      return r;
    }
    case "run_toby_analysis": {
      const workerUrl = `http://localhost:${process.env.PORT ?? 3001}`;
      const res = await fetch(`${workerUrl}/toby/analyze`, { method: "POST" });
      return res.ok ? "Toby's analysis triggered. Tech profiles, customer insights, and trends will update in a few minutes." : `Failed: ${await res.text()}`;
    }
    case "sync_tickets": {
      const workerUrl = `http://localhost:${process.env.PORT ?? 3001}`;
      const res = await fetch(`${workerUrl}/ticket-sync`, { method: "POST" });
      if (!res.ok) return `Sync failed: ${await res.text()}`;
      const data = (await res.json()) as { pulled?: number; created?: number; updated?: number };
      return `Ticket sync complete: ${data.pulled ?? 0} pulled, ${data.created ?? 0} new, ${data.updated ?? 0} updated.`;
    }
    default: return `Unknown tool: ${name}`;
  }
}

// ── Chat with agent ─────────────────────────────────────────────────────

const history = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

async function chat(agent: "michael" | "toby", message: string, convKey: string): Promise<string> {
  const system = agent === "michael" ? getMichaelPrompt() : getTobyPrompt();
  const anthropic = new Anthropic();

  if (!history.has(convKey)) history.set(convKey, []);
  const h = history.get(convKey)!;
  h.push({ role: "user", content: message });
  if (h.length > 20) h.splice(0, h.length - 20);

  let msgs: Anthropic.Messages.MessageParam[] = h.map((m) => ({ role: m.role, content: m.content }));

  for (let i = 0; i < 5; i++) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system,
      tools: getTools(),
      messages: msgs,
    });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type === "tool_use") {
        const result = await executeTool(b.name, b.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: b.id, content: result.slice(0, 8000) });
      }
    }

    if (toolResults.length > 0) {
      msgs = [...msgs, { role: "assistant", content: res.content }, { role: "user", content: toolResults }];
      continue;
    }

    const text = res.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text").map((b) => b.text).join("");
    h.push({ role: "assistant", content: text });
    return text;
  }

  return "Ran out of thinking steps. Try a simpler question.";
}

// ── Handle incoming Bot Framework activity ──────────────────────────────

interface BotActivity {
  readonly type: string;
  readonly text?: string;
  readonly serviceUrl: string;
  readonly conversation: { readonly id: string };
  readonly id: string;
  readonly from?: { readonly name?: string };
}

export async function handleBotMessage(activity: BotActivity): Promise<void> {
  if (activity.type !== "message" || !activity.text) return;

  const text = activity.text.replace(/<at>[^<]*<\/at>/g, "").trim();
  const lower = text.toLowerCase();
  const convId = activity.conversation.id;

  // Handle /help command
  if (lower === "/help" || lower === "help" || lower === "/commands") {
    const helpText = [
      "**Prison Mike & Toby — TriageIT Bot**",
      "",
      "**Agents:**",
      "- Just type your question → **Prison Mike** (operations)",
      "- Start with `toby` → **Toby** (analytics)",
      "",
      "**What I can do:**",
      "| Command | Example |",
      "|---------|---------|",
      "| Look up a ticket | *what's the status on #34875?* |",
      "| Search tickets | *show me open tickets for NABOR* |",
      "| Retriage a ticket | *retriage #34875* |",
      "| Post a note | *post a note on #34885 saying check the phone system* |",
      "| Tech performance | *how is Matthew doing this week?* |",
      "| Team overview | *show me the team workload* |",
      "| Client history | *what tickets does Potter Homes have?* |",
      "| Sync tickets | *sync tickets from Halo* |",
      "| Run analytics | *toby run a fresh analysis* |",
      "",
      "**Tips:**",
      "- Use `#` + ticket number to reference tickets",
      "- Say `toby` before your question for analytics/performance data",
      "- I can take actions — retriage, post notes, sync, not just read data",
    ].join("\n");
    await sendTeamsReply(activity.serviceUrl, convId, activity.id, helpText);
    return;
  }

  let agent: "michael" | "toby" = "michael";
  let cleanMsg = text;

  if (lower.startsWith("toby ") || lower.startsWith("toby,") || lower === "toby") {
    agent = "toby";
    cleanMsg = text.replace(/^toby\s*,?\s*/i, "") || "What should I look at?";
  }

  if (!cleanMsg) {
    await sendTeamsReply(activity.serviceUrl, convId, activity.id, "What do you need? Start with `toby` for analytics, or just ask me anything. Type `/help` for commands.");
    return;
  }

  await sendTypingIndicator(activity.serviceUrl, convId);

  try {
    const response = await chat(agent, cleanMsg, `${convId}:${agent}`);
    await sendTeamsReply(activity.serviceUrl, convId, activity.id, response);
  } catch (err) {
    console.error("[TEAMS-BOT] Error:", err);
    await sendTeamsReply(activity.serviceUrl, convId, activity.id, "Something went wrong. Try again.");
  }
}
