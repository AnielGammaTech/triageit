import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { secureTokenEqual } from "@/lib/api/secure-token";
import { readJsonBody } from "@/lib/api/json-body";

interface FeedbackBody {
  readonly halo_id?: number;
  readonly token?: string;
  readonly rating?: "up" | "down";
  readonly triage_result_id?: string;
  readonly comment?: string;
}

/**
 * POST /api/embed/feedback — thumbs up/down on triage quality from the
 * embed panel. Feeds Toby's learning loop via the triage_feedback table.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await readJsonBody<FeedbackBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const embedSecret = process.env.EMBED_SECRET;
  if (!secureTokenEqual(body.token, embedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!body.halo_id || typeof body.halo_id !== "number") {
    return NextResponse.json({ error: "Missing halo_id" }, { status: 400 });
  }
  if (body.rating !== "up" && body.rating !== "down") {
    return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", body.halo_id)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const { error } = await supabase.from("triage_feedback").insert({
    ticket_id: ticket.id,
    triage_result_id: body.triage_result_id ?? null,
    halo_id: body.halo_id,
    rating: body.rating,
    comment: body.comment?.slice(0, 2000) ?? null,
  });

  if (error) {
    console.error("[EMBED FEEDBACK] Insert failed:", error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
