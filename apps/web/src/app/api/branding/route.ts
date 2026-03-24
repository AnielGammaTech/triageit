import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

export interface BrandingConfig {
  readonly logo_url: string | null;
  readonly name: string;
  readonly agent_avatar_url: string | null;
}

const DEFAULT_BRANDING: BrandingConfig = {
  logo_url: null,
  name: "TriageIT",
  agent_avatar_url: null,
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
      agent_avatar_url?: string | null;
    };

    const supabase = await createServiceClient();

    // Preserve existing config fields not included in this update
    const { data: existing } = await supabase
      .from("integrations")
      .select("id, config")
      .eq("service", "branding")
      .single();

    const current = existing?.config as BrandingConfig | null;

    const config: BrandingConfig = {
      logo_url: body.logo_url !== undefined ? body.logo_url : (current?.logo_url ?? null),
      name: body.name ?? current?.name ?? "TriageIT",
      agent_avatar_url: body.agent_avatar_url !== undefined ? body.agent_avatar_url : (current?.agent_avatar_url ?? null),
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from("integrations")
        .update({ config, updated_at: new Date().toISOString() })
        .eq("service", "branding");

      if (updateError) {
        console.error("[BRANDING] Update failed:", updateError);
        return NextResponse.json(
          { error: `Failed to save: ${updateError.message}` },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabase.from("integrations").insert({
        service: "branding",
        display_name: "Branding",
        is_active: true,
        config,
      });

      if (insertError) {
        console.error("[BRANDING] Insert failed:", insertError);
        return NextResponse.json(
          { error: `Failed to save: ${insertError.message}` },
          { status: 500 },
        );
      }
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
