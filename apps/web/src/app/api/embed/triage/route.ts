import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

interface HaloTicketData {
  readonly id: number;
  readonly summary: string;
  readonly details?: string;
  readonly client_id?: number;
  readonly client_name?: string;
  readonly user_name?: string;
  readonly user_emailaddress?: string;
  readonly priority_id?: number;
  readonly status_id: number;
  readonly statusname?: string;
  readonly status_name?: string;
  readonly status?: string;
  readonly team?: string;
  readonly team_name?: string;
  readonly agent_id?: number;
  readonly agent_name?: string;
  readonly datecreated: string;
}

interface EmbedTriageBody {
  readonly halo_id?: number;
  readonly token?: string;
}

/**
 * Validate the embed token against EMBED_SECRET.
 * Returns an error response if invalid, or null if valid.
 */
function validateToken(token: string | undefined): NextResponse | null {
  const secret = process.env.EMBED_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "EMBED_SECRET not configured" },
      { status: 500 },
    );
  }

  if (!token || token !== secret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  return null;
}

/**
 * Fetch a single ticket from Halo by ID.
 */
async function fetchHaloTicket(
  config: HaloConfig,
  haloId: number,
): Promise<HaloTicketData> {
  const tokenUrl = `${config.base_url}/auth/token`;
  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });

  if (config.tenant) {
    tokenBody.set("tenant", config.tenant);
  }

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`Halo auth failed: ${tokenRes.status}`);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const ticketRes = await fetch(
    `${config.base_url}/api/tickets/${haloId}?includecolumns=true`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!ticketRes.ok) {
    throw new Error(`Halo ticket fetch failed: ${ticketRes.status}`);
  }

  return (await ticketRes.json()) as HaloTicketData;
}

/**
 * POST /api/embed/triage
 *
 * Token-authenticated triage trigger for Halo iframe embed.
 * Looks up or creates the ticket locally, then triggers the worker.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EmbedTriageBody;

    const authError = validateToken(body.token);
    if (authError) return authError;

    if (!body.halo_id || typeof body.halo_id !== "number") {
      return NextResponse.json(
        { error: "Missing or invalid halo_id" },
        { status: 400 },
      );
    }

    const supabase = await createServiceClient();

    // Check if ticket already exists locally
    const { data: existing } = await supabase
      .from("tickets")
      .select("id")
      .eq("halo_id", body.halo_id)
      .maybeSingle();

    let ticketId: string;

    if (existing) {
      ticketId = existing.id;
    } else {
      // Fetch Halo config to pull ticket data
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

      const haloTicket = await fetchHaloTicket(
        haloIntegration.config as HaloConfig,
        body.halo_id,
      );

      const { data: inserted, error: insertError } = await supabase
        .from("tickets")
        .insert({
          halo_id: haloTicket.id,
          summary: haloTicket.summary,
          details: haloTicket.details ?? null,
          client_name: haloTicket.client_name ?? null,
          client_id: haloTicket.client_id ?? null,
          user_name: haloTicket.user_name ?? null,
          user_email: haloTicket.user_emailaddress ?? null,
          original_priority: haloTicket.priority_id ?? null,
          status: "pending" as const,
          halo_status:
            haloTicket.statusname ??
            haloTicket.status_name ??
            haloTicket.status ??
            null,
          halo_status_id: haloTicket.status_id,
          halo_team: haloTicket.team_name ?? haloTicket.team ?? null,
          halo_agent: haloTicket.agent_name ?? null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        return NextResponse.json(
          { error: `Failed to create local ticket: ${insertError?.message ?? "unknown"}` },
          { status: 500 },
        );
      }

      ticketId = inserted.id;
    }

    // Clear old triage data so the UI starts fresh
    await Promise.all([
      supabase.from("triage_results").delete().eq("ticket_id", ticketId),
      supabase.from("agent_logs").delete().eq("ticket_id", ticketId),
    ]);

    // Reset status to pending
    await supabase
      .from("tickets")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", ticketId);

    // Trigger the worker
    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) {
      return NextResponse.json(
        { error: "WORKER_URL not configured" },
        { status: 503 },
      );
    }

    const workerResponse = await fetch(`${workerUrl}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: ticketId }),
    });

    if (!workerResponse.ok) {
      const text = await workerResponse.text();
      return NextResponse.json(
        { error: `Worker returned ${workerResponse.status}: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "ok", ticket_id: ticketId });
  } catch (err) {
    console.error("[EMBED/TRIAGE] Error:", err);
    return NextResponse.json(
      { error: `Triage failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
