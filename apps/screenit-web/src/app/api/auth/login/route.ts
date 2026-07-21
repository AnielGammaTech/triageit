import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createScreenItSession, SCREENIT_SESSION_COOKIE, SCREENIT_SESSION_SECONDS } from "@/lib/basic-session";
import { verifyPassword } from "@/lib/password";
import { consumeRateLimit, requestFingerprint } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  const limit = consumeRateLimit(`login:${requestFingerprint(request)}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Please wait and try again." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const configuredEmail = process.env.SCREENIT_ADMIN_EMAIL?.trim().toLowerCase();
  const configuredHash = process.env.SCREENIT_ADMIN_PASSWORD_HASH;
  const secret = process.env.SCREENIT_AUTH_SECRET;
  if (!configuredEmail || !configuredHash || !secret) return NextResponse.json({ error: "ScreenIT login is not configured." }, { status: 503 });
  const emailMatches = parsed.data.email.trim().toLowerCase() === configuredEmail;
  const passwordMatches = await verifyPassword(parsed.data.password, configuredHash);
  if (!emailMatches || !passwordMatches) return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SCREENIT_SESSION_COOKIE, await createScreenItSession(configuredEmail, secret), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SCREENIT_SESSION_SECONDS });
  return response;
}
