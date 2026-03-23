import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * GET /api/michael/skills
 * List all learned skills.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("michael_learned_skills")
    .select("id, title, content, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ skills: data ?? [] });
}

/**
 * DELETE /api/michael/skills?id=<uuid>
 * Deactivate a learned skill.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient
    .from("michael_learned_skills")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
