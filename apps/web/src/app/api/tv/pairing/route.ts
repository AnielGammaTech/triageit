import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/json-body";
import { getClientIp, getPublicOrigin } from "@/lib/api/request-context";
import {
  createTvPairingSecret,
  createTvSessionToken,
  hashTvPairingSecret,
  isValidTvPairingSecret,
  TV_PAIRING_MAX_AGE_SECONDS,
  TV_SESSION_COOKIE,
  TV_SESSION_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";
import { createServiceClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PollBody {
  readonly requestId?: string;
  readonly secret?: string;
}

function pairedResponse() {
  const response = NextResponse.json({ ok: true, source: "qr-pairing" });
  response.cookies.set(TV_SESSION_COOKIE, createTvSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/tv",
    maxAge: TV_SESSION_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Create a short-lived TV pairing request. The raw secret only goes to this TV. */
export async function POST(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const clientIp = getClientIp(request);
  const limited = checkRateLimit(clientIp || "unknown-tv-client", 8, 15 * 60_000, "tv-pairing-create");
  if (limited) return limited;

  const secret = createTvPairingSecret();
  const expiresAt = new Date(Date.now() + TV_PAIRING_MAX_AGE_SECONDS * 1000);
  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("tv_pairing_requests")
    .insert({
      secret_hash: hashTvPairingSecret(secret),
      requested_ip: clientIp,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[tv-pairing] Failed to create pairing request", error.code);
    return NextResponse.json({ error: "TV pairing is temporarily unavailable" }, { status: 503 });
  }

  // Keep the table bounded without making cleanup part of the success response.
  const { error: cleanupError } = await serviceClient
    .from("tv_pairing_requests")
    .delete()
    .lt("expires_at", new Date(Date.now() - 86400000).toISOString());
  if (cleanupError) console.warn("[tv-pairing] Failed to remove expired requests", cleanupError.code);

  const approvalUrl = new URL("/tv/approve", getPublicOrigin(request));
  approvalUrl.searchParams.set("request", data.id);
  approvalUrl.searchParams.set("secret", secret);

  return NextResponse.json({
    requestId: data.id,
    secret,
    approvalUrl: approvalUrl.toString(),
    expiresAt: expiresAt.toISOString(),
    detectedIp: clientIp,
  }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

/** Poll until an authenticated admin approves the QR request, then issue the TV cookie. */
export async function PUT(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const clientIp = getClientIp(request);
  const limited = checkRateLimit(clientIp || "unknown-tv-client", 360, 15 * 60_000, "tv-pairing-poll");
  if (limited) return limited;

  const parsed = await readJsonBody<PollBody>(request, 4096);
  if (!parsed.ok) return parsed.response;
  const requestId = parsed.data?.requestId || "";
  const secret = parsed.data?.secret || "";
  if (!UUID_PATTERN.test(requestId) || !isValidTvPairingSecret(secret)) {
    return NextResponse.json({ error: "Invalid TV pairing request" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();
  const secretHash = hashTvPairingSecret(secret);
  const now = new Date().toISOString();
  const { data: consumed, error: consumeError } = await serviceClient
    .from("tv_pairing_requests")
    .update({ consumed_at: now })
    .eq("id", requestId)
    .eq("secret_hash", secretHash)
    .is("consumed_at", null)
    .not("approved_at", "is", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();

  if (consumeError) {
    console.error("[tv-pairing] Failed to consume approved pairing", consumeError.code);
    return NextResponse.json({ error: "TV pairing is temporarily unavailable" }, { status: 503 });
  }
  if (consumed) return pairedResponse();

  const { data: pending, error: pendingError } = await serviceClient
    .from("tv_pairing_requests")
    .select("expires_at, approved_at, consumed_at")
    .eq("id", requestId)
    .eq("secret_hash", secretHash)
    .maybeSingle();

  if (pendingError) {
    console.error("[tv-pairing] Failed to read pairing status", pendingError.code);
    return NextResponse.json({ error: "TV pairing is temporarily unavailable" }, { status: 503 });
  }
  if (!pending || pending.consumed_at || new Date(pending.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "TV pairing request expired" }, { status: 410 });
  }

  return NextResponse.json({ ok: false, status: pending.approved_at ? "activating" : "waiting" }, {
    status: 202,
    headers: { "Cache-Control": "private, no-store" },
  });
}
