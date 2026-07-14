import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/json-body";
import {
  createTvSessionToken,
  hashTvAccessCode,
  isValidTvAccessCode,
  TV_SESSION_COOKIE,
  TV_SESSION_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/request-context";

interface TvSessionBody {
  readonly code?: string;
}

export async function POST(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const clientIp = getClientIp(request);
  const limited = checkRateLimit(clientIp || "unknown-tv-client", 10, 15 * 60_000, "tv-session");
  if (limited) return limited;

  const parsed = await readJsonBody<TvSessionBody>(request, 4096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const code = body?.code;
  if (!isValidTvAccessCode(code)) {
    return NextResponse.json({ error: "Invalid, expired, or already used TV access" }, { status: 401 });
  }

  const serviceClient = await createServiceClient();
  const { data: consumed, error } = await serviceClient.rpc("consume_tv_access_token", {
    p_token_hash: hashTvAccessCode(code),
  });

  if (error) {
    console.error("[tv-session] Failed to redeem one-time token", error.code);
    return NextResponse.json({ error: "TV access is temporarily unavailable" }, { status: 503 });
  }

  if (consumed !== true) {
    return NextResponse.json({ error: "Invalid, expired, or already used TV access" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
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
