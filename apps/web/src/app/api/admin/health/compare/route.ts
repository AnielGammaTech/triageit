import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * GET /api/admin/health/compare
 * Compares open Gamma Default tickets in Halo vs TriageIT DB.
 * Shows which tickets are missing from DB.
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
  } catch { /* */ }
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

  // Fetch open Gamma Default from Halo using correct params
  const haloOpen: Array<{ id: number; summary: string; client_name?: string }> = [];
  let page = 1;
  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  while (true) {
    const url = `${config.base_url}/api/tickets?pageinate=true&page_size=50&page_no=${page}&requesttype_id=31&open_only=true&datesearch=dateoccurred&startdate=${threeMonthsAgo}&order=id&orderdesc=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;

    const data = (await res.json()) as { tickets?: Array<{ id: number; summary: string; client_name?: string }> };
    const batch = data.tickets ?? [];
    haloOpen.push(...batch);
    if (batch.length < 50) break;
    page++;
    if (page > 20) break;
  }

  // Get our open tickets from DB
  const { data: dbOpen } = await supabase
    .from("tickets")
    .select("halo_id")
    .eq("tickettype_id", 31)
    .eq("halo_is_open", true);

  const dbHaloIds = new Set((dbOpen ?? []).map((t) => t.halo_id as number));
  const haloIds = new Set(haloOpen.map((t) => t.id));

  // Find differences
  const inHaloNotDb = haloOpen.filter((t) => !dbHaloIds.has(t.id));
  const inDbNotHalo = (dbOpen ?? []).filter((t) => !haloIds.has(t.halo_id as number));

  return NextResponse.json({
    halo_open_count: haloOpen.length,
    db_open_count: dbOpen?.length ?? 0,
    in_halo_not_db: inHaloNotDb.map((t) => ({ id: t.id, summary: t.summary, client: t.client_name })),
    in_db_not_halo: inDbNotHalo.map((t) => ({ halo_id: t.halo_id })),
    missing_count: inHaloNotDb.length,
    extra_count: inDbNotHalo.length,
  });
}
