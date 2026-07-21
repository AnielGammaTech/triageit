import { NextResponse, type NextRequest } from "next/server";
import { SCREENIT_SESSION_COOKIE, verifyScreenItSession } from "@/lib/basic-session";

const publicPaths = ["/login", "/api/auth/login", "/api/health", "/api/realtime/session", "/api/interviews/complete"];

function isPublic(pathname: string) {
  return pathname.startsWith("/interview/") || publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next({ request });
  if (process.env.NODE_ENV !== "production" && process.env.SCREENIT_DEMO_MODE === "true") return NextResponse.next({ request });
  const authenticated = await verifyScreenItSession(request.cookies.get(SCREENIT_SESSION_COOKIE)?.value, process.env.SCREENIT_AUTH_SECRET ?? "");
  if (!authenticated) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next({ request });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
