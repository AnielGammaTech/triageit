import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

interface HaloTicket {
  readonly id: number;
  readonly summary: string;
  readonly details?: string;
  readonly client_id?: number;
  readonly client_name?: string;
  readonly user_name?: string;
  readonly agent_id?: number;
  readonly team?: string;
  readonly status_id: number;
  readonly status?: string;
  readonly priority_id?: number;
  readonly datecreated: string;
}

/**
 * POST /api/halo/pull-tickets
 *
 * Pulls all open tickets directly from Halo PSA and upserts them into the
 * local tickets table. This does NOT require the worker — it calls Halo from
 * the web app and writes to Supabase with the service role key.
 *
 * Returns { pulled: number, created: number, updated: number }.
 */
export async function POST() {
  const serviceClient = await createServiceClient();

  // Get Halo config from integrations table
  const { data: integration } = await serviceClient
    .from("integrations")
    .select("config, is_active")
    .eq("service", "halo")
    .single();

  if (!integration?.is_active) {
    return NextResponse.json(
      { error: "Halo PSA is not configured. Go to Settings > Integrations and add your Halo credentials." },
      { status: 400 },
    );
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  try {
    // Authenticate with Halo
    const tokenUrl = await discoverTokenEndpoint(config.base_url, config.tenant);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id,
        client_secret: config.client_secret,
        scope: "all",
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return NextResponse.json(
        { error: `Failed to authenticate with Halo PSA: ${text}` },
        { status: 502 },
      );
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };
    const token = tokenData.access_token;

    // Paginate through all open tickets
    const allTickets: HaloTicket[] = [];
    const pageSize = 100;
    let page = 1;

    while (true) {
      const ticketsResponse = await fetch(
        `${config.base_url}/api/tickets?page_size=${pageSize}&page_no=${page}&open_only=true&order=datecreated&orderdesc=true`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!ticketsResponse.ok) {
        const text = await ticketsResponse.text();
        return NextResponse.json(
          { error: `Failed to fetch tickets from Halo: ${text}` },
          { status: 502 },
        );
      }

      const data = (await ticketsResponse.json()) as {
        tickets?: HaloTicket[];
        record_count?: number;
      };
      const tickets = data.tickets ?? [];
      allTickets.push(...tickets);

      if (tickets.length < pageSize) break;
      page++;
    }

    if (allTickets.length === 0) {
      return NextResponse.json({
        pulled: 0,
        created: 0,
        updated: 0,
        message: "No open tickets found in Halo.",
      });
    }

    const now = new Date().toISOString();

    // Find which tickets already exist locally
    const haloIds = allTickets.map((t) => t.id);
    const { data: existingTickets, error: lookupError } = await serviceClient
      .from("tickets")
      .select("id, halo_id")
      .in("halo_id", haloIds);

    if (lookupError) {
      return NextResponse.json(
        { error: `DB lookup failed: ${lookupError.message}` },
        { status: 500 },
      );
    }

    const existingHaloIds = new Set((existingTickets ?? []).map((t) => t.halo_id));

    // Split into new vs existing
    const newTickets = allTickets.filter((t) => !existingHaloIds.has(t.id));
    const existingIds = allTickets.filter((t) => existingHaloIds.has(t.id));

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    // Batch insert new tickets
    if (newTickets.length > 0) {
      const insertRows = newTickets.map((ticket) => ({
        halo_id: ticket.id,
        summary: ticket.summary,
        details: ticket.details ?? null,
        client_name: ticket.client_name ?? null,
        client_id: ticket.client_id ?? null,
        user_name: ticket.user_name ?? null,
        original_priority: ticket.priority_id ?? null,
        status: "triaged" as const,
        halo_status: ticket.status ?? `status_${ticket.status_id}`,
        halo_status_id: ticket.status_id,
        halo_team: ticket.team ?? null,
        halo_agent: ticket.agent_id ? String(ticket.agent_id) : null,
        last_retriage_at: now,
        updated_at: now,
      }));

      const { error: insertError, count } = await serviceClient
        .from("tickets")
        .insert(insertRows, { count: "exact" });

      if (insertError) {
        errors.push(`Insert failed: ${insertError.message}`);
      } else {
        created = count ?? newTickets.length;
      }
    }

    // Batch update existing tickets (only tracking fields, not status)
    for (const ticket of existingIds) {
      const { error: updateError } = await serviceClient
        .from("tickets")
        .update({
          summary: ticket.summary,
          client_name: ticket.client_name ?? null,
          halo_status: ticket.status ?? `status_${ticket.status_id}`,
          halo_status_id: ticket.status_id,
          halo_team: ticket.team ?? null,
          halo_agent: ticket.agent_id ? String(ticket.agent_id) : null,
          last_retriage_at: now,
          updated_at: now,
        })
        .eq("halo_id", ticket.id);

      if (updateError) {
        errors.push(`Update #${ticket.id}: ${updateError.message}`);
      } else {
        updated++;
      }
    }

    if (errors.length > 0 && created === 0 && updated === 0) {
      return NextResponse.json(
        { error: `All DB operations failed: ${errors[0]}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      pulled: allTickets.length,
      created,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function discoverTokenEndpoint(
  baseUrl: string,
  tenant?: string,
): Promise<string> {
  try {
    const infoResponse = await fetch(`${baseUrl}/api/authinfo`);
    if (infoResponse.ok) {
      const info = (await infoResponse.json()) as {
        auth_url?: string;
        token_endpoint?: string;
      };
      if (info.token_endpoint) return info.token_endpoint;
      if (info.auth_url) return `${info.auth_url}/token`;
    }
  } catch {
    // Fall through to default
  }

  const tokenUrl = `${baseUrl}/auth/token`;
  return tenant ? `${tokenUrl}?tenant=${tenant}` : tokenUrl;
}
