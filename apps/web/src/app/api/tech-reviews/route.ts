import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/tech-reviews
 *
 * Returns all tech reviews with ticket info, ordered by most recent.
 * Groups by ticket — returns the latest review per ticket.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 30, 60_000, "tech-reviews");
  if (rateLimited) return rateLimited;

  const supabase = await createServiceClient();

  // Fetch reviews — exclude tickets that are closed/resolved
  const { data, error } = await supabase
    .from("tech_reviews")
    .select(`
      id,
      ticket_id,
      halo_id,
      tech_name,
      rating,
      communication_score,
      response_time,
      max_gap_hours,
      strengths,
      improvement_areas,
      suggestions,
      summary,
      created_at,
      tickets!inner (
        summary,
        client_name,
        halo_status,
        halo_agent
      )
    `)
    .not("tickets.halo_status", "ilike", "%closed%")
    .not("tickets.halo_status", "ilike", "%resolved%")
    .not("tickets.halo_status", "ilike", "%completed%")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[API] Tech reviews fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch tech reviews" }, { status: 500 });
  }

  return NextResponse.json({ reviews: data ?? [] });
}
