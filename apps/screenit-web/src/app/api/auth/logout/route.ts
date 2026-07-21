import { NextResponse } from "next/server";
import { SCREENIT_SESSION_COOKIE } from "@/lib/basic-session";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SCREENIT_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
