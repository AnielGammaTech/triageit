import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * GET /api/admin/health/debug-halo
 * Fetches ONE page of tickets from Halo and returns raw data for debugging.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServiceClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Halo not configured" }, { status: 500 });
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  // Auth
  let tokenUrl = `${config.base_url}/auth/token`;
  try {
    const infoRes = await fetch(`${config.base_url}/api/authinfo`);
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { token_endpoint?: string; auth_url?: string };
      if (info.token_endpoint) tokenUrl = info.token_endpoint;
      else if (info.auth_url) tokenUrl = `${info.auth_url}/token`;
    }
  } catch { /* fall through */ }
  if (config.tenant) tokenUrl += `?tenant=${config.tenant}`;

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: "all",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }

  const { access_token: token } = (await tokenRes.json()) as { access_token: string };

  // Fetch one page with tickettype_id filter
  const url = `${config.base_url}/api/tickets?page_size=5&page_no=1&tickettype_id=31&order=id&orderdesc=true&includecolumns=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const raw = await res.json();
  const tickets = (raw.tickets ?? []) as Array<Record<string, unknown>>;

  // Extract just the fields we care about from first 3 tickets
  const samples = tickets.slice(0, 3).map((t) => ({
    id: t.id,
    summary: t.summary,
    tickettype_id: t.tickettype_id,
    tickettype_id_type: typeof t.tickettype_id,
    ticket_type_id: t.ticket_type_id,
    tickettypename: t.tickettypename,
    tickettype_name: t.tickettype_name,
    status_id: t.status_id,
    statusname: t.statusname,
    status_name: t.status_name,
    all_type_fields: Object.entries(t)
      .filter(([k]) => k.toLowerCase().includes("type"))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
  }));

  // Also fetch without the filter to compare
  const url2 = `${config.base_url}/api/tickets?page_size=5&page_no=1&order=id&orderdesc=true&includecolumns=true`;
  const res2 = await fetch(url2, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw2 = await res2.json();
  const unfiltered = ((raw2.tickets ?? []) as Array<Record<string, unknown>>).slice(0, 3).map((t) => ({
    id: t.id,
    tickettype_id: t.tickettype_id,
    tickettype_id_type: typeof t.tickettype_id,
    tickettypename: t.tickettypename,
  }));

  return NextResponse.json({
    filtered_url: url,
    filtered_record_count: raw.record_count,
    filtered_page_count: tickets.length,
    samples,
    unfiltered_url: url2,
    unfiltered_record_count: raw2.record_count,
    unfiltered_samples: unfiltered,
  });
}
