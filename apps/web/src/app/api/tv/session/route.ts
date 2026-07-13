import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/json-body";
import {
  createTvSessionToken,
  isValidTvKey,
  isValidTvLinkToken,
  TV_SESSION_COOKIE,
  TV_SESSION_MAX_AGE_SECONDS,
  tvKeyConfigured,
} from "@/lib/api/tv-key";

interface TvSessionBody {
  readonly access?: string;
  readonly key?: string;
}

export async function POST(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const limited = checkRateLimit(forwardedFor || "unknown-tv-client", 10, 15 * 60_000, "tv-session");
  if (limited) return limited;

  const parsed = await readJsonBody<TvSessionBody>(request, 4096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const valid = Boolean(
    (body?.access && isValidTvLinkToken(body.access))
    || (body?.key && isValidTvKey(body.key)),
  );
  if (!valid) return NextResponse.json({ error: "Invalid or expired TV access" }, { status: 401 });

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
