import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import {
  createTvAccessCode,
  hashTvAccessCode,
  TV_LINK_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";
import { getPublicOrigin } from "@/lib/api/request-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tvUrl(request: NextRequest): string {
  return `${getPublicOrigin(request)}/tv`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.serviceClient
    .from("tv_access_tokens")
    .select("id, code_hint, created_at, expires_at")
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[tv-link] Failed to list active codes", error.code);
    return NextResponse.json({ error: "TV access is temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { tvUrl: tvUrl(request), links: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * POST /api/tv/link creates a short-lived, single-use TV access code for an
 * authenticated admin. Only the code hash and a non-secret hint are stored.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV_DASHBOARD_KEY is not set on the web service" }, { status: 503 });
  }

  const now = Date.now();
  const accessCode = createTvAccessCode();
  const expiresAt = new Date(now + TV_LINK_MAX_AGE_SECONDS * 1000);
  const { data, error } = await auth.serviceClient
    .from("tv_access_tokens")
    .insert({
      token_hash: hashTvAccessCode(accessCode),
      code_hint: accessCode.slice(-4),
      created_by: auth.user.id,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

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

  const publicTvUrl = tvUrl(request);
  return NextResponse.json(
    {
      id: data.id,
      tvUrl: publicTvUrl,
      accessCode,
      setupUrl: `${publicTvUrl}#code=${encodeURIComponent(accessCode)}`,
      expiresAt: expiresAt.toISOString(),
      singleUse: true,
    },
    { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } },
  );
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "A valid access-code ID is required" }, { status: 400 });
  }

  const { data, error } = await auth.serviceClient
    .from("tv_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    console.error("[tv-link] Failed to revoke access code", error.code);
    return NextResponse.json({ error: "Could not revoke the access code" }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Access code was already used, expired, or revoked" }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
