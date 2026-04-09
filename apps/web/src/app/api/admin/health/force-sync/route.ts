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

  // Fetch ALL Gamma Default tickets (paginated)
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const allTickets: Array<{ id: number; status_id: number; statusname?: string; status_name?: string }> = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${config.base_url}/api/tickets?page_size=100&page_no=${page}&tickettype_id=${GAMMA_DEFAULT_TYPE_ID}&order=id&orderdesc=true&includecolumns=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) break;

    const data = (await res.json()) as { tickets?: Array<{ id: number; status_id: number; statusname?: string; status_name?: string }> };
    const batch = data.tickets ?? [];
    allTickets.push(...batch);

    if (batch.length < 100) break;
    page++;
    if (page > 50) break;
  }

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

  // Determine open/closed for each ticket
  const resolvedKeywords = ["closed", "resolved", "cancelled", "completed"];

  const openIds: number[] = [];
  const closedIds: number[] = [];
  const statusBreakdown: Record<string, { count: number; open: boolean }> = {};

  for (const t of allTickets) {
    const statusName = (t.statusname ?? t.status_name ?? statusMap.get(t.status_id) ?? `Unknown-${t.status_id}`).toLowerCase();
    const isResolved = resolvedKeywords.some((k) => statusName.includes(k));

    if (!statusBreakdown[statusName]) {
      statusBreakdown[statusName] = { count: 0, open: !isResolved };
    }
    statusBreakdown[statusName].count++;

    if (isResolved) {
      closedIds.push(t.id);
    } else {
      openIds.push(t.id);
    }
  }

  // Write to DB in batches of 50
  let openedCount = 0;
  let closedCount = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < openIds.length; i += 50) {
    const chunk = openIds.slice(i, i + 50);
    const { data } = await supabase
      .from("tickets")
      .update({ halo_is_open: true, updated_at: now })
      .in("halo_id", chunk)
      .select("id");
    openedCount += data?.length ?? 0;
  }

  for (let i = 0; i < closedIds.length; i += 50) {
    const chunk = closedIds.slice(i, i + 50);
    const { data } = await supabase
      .from("tickets")
      .update({ halo_is_open: false, updated_at: now })
      .in("halo_id", chunk)
      .select("id");
    closedCount += data?.length ?? 0;
  }

  return NextResponse.json({
    success: true,
    message: `Fetched ${allTickets.length} from Halo. Set ${openedCount} open, ${closedCount} closed.`,
    halo_total: allTickets.length,
    open_in_halo: openIds.length,
    closed_in_halo: closedIds.length,
    db_opened: openedCount,
    db_closed: closedCount,
    status_breakdown: statusBreakdown,
    pages_fetched: page,
  });
}
