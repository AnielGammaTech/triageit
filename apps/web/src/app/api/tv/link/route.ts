import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { createTvLinkToken, tvKeyConfigured } from "@/lib/api/tv-key";

/**
 * GET /api/tv/link — returns the shareable TV wallboard URL to an
 * admin dashboard user (so the key never has to be typed by hand).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV_DASHBOARD_KEY is not set on the web service" }, { status: 503 });
  }

  const origin = request.nextUrl.origin;
  const access = createTvLinkToken();
  return NextResponse.json(
    { url: `${origin}/tv?access=${encodeURIComponent(access)}` },
    { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } },
  );
}
