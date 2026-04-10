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

  // Fetch open Gamma Default tickets from Halo
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const RESOLVED_STATUS_ID = 9;

  interface HaloTicket {
    readonly id: number;
    readonly summary: string;
    readonly details?: string;
    readonly client_name?: string;
    readonly client_id?: number;
    readonly user_name?: string;
    readonly user_emailaddress?: string;
    readonly agent_name?: string;
    readonly team?: string;
    readonly status_id: number;
    readonly priority_id?: number;
    readonly tickettype_id: number;
    readonly datecreated?: string;
  }

  const allTickets: HaloTicket[] = [];
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

    const data = (await res.json()) as { tickets?: HaloTicket[] };
    const batch = data.tickets ?? [];
    allTickets.push(...batch);

    console.log(`[FORCE-SYNC] Page ${page}: ${batch.length} tickets`);

    if (batch.length < 50) break;
    page++;
    if (page > 100) break;
  }

  console.log(`[FORCE-SYNC] Total fetched: ${allTickets.length} across ${page} pages`);

  // Fetch status name map from Halo
  const statusMap = new Map<number, string>();
  try {
    const sRes = await fetch(`${config.base_url}/api/status?count=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sRes.ok) {
      const sRaw = await sRes.json();
      const items = Array.isArray(sRaw) ? sRaw : ((sRaw as Record<string, unknown>).statuses ?? (sRaw as Record<string, unknown>).records ?? []);
      for (const s of items as Array<{ id: number; name: string }>) {
        statusMap.set(s.id, s.name);
      }
    }
  } catch { /* non-critical */ }
  console.log(`[FORCE-SYNC] Loaded ${statusMap.size} status names from Halo`);

  // Build halo_id → status_name lookup for batch updates
  const ticketStatusMap = new Map<number, string>();
  for (const t of allTickets) {
    const name = statusMap.get(t.status_id) ?? null;
    if (name) ticketStatusMap.set(t.id, name);
  }

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

  // Find tickets in Halo that don't exist in our DB and create them
  const allHaloIds = recentTickets.map((t) => t.id);
  const existingHaloIds = new Set<number>();

  for (let i = 0; i < allHaloIds.length; i += 50) {
    const chunk = allHaloIds.slice(i, i + 50);
    const { data } = await supabase
      .from("tickets")
      .select("halo_id")
      .in("halo_id", chunk);
    for (const row of data ?? []) {
      existingHaloIds.add(row.halo_id as number);
    }
  }

  const missingTickets = recentTickets.filter(
    (t) => !existingHaloIds.has(t.id) && t.tickettype_id === GAMMA_DEFAULT_TYPE_ID,
  );

  let createdCount = 0;
  if (missingTickets.length > 0) {
    const insertRows = missingTickets.map((t) => ({
      halo_id: t.id,
      summary: t.summary ?? "No subject",
      details: t.details ?? null,
      client_name: t.client_name ?? null,
      client_id: t.client_id ?? null,
      user_name: t.user_name ?? null,
      user_email: t.user_emailaddress ?? null,
      original_priority: t.priority_id ?? null,
      halo_agent: t.agent_name ?? null,
      halo_team: t.team ?? null,
      halo_status: ticketStatusMap.get(t.id) ?? null,
      halo_status_id: t.status_id,
      tickettype_id: GAMMA_DEFAULT_TYPE_ID,
      halo_is_open: t.status_id !== RESOLVED_STATUS_ID,
      status: "pending" as const,
      created_at: t.datecreated ?? now,
      updated_at: now,
    }));

    // Insert in batches of 50
    for (let i = 0; i < insertRows.length; i += 50) {
      const chunk = insertRows.slice(i, i + 50);
      const { error, count } = await supabase
        .from("tickets")
        .insert(chunk, { count: "exact" });
      if (error) {
        console.error(`[FORCE-SYNC] Insert batch error:`, error.message);
      } else {
        createdCount += count ?? chunk.length;
      }
    }

    console.log(`[FORCE-SYNC] Created ${createdCount} missing tickets`);
  }

  // Update halo_status for all tickets that have Unknown/NULL status
  // Group by status_id so we can batch update
  let statusFixed = 0;
  const statusGroups = new Map<number, number[]>();
  for (const t of recentTickets) {
    const existing = statusGroups.get(t.status_id) ?? [];
    statusGroups.set(t.status_id, [...existing, t.id]);
  }

  for (const [statusId, haloIds] of statusGroups) {
    const statusName = statusMap.get(statusId);
    if (!statusName) continue;

    for (let i = 0; i < haloIds.length; i += 50) {
      const chunk = haloIds.slice(i, i + 50);
      const { data } = await supabase
        .from("tickets")
        .update({ halo_status: statusName, halo_status_id: statusId, updated_at: now })
        .in("halo_id", chunk)
        .is("halo_status", null)
        .select("id");
      statusFixed += data?.length ?? 0;
    }

    // Also fix "Unknown" statuses
    for (let i = 0; i < haloIds.length; i += 50) {
      const chunk = haloIds.slice(i, i + 50);
      const { data } = await supabase
        .from("tickets")
        .update({ halo_status: statusName, halo_status_id: statusId, updated_at: now })
        .in("halo_id", chunk)
        .ilike("halo_status", "Unknown%")
        .select("id");
      statusFixed += data?.length ?? 0;
    }
  }

  // ── Close tickets in DB that are NOT in Halo's open list ──
  // These were resolved in Halo but our DB still has them as open.
  const haloOpenSet = new Set(gammaOpenIds);
  let extraClosed = 0;

  const { data: dbOpenTickets } = await supabase
    .from("tickets")
    .select("id, halo_id")
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID)
    .eq("halo_is_open", true);

  if (dbOpenTickets) {
    const toClose = dbOpenTickets.filter((t) => !haloOpenSet.has(t.halo_id as number));
    if (toClose.length > 0) {
      const closeIds = toClose.map((t) => t.id as string);
      for (let i = 0; i < closeIds.length; i += 50) {
        const chunk = closeIds.slice(i, i + 50);
        await supabase
          .from("tickets")
          .update({ halo_is_open: false, updated_at: now })
          .in("id", chunk);
      }
      extraClosed = toClose.length;
      console.log(`[FORCE-SYNC] Closed ${extraClosed} tickets not in Halo's open list`);
    }
  }

  console.log(`[FORCE-SYNC] DB results: ${openedCount} opened, ${closedCount + extraClosed} closed, ${nonGammaFixed} non-Gamma fixed, ${createdCount} created, ${statusFixed} statuses fixed`);

  return NextResponse.json({
    success: true,
    message: `Halo: ${gammaOpenIds.length} open. DB: ${openedCount} open, ${createdCount} created, ${closedCount + nonGammaFixed + extraClosed} closed, ${statusFixed} statuses fixed.`,
    halo_fetched: allTickets.length,
    gamma_open_halo: gammaOpenIds.length,
    gamma_closed_halo: gammaClosedIds.length,
    non_gamma_halo: nonGammaIds.length,
    db_opened: openedCount,
    db_created: createdCount,
    db_closed: closedCount,
    db_non_gamma_fixed: nonGammaFixed,
    db_statuses_fixed: statusFixed,
    pages_fetched: page,
  });
}
