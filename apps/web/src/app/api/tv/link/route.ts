import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import {
  createTvLinkToken,
  hashTvLinkToken,
  TV_LINK_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";

/**
 * POST /api/tv/link creates a short-lived, single-use TV wallboard link for an
 * authenticated admin. Only the token hash is stored.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV_DASHBOARD_KEY is not set on the web service" }, { status: 503 });
  }

  const origin = request.nextUrl.origin;
  const now = Date.now();
  const access = createTvLinkToken(now);
  const expiresAt = new Date(now + TV_LINK_MAX_AGE_SECONDS * 1000);
  const { error } = await auth.serviceClient.from("tv_access_tokens").insert({
    token_hash: hashTvLinkToken(access),
    created_by: auth.user.id,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("[tv-link] Failed to persist one-time token", error.code);
    return NextResponse.json({ error: "TV access is temporarily unavailable" }, { status: 503 });
  }

  // Keep the token table bounded without making cleanup part of the request's success response.
  const { error: cleanupError } = await auth.serviceClient
    .from("tv_access_tokens")
    .delete()
    .lt("expires_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());
  if (cleanupError) console.warn("[tv-link] Failed to remove old tokens", cleanupError.code);

  return NextResponse.json(
    {
      url: `${origin}/tv#access=${encodeURIComponent(access)}`,
      expiresAt: expiresAt.toISOString(),
      singleUse: true,
    },
    { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } },
  );
}
