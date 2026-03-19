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
  // Datto RMM uses Basic Auth with api_key:api_secret
  const credentials = Buffer.from(`${config.api_key}:${config.api_secret}`).toString("base64");
  const res = await fetch(`${config.api_url}/api/v2/account/sites`, {
    headers: {
      Authorization: `Basic ${credentials}`,
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
  // JumpCloud MSP uses organizations
  const res = await fetch("https://console.jumpcloud.com/api/organizations", {
    headers: {
      "x-api-key": config.api_key,
      "Content-Type": "application/json",
    },
  });

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

// ── Fetcher registry ─────────────────────────────────────────────────

const CUSTOMER_FETCHERS: Record<string, CustomerFetcher> = {
  halo: fetchHaloCustomers,
  hudu: fetchHuduCustomers,
  datto: fetchDattoCustomers,
  jumpcloud: fetchJumpCloudCustomers,
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
