import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * POST /api/admin/health/force-sync
 *
 * Dead-simple sync: fetch ALL tickets from Halo for Gamma Default,
 * determine open/closed by status, write directly to DB.
 * No pagination tricks, no reconciliation — just brute force.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServiceClient();

  // Get Halo config
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    return NextResponse.json({ success: false, error: "Halo not configured" }, { status: 500 });
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  // Auth with Halo
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
    return NextResponse.json({ success: false, error: "Halo auth failed" }, { status: 500 });
  }

  const { access_token: token } = (await tokenRes.json()) as { access_token: string };

  // Fetch ALL tickets from Halo (all types) so we can fix tickettype_id on everything
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const RESOLVED_STATUS_ID = 9;
  const allTickets: Array<{ id: number; status_id: number; tickettype_id: number }> = [];
  let page = 1;

  while (true) {
    const url = `${config.base_url}/api/tickets?page_size=50&page_no=${page}&order=id&orderdesc=true&includecolumns=true`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) break;

    const data = (await res.json()) as {
      tickets?: Array<{ id: number; status_id: number; tickettype_id: number }>;
    };
    const batch = data.tickets ?? [];
    allTickets.push(...batch);

    console.log(`[FORCE-SYNC] Page ${page}: ${batch.length} tickets`);

    if (batch.length < 50) break;
    page++;
    if (page > 100) break;
  }

  console.log(`[FORCE-SYNC] Total fetched: ${allTickets.length} across ${page} pages`);

  const now = new Date().toISOString();
  let typesFixed = 0;
  let openedCount = 0;
  let closedCount = 0;

  // Process every ticket: fix tickettype_id AND set halo_is_open correctly
  for (let i = 0; i < allTickets.length; i += 50) {
    const chunk = allTickets.slice(i, i + 50);

    for (const ticket of chunk) {
      const isGammaDefault = ticket.tickettype_id === GAMMA_DEFAULT_TYPE_ID;
      const isResolved = ticket.status_id === RESOLVED_STATUS_ID;
      const shouldBeOpen = isGammaDefault && !isResolved;

      const { data } = await supabase
        .from("tickets")
        .update({
          tickettype_id: ticket.tickettype_id,
          halo_is_open: shouldBeOpen,
          updated_at: now,
        })
        .eq("halo_id", ticket.id)
        .select("id, tickettype_id");

      if (data && data.length > 0) {
        typesFixed++;
        if (shouldBeOpen) openedCount++;
        else closedCount++;
      }
    }

    console.log(`[FORCE-SYNC] Processed ${Math.min(i + 50, allTickets.length)}/${allTickets.length}`);
  }

  // Count final state
  const { count: finalOpen } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
    .eq("halo_is_open", true);

  return NextResponse.json({
    success: true,
    message: `Synced ${typesFixed} tickets. ${openedCount} Gamma Default open, ${closedCount} closed/other. Dashboard should show ${finalOpen ?? 0}.`,
    halo_fetched: allTickets.length,
    db_updated: typesFixed,
    gamma_open: openedCount,
    closed_or_other: closedCount,
    dashboard_count: finalOpen ?? 0,
    pages_fetched: page,
  });
}
