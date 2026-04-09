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

  // Fetch open tickets from Halo, then filter to Gamma Default client-side.
  // Halo's tickettype_id filter is unreliable, so we fetch all open and filter.
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const rawTickets: Array<{ id: number; status_id: number; tickettype_id?: number; statusname?: string; status_name?: string }> = [];
  let page = 1;

  while (true) {
    const url = `${config.base_url}/api/tickets?page_size=50&page_no=${page}&open_only=true&order=id&orderdesc=true&includecolumns=true`;
    console.log(`[FORCE-SYNC] Fetching page ${page}`);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`[FORCE-SYNC] Page ${page} failed: ${res.status}`);
      break;
    }

    const data = (await res.json()) as {
      tickets?: Array<{ id: number; status_id: number; tickettype_id?: number; statusname?: string; status_name?: string }>;
      record_count?: number;
    };
    const batch = data.tickets ?? [];
    rawTickets.push(...batch);

    console.log(`[FORCE-SYNC] Page ${page}: got ${batch.length} tickets (record_count: ${data.record_count ?? "N/A"})`);

    if (batch.length < 50) break;
    page++;
    if (page > 100) break;
  }

  // Log first ticket's fields to see what Halo actually sends
  if (rawTickets.length > 0) {
    const sample = rawTickets[0];
    const typeFields = Object.entries(sample).filter(([k]) =>
      k.toLowerCase().includes("type") || k.toLowerCase().includes("ticket")
    );
    console.log(`[FORCE-SYNC] Sample ticket #${sample.id} type-related fields:`, JSON.stringify(typeFields));
    console.log(`[FORCE-SYNC] Sample ticket #${sample.id} tickettype_id=${(sample as Record<string, unknown>).tickettype_id}, ticket_type_id=${(sample as Record<string, unknown>).ticket_type_id}, tickettypeid=${(sample as Record<string, unknown>).tickettypeid}`);
  }

  // Filter to Gamma Default only — Halo returns tickettype_id as string or number
  const allTickets = rawTickets.filter((t) => {
    const s = t as Record<string, unknown>;
    const typeId = Number(s.tickettype_id ?? s.ticket_type_id ?? 0);
    return typeId === GAMMA_DEFAULT_TYPE_ID;
  });

  // Log type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const t of rawTickets) {
    const s = t as Record<string, unknown>;
    const typeId = String(s.tickettype_id ?? s.ticket_type_id ?? s.tickettypeid ?? "unknown");
    typeBreakdown[typeId] = (typeBreakdown[typeId] ?? 0) + 1;
  }
  console.log(`[FORCE-SYNC] Type breakdown:`, JSON.stringify(typeBreakdown));
  console.log(`[FORCE-SYNC] Total from Halo: ${rawTickets.length}. Gamma Default (type 31): ${allTickets.length}. Other types: ${rawTickets.length - allTickets.length}`);

  // Fetch status map
  const statusMap = new Map<number, string>();
  try {
    const res = await fetch(`${config.base_url}/api/status?count=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const raw = await res.json();
      const statuses: Array<{ id: number; name: string }> = Array.isArray(raw) ? raw : (raw.statuses ?? raw.records ?? []);
      for (const s of statuses) statusMap.set(s.id, s.name);
    }
  } catch { /* non-critical */ }

  // All these tickets are open in Halo (we used open_only=true).
  // Build status breakdown for logging.
  const statusBreakdown: Record<string, number> = {};
  const openIds = allTickets.map((t) => {
    const statusName = t.statusname ?? t.status_name ?? statusMap.get(t.status_id) ?? `Unknown-${t.status_id}`;
    statusBreakdown[statusName] = (statusBreakdown[statusName] ?? 0) + 1;
    return t.id;
  });

  // First: close ALL Gamma Default in DB
  await supabase
    .from("tickets")
    .update({ halo_is_open: false })
    .eq("tickettype_id", GAMMA_DEFAULT_TYPE_ID);

  // Then: open only the ones Halo says are open, in batches
  let openedCount = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < openIds.length; i += 50) {
    const chunk = openIds.slice(i, i + 50);
    const { data, error } = await supabase
      .from("tickets")
      .update({ halo_is_open: true, tickettype_id: GAMMA_DEFAULT_TYPE_ID, updated_at: now })
      .in("halo_id", chunk)
      .select("id");
    if (error) console.error(`[FORCE-SYNC] Batch ${i / 50 + 1} error:`, error.message);
    const count = data?.length ?? 0;
    openedCount += count;
    console.log(`[FORCE-SYNC] Batch ${i / 50 + 1}: ${chunk.length} halo IDs → ${count} DB rows updated`);
  }

  // Count tickets in Halo but not in our DB (missing)
  const missingCount = openIds.length - openedCount;

  return NextResponse.json({
    success: true,
    message: `Halo has ${openIds.length} open Gamma Default. Set ${openedCount} open in DB.${missingCount > 0 ? ` ${missingCount} missing from DB.` : ""}`,
    halo_open: openIds.length,
    db_opened: openedCount,
    missing_from_db: missingCount,
    raw_fetched: rawTickets.length,
    status_breakdown: statusBreakdown,
    pages_fetched: page,
  });
}
