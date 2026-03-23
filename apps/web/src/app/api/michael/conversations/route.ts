import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * GET /api/michael/conversations
 * List all conversations for the current user.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("michael_conversations")
    .select("id, title, ticket_id, is_archived, created_at, updated_at")
    .eq("user_id", auth.user.id)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}

/**
 * DELETE /api/michael/conversations?id=<uuid>
 * Archive a conversation.
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
    .from("michael_conversations")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
