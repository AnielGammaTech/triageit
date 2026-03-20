import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

export interface BrandingConfig {
  readonly logo_url: string | null;
  readonly name: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  logo_url: null,
  name: "TriageIt",
};

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServiceClient();

  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "branding")
    .single();

  const config = data ? (data.config as BrandingConfig) : DEFAULT_BRANDING;

  return NextResponse.json({ branding: config });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      logo_url?: string | null;
      name?: string;
    };

    const supabase = await createServiceClient();

    // Get existing branding or create new
    const { data: existing } = await supabase
      .from("integrations")
      .select("id")
      .eq("service", "branding")
      .single();

    const config: BrandingConfig = {
      logo_url: body.logo_url ?? null,
      name: body.name ?? "TriageIt",
    };

    if (existing) {
      await supabase
        .from("integrations")
        .update({ config, updated_at: new Date().toISOString() })
        .eq("service", "branding");
    } else {
      await supabase.from("integrations").insert({
        service: "branding",
        is_active: true,
        config,
      });
    }

    return NextResponse.json({ branding: config });
  } catch (err) {
    console.error("[BRANDING] Error:", err);
    return NextResponse.json(
      { error: "Failed to save branding" },
      { status: 500 },
    );
  }
}
