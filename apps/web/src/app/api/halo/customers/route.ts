import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/halo/customers
 * Fetches customers from Halo PSA using stored integration credentials.
 */
export async function GET() {
  const supabase = await createClient();

  // Get Halo config
  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("service", "halo")
    .single();

  if (!integration?.is_active) {
    return NextResponse.json(
      { error: "Halo PSA is not configured" },
      { status: 400 },
    );
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  try {
    // Get OAuth token
    const tokenUrl = await discoverTokenEndpoint(config.base_url, config.tenant);
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

    if (!tokenResponse.ok) {
      return NextResponse.json(
        { error: "Failed to authenticate with Halo PSA" },
        { status: 502 },
      );
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    // Fetch customers
    const customersResponse = await fetch(
      `${config.base_url}/api/client?count=500&order=name`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!customersResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch customers from Halo" },
        { status: 502 },
      );
    }

    const customersData = (await customersResponse.json()) as {
      clients?: ReadonlyArray<HaloCustomer>;
      record_count?: number;
    };

    const customers = (customersData.clients ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      is_active: c.inactive === false || c.inactive === undefined,
      main_site: c.main_site_name ?? null,
      phone: c.telephone_number ?? null,
      email: c.email_address ?? null,
      ticket_count: c.ticket_count ?? 0,
    }));

    return NextResponse.json({ customers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function discoverTokenEndpoint(
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
    // Fall through to default
  }

  const tokenUrl = `${baseUrl}/auth/token`;
  return tenant ? `${tokenUrl}?tenant=${tenant}` : tokenUrl;
}

interface HaloCustomer {
  readonly id: number;
  readonly name: string;
  readonly inactive?: boolean;
  readonly main_site_name?: string;
  readonly telephone_number?: string;
  readonly email_address?: string;
  readonly ticket_count?: number;
}
