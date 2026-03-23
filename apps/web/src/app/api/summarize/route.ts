import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

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

const SUMMARIZE_PROMPT = `You are an MSP operations analyst. Given a ticket's private/internal tech notes and appointment history, write a concise summary of what the technician did on this ticket.

Focus on:
- What the tech actually did (actions taken, troubleshooting steps, solutions applied)
- Key timeline events (when they responded, scheduled, followed up)
- Any appointments or site visits scheduled
- Current state / what's still pending
- How responsive the tech was (gaps between actions)

Rules:
- Be concise — 3-8 bullet points max
- Use plain language, no jargon
- Include approximate dates/times when available
- If the tech hasn't done much, say so honestly — e.g. "No tech activity recorded yet"
- Skip any notes from "TriageIT" or automated systems — focus only on human tech activity
- Do NOT include customer emails or customer replies — this is strictly about tech work
- If there are scheduled appointments, mention them

Output format: Return plain text with bullet points (use • character). No JSON, no markdown headers.`;

/**
 * Strip HTML tags from a Halo note to get plain text.
 */
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

  if (config.tenant) {
    body.set("tenant", config.tenant);
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Halo auth failed: ${response.status}`);
  }

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

  if (!response.ok) {
    throw new Error(`Halo actions fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as { actions: HaloAction[] };
  return data.actions ?? [];
}

async function fetchHaloAppointments(
  config: HaloConfig,
  ticketId: number,
): Promise<ReadonlyArray<{ start: string; end: string; who: string; subject: string }>> {
  try {
    const token = await getHaloToken(config);
    const url = `${config.base_url}/api/appointments?ticket_id=${ticketId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      appointments?: ReadonlyArray<{
        start_date?: string;
        end_date?: string;
        agent_name?: string;
        subject?: string;
      }>;
    };

    return (data.appointments ?? []).map((a) => ({
      start: a.start_date ?? "",
      end: a.end_date ?? "",
      who: a.agent_name ?? "Unknown",
      subject: a.subject ?? "",
    }));
  } catch {
    // Appointments endpoint may not be available
    return [];
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 10, 60_000, "summarize");
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as { halo_id?: number };

    if (!body.halo_id) {
      return NextResponse.json(
        { error: "Missing halo_id" },
        { status: 400 },
      );
    }

    const supabase = await createServiceClient();

    // Get Halo config
    const { data: haloIntegration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .single();

    if (!haloIntegration) {
      return NextResponse.json(
        { error: "Halo integration not configured" },
        { status: 500 },
      );
    }

    const config = haloIntegration.config as HaloConfig;

    // Fetch actions and appointments in parallel
    const [allActions, appointments] = await Promise.all([
      fetchHaloActions(config, body.halo_id),
      fetchHaloAppointments(config, body.halo_id),
    ]);

    // Filter to ONLY private/internal tech notes — no customer emails
    const techActions = allActions
      .filter((a) => {
        // Only include private/internal notes (hiddenfromuser = true)
        if (!a.hiddenfromuser) return false;

        // Exclude TriageIT automated notes
        const who = (a.who ?? "").toLowerCase();
        if (who.includes("triageit") || who.includes("triage it")) return false;

        // Exclude notes that look like TriageIT output
        const noteText = stripHtml(a.note);
        if (noteText.startsWith("🔍 TriageIT") || noteText.startsWith("TriageIT Analysis")) return false;

        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.datecreated ?? "").getTime() -
          new Date(b.datecreated ?? "").getTime(),
      );

    if (techActions.length === 0 && appointments.length === 0) {
      return NextResponse.json({
        summary: "• No tech activity or notes found on this ticket yet.",
        actionCount: 0,
      });
    }

    // Build context for the AI
    const actionLines = techActions.map((a) => {
      const date = a.datecreated
        ? new Date(a.datecreated).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "Unknown date";
      const noteText = stripHtml(a.note).substring(0, 500);
      return `[${date}] ${a.who ?? "Unknown"} (private note): ${noteText}`;
    });

    const appointmentLines = appointments.map((a) => {
      const start = a.start
        ? new Date(a.start).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "TBD";
      return `[Appointment] ${start} — ${a.who}: ${a.subject}`;
    });

    const contextMessage = [
      `Ticket has ${techActions.length} actions and ${appointments.length} appointments.`,
      "",
      "--- Actions ---",
      ...actionLines,
      "",
      ...(appointmentLines.length > 0
        ? ["--- Appointments ---", ...appointmentLines]
        : []),
    ].join("\n");

    // Use Haiku for cheap summarization
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SUMMARIZE_PROMPT,
      messages: [{ role: "user", content: contextMessage }],
    });

    const summary =
      response.content[0].type === "text" ? response.content[0].text : "Unable to summarize.";

    return NextResponse.json({
      summary,
      actionCount: techActions.length,
      appointmentCount: appointments.length,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    });
  } catch (err) {
    console.error("[SUMMARIZE] Error:", err);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
