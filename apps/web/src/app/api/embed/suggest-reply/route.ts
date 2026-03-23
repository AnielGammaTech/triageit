import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

interface HaloAction {
  readonly id: number;
  readonly ticket_id: number;
  readonly note: string;
  readonly outcome: string;
  readonly hiddenfromuser: boolean;
  readonly who?: string;
  readonly datecreated?: string;
}

interface SuggestReplyBody {
  readonly halo_id?: number;
  readonly token?: string;
}

const REPLY_PROMPT = `You are a professional IT support communication specialist at Gamma Tech Services, an MSP in Naples, FL.

Your job: Draft a customer-facing email reply for this ticket. The tech will review and edit before sending.

## Rules
- Be professional, warm, and concise
- Use the customer's first name if known
- Never blame the customer or be condescending
- If we need more info, ask specific questions (not vague "can you provide more details")
- If we're providing an update, be honest about status without oversharing technical details
- If the issue is resolved, confirm what was done in plain language
- Do NOT include a signature or sign-off (no "Best regards", no name, no "Gamma Tech Support" — the email system auto-appends the tech's signature)
- Keep it SHORT — 3-5 sentences max for simple updates, 5-8 for complex ones
- Don't include ticket numbers or internal references
- Match the tone of previous customer communication (formal client = formal reply, casual = casual)

## What to Draft Based on Situation
1. **Need more info**: Ask the specific missing questions to proceed
2. **Providing update**: What we've done, what's next, expected timeline
3. **Issue resolved**: Confirm fix, verify it's working, offer follow-up
4. **Scheduling**: Confirm date/time, set expectations for the visit
5. **Waiting on vendor/parts**: Explain the delay, give realistic timeline

## Output
Return ONLY the email body text. No subject line, no greeting placeholder, no HTML. Just the natural email text starting with the greeting.`;

function validateToken(token: string | undefined): NextResponse | null {
  const secret = process.env.EMBED_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "EMBED_SECRET not configured" }, { status: 500 });
  }
  if (!token || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getHaloToken(config: HaloConfig): Promise<string> {
  const tokenUrl = `${config.base_url}/auth/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });
  if (config.tenant) body.set("tenant", config.tenant);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`Halo auth failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function fetchHaloActions(
  config: HaloConfig,
  ticketId: number,
): Promise<ReadonlyArray<HaloAction>> {
  const token = await getHaloToken(config);
  const url = `${config.base_url}/api/actions?ticket_id=${ticketId}&excludesys=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return [];
  const data = (await response.json()) as { actions?: HaloAction[] };
  return data.actions ?? [];
}

async function fetchHaloTicket(
  config: HaloConfig,
  ticketId: number,
): Promise<Record<string, unknown> | null> {
  const token = await getHaloToken(config);
  const url = `${config.base_url}/api/tickets/${ticketId}?includedetails=true&includecolumns=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SuggestReplyBody;
  const { halo_id, token } = body;

  const tokenError = validateToken(token);
  if (tokenError) return tokenError;

  if (!halo_id) {
    return NextResponse.json({ error: "halo_id is required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  // Get Halo config
  const { data: integration } = await serviceClient
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Halo not configured" }, { status: 400 });
  }

  const config = integration.config as HaloConfig;

  // Fetch ticket details and conversation history in parallel
  const [haloTicket, actions] = await Promise.all([
    fetchHaloTicket(config, halo_id),
    fetchHaloActions(config, halo_id),
  ]);

  if (!haloTicket) {
    return NextResponse.json({ error: "Ticket not found in Halo" }, { status: 404 });
  }

  // Get triage results for context
  const { data: triageResult } = await serviceClient
    .from("triage_results")
    .select("classification, urgency_score, internal_notes, suggested_response")
    .eq("ticket_id", (
      await serviceClient
        .from("tickets")
        .select("id")
        .eq("halo_id", halo_id)
        .single()
    ).data?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build conversation context
  const conversationHistory = [...actions]
    .sort((a, b) => {
      const dateA = a.datecreated ? new Date(a.datecreated).getTime() : 0;
      const dateB = b.datecreated ? new Date(b.datecreated).getTime() : 0;
      return dateA - dateB;
    })
    .map((a) => {
      const who = a.who ?? "Unknown";
      const when = a.datecreated ?? "";
      const visibility = a.hiddenfromuser ? "[INTERNAL]" : "[CUSTOMER-VISIBLE]";
      const note = stripHtml(a.note).substring(0, 500);
      return `${visibility} ${who} (${when}): ${note}`;
    })
    .join("\n\n");

  const ticketSummary = (haloTicket.summary ?? "") as string;
  const ticketDetails = stripHtml(((haloTicket.details ?? "") as string));
  const customerName = (haloTicket.user_name ?? "") as string;
  const clientName = (haloTicket.client_name ?? "") as string;
  const assignedTech = (haloTicket.agent_name ?? "Gamma Tech Support") as string;

  const userMessage = [
    `## Ticket #${halo_id}: ${ticketSummary}`,
    `Customer: ${customerName} (${clientName})`,
    `Assigned Tech: ${assignedTech}`,
    ticketDetails ? `\nDescription:\n${ticketDetails}` : "",
    triageResult ? `\nAI Triage Notes: ${typeof triageResult.internal_notes === "string" ? triageResult.internal_notes : JSON.stringify(triageResult.internal_notes)}` : "",
    `\n## Conversation History\n${conversationHistory || "No conversation history yet."}`,
    `\nDraft a customer reply for ${assignedTech} to send. Consider what the customer needs right now based on the conversation.`,
  ].filter(Boolean).join("\n");

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: REPLY_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const replyText = response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ reply: replyText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
