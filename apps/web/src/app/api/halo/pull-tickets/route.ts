import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();

  // Get Halo config from integrations table
  const { data: integration } = await supabase
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

    // Use service client to write to DB (anon key may not have insert permissions)
    const serviceClient = await createServiceClient();
    const now = new Date().toISOString();

    // Get all existing halo_ids in one query
    const haloIds = allTickets.map((t) => t.id);
    const { data: existingTickets } = await serviceClient
      .from("tickets")
      .select("id, halo_id")
      .in("halo_id", haloIds);

    const existingMap = new Map(
      (existingTickets ?? []).map((t) => [t.halo_id, t.id]),
    );

    let created = 0;
    let updated = 0;

    // Process in batches
    for (const ticket of allTickets) {
      const statusName = ticket.status ?? `status_${ticket.status_id}`;
      const trackingData = {
        halo_status: statusName,
        halo_status_id: ticket.status_id,
        halo_team: ticket.team ?? null,
        halo_agent: ticket.agent_id ? String(ticket.agent_id) : null,
        last_retriage_at: now,
        updated_at: now,
      };

      const existingId = existingMap.get(ticket.id);

      if (existingId) {
        await serviceClient
          .from("tickets")
          .update(trackingData)
          .eq("id", existingId);
        updated++;
      } else {
        await serviceClient.from("tickets").insert({
          halo_id: ticket.id,
          summary: ticket.summary,
          details: ticket.details ?? null,
          client_name: ticket.client_name ?? null,
          client_id: ticket.client_id ?? null,
          user_name: ticket.user_name ?? null,
          original_priority: ticket.priority_id ?? null,
          status: "triaged" as const,
          ...trackingData,
        });
        created++;
      }
    }

    return NextResponse.json({
      pulled: allTickets.length,
      created,
      updated,
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
