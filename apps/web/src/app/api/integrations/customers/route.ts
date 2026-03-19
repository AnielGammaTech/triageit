import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/integrations/customers?service=hudu
 * Universal customer fetch — delegates to the right integration API.
 * Returns a normalized { customers: [{ id, name, is_active }] } shape.
 */
export async function GET(request: NextRequest) {
  const service = request.nextUrl.searchParams.get("service");
  if (!service) {
    return NextResponse.json(
      { error: "Missing 'service' query parameter" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("service", service)
    .single();

  if (!integration?.is_active) {
    return NextResponse.json(
      { error: `${service} is not configured or not active` },
      { status: 400 },
    );
  }

  const config = integration.config as Record<string, string>;

  try {
    const fetcher = CUSTOMER_FETCHERS[service];
    if (!fetcher) {
      return NextResponse.json(
        { error: `Customer fetch not implemented for ${service}` },
        { status: 501 },
      );
    }

    const customers = await fetcher(config);
    return NextResponse.json({ customers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Normalized customer shape ────────────────────────────────────────

interface NormalizedCustomer {
  readonly id: number | string;
  readonly name: string;
  readonly is_active: boolean;
}

type CustomerFetcher = (
  config: Record<string, string>,
) => Promise<ReadonlyArray<NormalizedCustomer>>;

// ── Per-service fetchers ─────────────────────────────────────────────

async function fetchHaloCustomers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  const tokenUrl = await discoverHaloTokenEndpoint(
    config.base_url,
    config.tenant,
  );
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

  if (!tokenResponse.ok) throw new Error("Failed to authenticate with Halo");

  const tokenData = (await tokenResponse.json()) as { access_token: string };

  const res = await fetch(
    `${config.base_url}/api/client?count=500&order=name`,
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) throw new Error("Failed to fetch Halo customers");

  const data = (await res.json()) as {
    clients?: ReadonlyArray<{
      id: number;
      name: string;
      inactive?: boolean;
    }>;
  };

  return (data.clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    is_active: c.inactive !== true,
  }));
}

async function fetchHuduCustomers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  const res = await fetch(
    `${config.base_url}/api/v1/companies?page_size=500`,
    {
      headers: {
        "x-api-key": config.api_key,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) throw new Error(`Hudu API error: ${res.status}`);

  const data = (await res.json()) as {
    companies?: ReadonlyArray<{
      id: number;
      name: string;
      archived?: boolean;
    }>;
  };

  return (data.companies ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    is_active: !c.archived,
  }));
}

async function fetchDattoCustomers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // Datto RMM OAuth2: POST to /auth/oauth/token with public-client:public as Basic Auth
  // and API key/secret as username/password (grant_type=password)
  const baseUrl = config.api_url.replace(/\/$/, "");
  const basicAuth = Buffer.from("public-client:public").toString("base64");

  const tokenRes = await fetch(`${baseUrl}/auth/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: config.api_key,
      password: config.api_secret,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    const isHtml = text.trimStart().startsWith("<");
    throw new Error(
      isHtml
        ? `Datto RMM auth failed (${tokenRes.status}). Your API URL should be your regional endpoint (e.g. https://pinotage-api.centrastage.net)`
        : `Datto RMM auth failed (${tokenRes.status}): ${text.substring(0, 200)}`,
    );
  }

  const contentType = tokenRes.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(
      `Datto RMM auth returned unexpected content-type: ${contentType}. Your API URL should be your regional endpoint (e.g. https://pinotage-api.centrastage.net)`,
    );
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  const res = await fetch(`${baseUrl}/api/v2/account/sites`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) throw new Error(`Datto RMM API error: ${res.status}`);

  const data = (await res.json()) as {
    sites?: ReadonlyArray<{
      id: number;
      name: string;
      onDemand?: boolean;
    }>;
  };

  return (data.sites ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    is_active: true,
  }));
}

async function fetchJumpCloudCustomers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // JumpCloud MTP — list managed organizations under the provider
  const res = await fetch(
    "https://console.jumpcloud.com/api/organizations?limit=200",
    {
      headers: {
        "x-api-key": config.api_key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  if (!res.ok) throw new Error(`JumpCloud API error: ${res.status}`);

  const data = (await res.json()) as {
    results?: ReadonlyArray<{
      _id: string;
      displayName: string;
    }>;
  };

  return (data.results ?? []).map((o) => ({
    id: o._id,
    name: o.displayName,
    is_active: true,
  }));
}

async function fetchUnifiSites(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // UniFi Site Manager API — list all sites
  const res = await fetch("https://api.ui.com/ea/sites", {
    headers: {
      "x-api-key": config.api_key,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`UniFi API error: ${res.status}`);

  const data = (await res.json()) as {
    data?: ReadonlyArray<{
      hostId?: string;
      siteId?: string;
      _id?: string;
      meta?: {
        name?: string;
        desc?: string;
      };
      name?: string;
      desc?: string;
    }>;
  };

  return (data.data ?? []).map((s) => ({
    id: s.hostId ?? s.siteId ?? s._id ?? "",
    name: s.meta?.desc || s.meta?.name || s.desc || s.name || "Unnamed Site",
    is_active: true,
  }));
}

async function fetchPax8Customers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // Pax8 OAuth2 — client_credentials grant
  const tokenRes = await fetch("https://login.pax8.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      audience: "https://api.pax8.com",
      grant_type: "client_credentials",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Pax8 auth failed (${tokenRes.status}): ${text.substring(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Fetch companies (paginated — pull up to 500)
  const res = await fetch(
    "https://api.pax8.com/v1/companies?size=200&sort=name&sortDirection=asc",
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) throw new Error(`Pax8 API error: ${res.status}`);

  const data = (await res.json()) as {
    content?: ReadonlyArray<{
      id: string;
      name: string;
      status?: string;
    }>;
  };

  return (data.content ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    is_active: c.status !== "Inactive",
  }));
}

async function fetchVultrInstances(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // Vultr API v2 — list all instances (servers) using API key Bearer auth
  const res = await fetch(
    "https://api.vultr.com/v2/instances?per_page=500",
    {
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) throw new Error(`Vultr API error: ${res.status}`);

  const data = (await res.json()) as {
    instances?: ReadonlyArray<{
      id: string;
      label: string;
      hostname?: string;
      status?: string;
      power_status?: string;
    }>;
  };

  return (data.instances ?? []).map((i) => ({
    id: i.id,
    name: i.label || i.hostname || i.id,
    is_active: i.power_status === "running",
  }));
}

async function fetchUnitrendsCustomers(
  config: Record<string, string>,
): Promise<ReadonlyArray<NormalizedCustomer>> {
  // Unitrends MSP (Kaseya) — OAuth2 client_credentials via login.backup.net
  const basicAuth = Buffer.from(`${config.client_id}:${config.client_secret}`).toString("base64");

  const tokenRes = await fetch("https://login.backup.net/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Unitrends auth failed (${tokenRes.status}): ${text.substring(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Try multiple endpoint paths — Unitrends MSP public API path is not well documented
  const apiPaths = [
    "https://public-api.backup.net/organizations",
    "https://public-api.backup.net/api/organizations",
    "https://public-api.backup.net/api/v1/organizations",
    "https://public-api.backup.net/v1/organizations",
  ];

  const headers = {
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: "application/json",
  };

  for (const apiPath of apiPaths) {
    const res = await fetch(`${apiPath}?pageSize=500`, { headers });

    if (res.status === 404) {
      continue;
    }

    if (!res.ok) {
      throw new Error(`Unitrends API error (${res.status}) at ${apiPath}`);
    }

    // Parse flexible response shape — could be array or wrapped
    const raw = (await res.json()) as unknown;
    const items: ReadonlyArray<Record<string, unknown>> =
      Array.isArray(raw)
        ? (raw as ReadonlyArray<Record<string, unknown>>)
        : ((raw as Record<string, unknown>).items ??
           (raw as Record<string, unknown>).data ??
           (raw as Record<string, unknown>).organizations ??
           []) as ReadonlyArray<Record<string, unknown>>;

    return items.map((o) => ({
      id: (o.id ?? o.organizationId ?? "") as string | number,
      name: (o.name ?? o.organizationName ?? "Unknown") as string,
      is_active: o.isActive !== false,
    }));
  }

  throw new Error(
    `Unitrends: Auth succeeded but organizations endpoint not found. Tried: ${apiPaths.join(", ")}. The Unitrends MSP public API structure may have changed.`,
  );
}

// ── Fetcher registry ─────────────────────────────────────────────────

const CUSTOMER_FETCHERS: Record<string, CustomerFetcher> = {
  halo: fetchHaloCustomers,
  hudu: fetchHuduCustomers,
  datto: fetchDattoCustomers,
  jumpcloud: fetchJumpCloudCustomers,
  unifi: fetchUnifiSites,
  pax8: fetchPax8Customers,
  vultr: fetchVultrInstances,
  unitrends: fetchUnitrendsCustomers,
};

// ── Halo helpers ─────────────────────────────────────────────────────

async function discoverHaloTokenEndpoint(
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
    // Fall through
  }
  const tokenUrl = `${baseUrl}/auth/token`;
  return tenant ? `${tokenUrl}?tenant=${tenant}` : tokenUrl;
}
