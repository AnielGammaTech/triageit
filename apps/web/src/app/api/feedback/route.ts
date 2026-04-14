import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/feedback
 *
 * Returns feedback for a specific ticket (via ?ticket_id=...)
 * or aggregated stats for the last 30 days.
 */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 30, 60_000, "feedback");
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(request.url);
  const ticketId = searchParams.get("ticket_id");

  const supabase = await createServiceClient();

  if (ticketId) {
    // Validate UUID format to prevent Supabase type errors
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(ticketId)) {
      return NextResponse.json({ feedback: [] });
    }

    const { data, error } = await supabase
      .from("triage_feedback")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[API] Feedback fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
    }

    return NextResponse.json({ feedback: data ?? [] });
  }

  // Aggregate stats for last 30 days
  const { data, error } = await supabase
    .from("triage_feedback")
    .select("rating, classification_accurate, priority_accurate")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("[API] Feedback stats error:", error);
    return NextResponse.json({ error: "Failed to fetch feedback stats" }, { status: 500 });
  }

  const total = data?.length ?? 0;
  const helpful = data?.filter((f) => f.rating === "helpful").length ?? 0;

  return NextResponse.json({
    total,
    helpful,
    helpfulRate: total > 0 ? Math.round((helpful / total) * 100) : 0,
  });
}

/**
 * POST /api/feedback
 *
 * Submit triage quality feedback.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 10, 60_000, "feedback-post");
  if (rateLimited) return rateLimited;

  const body = await request.json();

  if (!body.triage_result_id || !body.ticket_id || !body.rating) {
    return NextResponse.json(
      { error: "triage_result_id, ticket_id, and rating are required" },
      { status: 400 },
    );
  }

  if (body.rating !== "helpful" && body.rating !== "not_helpful") {
    return NextResponse.json(
      { error: "rating must be 'helpful' or 'not_helpful'" },
      { status: 400 },
    );
  }

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("triage_feedback")
    .insert({
      triage_result_id: body.triage_result_id,
      ticket_id: body.ticket_id,
      rating: body.rating,
      classification_accurate: body.classification_accurate ?? null,
      priority_accurate: body.priority_accurate ?? null,
      recommendations_useful: body.recommendations_useful ?? null,
      comment: body.comment ?? null,
      submitted_by: body.submitted_by ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[API] Feedback insert error:", error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  return NextResponse.json({ status: "saved", id: data.id });
}
