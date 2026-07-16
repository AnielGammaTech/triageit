import { NextResponse, type NextRequest } from "next/server";
import {
  createTvSessionToken,
  isValidTvSessionToken,
  TV_SESSION_COOKIE,
  TV_SESSION_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/request-context";

function authorizedResponse(source: "session" | "trusted-ip") {
  const response = NextResponse.json({ ok: true, source });
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

export async function GET(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const existing = request.cookies.get(TV_SESSION_COOKIE)?.value;
  if (existing && isValidTvSessionToken(existing)) {
    return authorizedResponse("session");
  }

  const clientIp = getClientIp(request);
  if (!clientIp) {
    return NextResponse.json({ error: "TV device approval required" }, { status: 401 });
  }

  try {
    const serviceClient = await createServiceClient();
    const { data: trusted, error } = await serviceClient.rpc("is_tv_ip_trusted", { p_ip: clientIp });
    if (error) {
      console.warn("[tv-session] Trusted-IP check failed", error.code);
      return NextResponse.json({ error: "TV device approval required" }, { status: 401 });
    }
    if (trusted === true) return authorizedResponse("trusted-ip");
  } catch (error) {
    console.warn("[tv-session] Trusted-IP check unavailable", (error as Error).message);
  }

  return NextResponse.json({ error: "TV device approval required" }, { status: 401 });
}
