import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/integrations/automapper
 *
 * Fetches customers from all active integrations, matches them against
 * Halo PSA customers by name, and returns suggested mappings.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();

  // 1. Get all active integrations that have customer fetchers
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, service, config, display_name")
    .eq("is_active", true);

  if (!integrations || integrations.length === 0) {
    return NextResponse.json(
      { error: "No active integrations found" },
      { status: 400 },
    );
  }

  // 2. Find Halo — it's the source of truth
  const haloIntegration = integrations.find((i) => i.service === "halo");
  if (!haloIntegration) {
    return NextResponse.json(
      { error: "Halo PSA must be configured — it's the primary customer source" },
      { status: 400 },
    );
  }

  // 3. Fetch Halo customers
  let haloCustomers: Array<{ id: number | string; name: string }>;
  try {
    const haloConfig = haloIntegration.config as Record<string, string>;
    haloCustomers = await fetchHaloCustomersDirect(haloConfig);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch Halo customers: ${(error as Error).message}` },
      { status: 500 },
    );
  }

  // 4. Get existing mappings to skip already-mapped customers
  const { data: existingMappings } = await supabase
    .from("integration_mappings")
    .select("integration_id, external_id, external_name, customer_name, customer_id");

  const mappedKeys = new Set(
    (existingMappings ?? []).map((m) => `${m.integration_id}:${m.external_id}`),
  );

  // 5. For each non-Halo integration with a customer fetcher, fetch and match
  const suggestions: Array<{
    integration_id: string;
    service: string;
    display_name: string;
    external_id: string;
    external_name: string;
    halo_id: string;
    halo_name: string;
    confidence: number;
    match_type: "exact" | "normalized" | "fuzzy";
  }> = [];
  const unmatched: Array<{
    integration_id: string;
    service: string;
    display_name: string;
    external_id: string;
    external_name: string;
  }> = [];

  for (const integration of integrations) {
    if (integration.service === "halo" || integration.service === "automapper" || integration.service === "ai-provider" || integration.service === "teams") {
      continue;
    }

    // Try to fetch customers for this service
    let externalCustomers: Array<{ id: number | string; name: string }>;
    try {
      const config = integration.config as Record<string, string>;
      const fetcher = DIRECT_FETCHERS[integration.service];
      if (!fetcher) continue; // No customer fetcher for this service
      externalCustomers = await fetcher(config);
    } catch {
      continue; // Skip failed fetches silently
    }

    for (const ext of externalCustomers) {
      const key = `${integration.id}:${ext.id}`;
      if (mappedKeys.has(key)) continue; // Already mapped

      const match = findBestMatch(ext.name, haloCustomers);
      if (match) {
        suggestions.push({
          integration_id: integration.id,
          service: integration.service,
          display_name: integration.display_name,
          external_id: String(ext.id),
          external_name: ext.name,
          halo_id: String(match.customer.id),
          halo_name: match.customer.name,
          confidence: match.confidence,
          match_type: match.type,
        });
      } else {
        unmatched.push({
          integration_id: integration.id,
          service: integration.service,
          display_name: integration.display_name,
          external_id: String(ext.id),
          external_name: ext.name,
        });
      }
    }
  }

  // Sort suggestions by confidence desc
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return NextResponse.json({
    suggestions,
    unmatched,
    halo_customer_count: haloCustomers.length,
    integration_count: integrations.filter((i) => i.service !== "halo" && i.service !== "automapper").length,
  });
}

/**
 * POST /api/integrations/automapper (with body { action: "approve", mappings: [...] })
 * Approve suggested mappings and save to integration_mappings table.
 */
export async function PUT(request: Request) {
  const body = (await request.json()) as {
    mappings: Array<{
      integration_id: string;
      service: string;
      external_id: string;
      external_name: string;
      halo_id: string;
      halo_name: string;
    }>;
  };

  if (!body.mappings?.length) {
    return NextResponse.json({ error: "No mappings provided" }, { status: 400 });
  }

  const supabase = await createClient();
  const rows = body.mappings.map((m) => ({
    integration_id: m.integration_id,
    service: m.service,
    external_id: m.external_id,
    external_name: m.external_name,
    customer_name: m.halo_name,
    customer_id: m.halo_id,
  }));

  const { error } = await supabase.from("integration_mappings").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ approved: rows.length });
}

// ── Fuzzy matching ───────────────────────────────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestMatch(
  externalName: string,
  haloCustomers: Array<{ id: number | string; name: string }>,
): { customer: { id: number | string; name: string }; confidence: number; type: "exact" | "normalized" | "fuzzy" } | null {
  const extLower = externalName.toLowerCase().trim();
  const extNorm = normalize(externalName);

  // Exact match
  for (const hc of haloCustomers) {
    if (hc.name.toLowerCase().trim() === extLower) {
      return { customer: hc, confidence: 100, type: "exact" };
    }
  }

  // Normalized match (strip suffixes like Inc, LLC)
  for (const hc of haloCustomers) {
    if (normalize(hc.name) === extNorm && extNorm.length > 2) {
      return { customer: hc, confidence: 95, type: "normalized" };
    }
  }

  // Fuzzy match — Levenshtein-based
  let bestScore = 0;
  let bestCustomer: { id: number | string; name: string } | null = null;

  for (const hc of haloCustomers) {
    const hcNorm = normalize(hc.name);
    if (!hcNorm || !extNorm) continue;

    // Contains check
    if (hcNorm.includes(extNorm) || extNorm.includes(hcNorm)) {
      const lenRatio = Math.min(hcNorm.length, extNorm.length) / Math.max(hcNorm.length, extNorm.length);
      const score = 70 + lenRatio * 20;
      if (score > bestScore) {
        bestScore = score;
        bestCustomer = hc;
      }
      continue;
    }

    // Levenshtein similarity
    const maxLen = Math.max(hcNorm.length, extNorm.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(hcNorm, extNorm);
    const similarity = ((maxLen - dist) / maxLen) * 100;
    if (similarity > bestScore) {
      bestScore = similarity;
      bestCustomer = hc;
    }
  }

  if (bestCustomer && bestScore >= 70) {
    return { customer: bestCustomer, confidence: Math.round(bestScore), type: "fuzzy" };
  }

  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

// ── Direct customer fetchers (server-side, no cookie needed) ─────────

type DirectFetcher = (config: Record<string, string>) => Promise<Array<{ id: number | string; name: string }>>;

async function fetchHaloCustomersDirect(config: Record<string, string>) {
  const tokenUrl = await discoverHaloTokenEndpoint(config.base_url, config.tenant);
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
  if (!tokenRes.ok) throw new Error("Halo auth failed");
  const tokenData = (await tokenRes.json()) as { access_token: string };

  const res = await fetch(`${config.base_url}/api/client?count=500&order=name`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Halo fetch failed");
  const data = (await res.json()) as { clients?: Array<{ id: number; name: string; inactive?: boolean }> };
  return (data.clients ?? []).filter((c) => !c.inactive).map((c) => ({ id: c.id, name: c.name }));
}

async function fetchHuduDirect(config: Record<string, string>) {
  const res = await fetch(`${config.base_url}/api/v1/companies?page_size=500`, {
    headers: { "x-api-key": config.api_key, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Hudu error: ${res.status}`);
  const data = (await res.json()) as { companies?: Array<{ id: number; name: string; archived?: boolean }> };
  return (data.companies ?? []).filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));
}

async function fetchDattoDirect(config: Record<string, string>) {
  const credentials = Buffer.from(`${config.api_key}:${config.api_secret}`).toString("base64");
  const res = await fetch(`${config.api_url}/api/v2/account/sites`, {
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Datto error: ${res.status}`);
  const data = (await res.json()) as { sites?: Array<{ id: number; name: string }> };
  return (data.sites ?? []).map((s) => ({ id: s.id, name: s.name }));
}

async function fetchJumpCloudDirect(config: Record<string, string>) {
  const res = await fetch("https://console.jumpcloud.com/api/organizations", {
    headers: { "x-api-key": config.api_key, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`JumpCloud error: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ _id: string; displayName: string }> };
  return (data.results ?? []).map((o) => ({ id: o._id, name: o.displayName }));
}

const DIRECT_FETCHERS: Record<string, DirectFetcher> = {
  hudu: fetchHuduDirect,
  datto: fetchDattoDirect,
  jumpcloud: fetchJumpCloudDirect,
};

async function discoverHaloTokenEndpoint(baseUrl: string, tenant?: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/authinfo`);
    if (res.ok) {
      const info = (await res.json()) as { auth_url?: string; token_endpoint?: string };
      if (info.token_endpoint) return info.token_endpoint;
      if (info.auth_url) return `${info.auth_url}/token`;
    }
  } catch { /* fall through */ }
  const url = `${baseUrl}/auth/token`;
  return tenant ? `${url}?tenant=${tenant}` : url;
}
