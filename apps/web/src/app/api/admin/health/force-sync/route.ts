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

  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  while (true) {
    // Use correct Halo API parameters:
    // - requesttype_id (not tickettype_id) for ticket type filter
    // - datesearch + startdate for date range
    // - pageinate (Halo's typo, not paginate)
    const url = `${config.base_url}/api/tickets?pageinate=true&page_size=50&page_no=${page}&requesttype_id=${GAMMA_DEFAULT_TYPE_ID}&open_only=true&datesearch=dateoccurred&startdate=${threeMonthsAgo}&order=id&orderdesc=true`;

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
  const threeMonthsCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Close any tickets older than 3 months that are still marked open
  await supabase
    .from("tickets")
    .update({ halo_is_open: false, updated_at: now })
    .eq("halo_is_open", true)
    .lt("created_at", threeMonthsCutoff);

  // Filter to last 3 months only (Halo's date filter is unreliable)
  const recentTickets = allTickets.filter((t) => {
    const created = (t as unknown as Record<string, unknown>).datecreated as string | undefined;
    if (!created) return true; // keep if no date (safer)
    return new Date(created).getTime() > Date.now() - 90 * 24 * 60 * 60 * 1000;
  });

  console.log(`[FORCE-SYNC] After 3-month filter: ${recentTickets.length} (filtered out ${allTickets.length - recentTickets.length} old tickets)`);

  // Group tickets: Gamma Default open, Gamma Default resolved, non-Gamma Default
  const gammaOpenIds = recentTickets
    .filter((t) => t.tickettype_id === GAMMA_DEFAULT_TYPE_ID && t.status_id !== RESOLVED_STATUS_ID)
    .map((t) => t.id);

  const gammaClosedIds = recentTickets
    .filter((t) => t.tickettype_id === GAMMA_DEFAULT_TYPE_ID && t.status_id === RESOLVED_STATUS_ID)
    .map((t) => t.id);

  const nonGammaIds = recentTickets
    .filter((t) => t.tickettype_id !== GAMMA_DEFAULT_TYPE_ID)
    .map((t) => t.id);

  console.log(`[FORCE-SYNC] Gamma open: ${gammaOpenIds.length}, Gamma resolved: ${gammaClosedIds.length}, Non-Gamma: ${nonGammaIds.length}`);

  // Batch update: Gamma Default open → halo_is_open=true, tickettype_id=31
  let openedCount = 0;
  for (let i = 0; i < gammaOpenIds.length; i += 50) {
    const chunk = gammaOpenIds.slice(i, i + 50);
    const { data } = await supabase
      .from("tickets")
      .update({ halo_is_open: true, tickettype_id: GAMMA_DEFAULT_TYPE_ID, updated_at: now })
      .in("halo_id", chunk)
      .select("id");
    openedCount += data?.length ?? 0;
  }

  // Batch update: Gamma Default resolved → halo_is_open=false, tickettype_id=31
  let closedCount = 0;
  for (let i = 0; i < gammaClosedIds.length; i += 50) {
    const chunk = gammaClosedIds.slice(i, i + 50);
    const { data } = await supabase
      .from("tickets")
      .update({ halo_is_open: false, tickettype_id: GAMMA_DEFAULT_TYPE_ID, updated_at: now })
      .in("halo_id", chunk)
      .select("id");
    closedCount += data?.length ?? 0;
  }

  // Batch update: Non-Gamma Default → halo_is_open=false, correct tickettype_id
  // Group by tickettype_id for correct tagging
  const nonGammaByType = new Map<number, number[]>();
  for (const t of recentTickets.filter((t) => t.tickettype_id !== GAMMA_DEFAULT_TYPE_ID)) {
    const existing = nonGammaByType.get(t.tickettype_id) ?? [];
    nonGammaByType.set(t.tickettype_id, [...existing, t.id]);
  }

  let nonGammaFixed = 0;
  for (const [typeId, ids] of nonGammaByType) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { data } = await supabase
        .from("tickets")
        .update({ halo_is_open: false, tickettype_id: typeId, updated_at: now })
        .in("halo_id", chunk)
        .select("id");
      nonGammaFixed += data?.length ?? 0;
    }
  }

  console.log(`[FORCE-SYNC] DB results: ${openedCount} opened, ${closedCount} closed, ${nonGammaFixed} non-Gamma fixed`);

  return NextResponse.json({
    success: true,
    message: `Halo: ${gammaOpenIds.length} Gamma open, ${gammaClosedIds.length} Gamma resolved, ${nonGammaIds.length} other. DB: ${openedCount} set open, ${closedCount + nonGammaFixed} set closed.`,
    halo_fetched: allTickets.length,
    gamma_open_halo: gammaOpenIds.length,
    gamma_closed_halo: gammaClosedIds.length,
    non_gamma_halo: nonGammaIds.length,
    db_opened: openedCount,
    db_closed: closedCount,
    db_non_gamma_fixed: nonGammaFixed,
    pages_fetched: page,
  });
}
