import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/hudu/customers
 * Fetches companies from Hudu using stored integration credentials.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("service", "hudu")
    .single();

  if (!integration?.is_active) {
    return NextResponse.json(
      { error: "Hudu is not configured" },
      { status: 400 },
    );
  }

  const config = integration.config as {
    base_url: string;
    api_key: string;
  };

  try {
    // Hudu uses x-api-key header for auth
    const response = await fetch(
      `${config.base_url}/api/v1/companies?page_size=500`,
      {
        headers: {
          "x-api-key": config.api_key,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Failed to fetch companies from Hudu: ${response.status} ${text}` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as {
      companies?: ReadonlyArray<HuduCompany>;
    };

    const customers = (data.companies ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      is_active: !c.archived,
    }));

    return NextResponse.json({ customers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface HuduCompany {
  readonly id: number;
  readonly name: string;
  readonly archived?: boolean;
  readonly [key: string]: unknown;
}
