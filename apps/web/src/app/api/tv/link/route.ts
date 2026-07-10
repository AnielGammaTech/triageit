import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { tvKeyConfigured } from "@/lib/api/tv-key";

/**
 * GET /api/tv/link — returns the shareable TV wallboard URL to an
 * authenticated dashboard user (so the key never has to be typed by hand).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV_DASHBOARD_KEY is not set on the web service" }, { status: 503 });
  }

  const origin = request.nextUrl.origin;
  return NextResponse.json({ url: `${origin}/tv?key=${process.env.TV_DASHBOARD_KEY}` });
}
