import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

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

/**
 * Fetch a single ticket from Halo by ID.
 */
async function fetchHaloTicket(config: HaloConfig, haloId: number): Promise<HaloTicketData> {
  const tokenUrl = `${config.base_url}/auth/token`;
  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });
  if (config.tenant) tokenBody.set("tenant", config.tenant);

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) throw new Error(`Halo auth failed: ${tokenRes.status}`);
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

  if (!ticketRes.ok) throw new Error(`Halo ticket fetch failed: ${ticketRes.status}`);
  return (await ticketRes.json()) as HaloTicketData;
}

/**
 * POST /api/triage
 *
 * Manually trigger AI triage on a ticket.
 * Accepts either { ticket_id } (local UUID) or { halo_id } (Halo ticket number).
 * When using halo_id, pulls the ticket from Halo and creates a local record first.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 10);
  if (rateLimited) return rateLimited;

  const body = (await request.json()) as { ticket_id?: string; halo_id?: number };

  if (!body.ticket_id && !body.halo_id) {
    return NextResponse.json({ error: "ticket_id or halo_id is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  let ticketId: string;

  if (body.halo_id) {
    // ── Triage by Halo ID — pull from Halo if not local yet ──────────
    const { data: existing } = await supabase
      .from("tickets")
      .select("id")
      .eq("halo_id", body.halo_id)
      .maybeSingle();

    if (existing) {
      ticketId = existing.id;
    } else {
      // Fetch from Halo and create local record
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

      try {
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
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to fetch from Halo: ${(err as Error).message}` },
          { status: 502 },
        );
      }
    }
  } else {
    // ── Triage by local ticket ID ────────────────────────────────────
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, halo_id, status")
      .eq("id", body.ticket_id!)
      .single();

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    ticketId = ticket.id;
  }

  // Clear old triage data so the UI starts fresh
  await supabase
    .from("triage_results")
    .delete()
    .eq("ticket_id", ticketId);

  await supabase
    .from("agent_logs")
    .delete()
    .eq("ticket_id", ticketId);

  // Reset status to pending so worker picks it up fresh
  await supabase
    .from("tickets")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "WORKER_URL not configured — cannot trigger triage" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${workerUrl}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: ticketId }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Worker returned ${response.status}: ${text}` },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json({ status: "triggered", ticket_id: ticketId, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach worker: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/triage
 *
 * Delete old/test tickets from the database.
 */
export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { ticket_ids?: readonly string[] };

  if (!body.ticket_ids?.length) {
    return NextResponse.json({ error: "ticket_ids[] is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Delete triage results first (FK constraint)
  await supabase
    .from("triage_results")
    .delete()
    .in("ticket_id", [...body.ticket_ids]);

  // Delete agent logs
  await supabase
    .from("agent_logs")
    .delete()
    .in("ticket_id", [...body.ticket_ids]);

  // Delete tickets
  const { error } = await supabase
    .from("tickets")
    .delete()
    .in("id", [...body.ticket_ids]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "deleted", count: body.ticket_ids.length });
}
