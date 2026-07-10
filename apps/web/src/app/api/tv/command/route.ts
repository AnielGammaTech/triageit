import { NextResponse, type NextRequest } from "next/server";
import { buildCommandCenterPayload } from "@/lib/api/command-center-data";
import { isValidTvKey, tvKeyConfigured } from "@/lib/api/tv-key";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/tv/command — key-gated Command Center data for the TV wallboard.
 * Auth: x-tv-key header (preferred) or ?key= query param, checked against
 * the TV_DASHBOARD_KEY env var. Exempted from Supabase middleware.
 */
export async function GET(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const key = request.headers.get("x-tv-key") ?? request.nextUrl.searchParams.get("key");
  if (!isValidTvKey(key)) {
    return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
  }

  const rl = checkRateLimit("tv-wallboard", 30, 60_000, "tv-command");
  if (rl) return rl;

  try {
    const payload = await buildCommandCenterPayload();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[TV-COMMAND] Failed to build payload:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load command center data" }, { status: 500 });
  }
}
