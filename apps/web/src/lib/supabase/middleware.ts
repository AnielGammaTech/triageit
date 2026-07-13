import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function applySecurityHeaders(response: NextResponse, allowFrame = false): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", allowFrame ? "no-referrer" : "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", allowFrame
    ? "camera=(), geolocation=(), microphone=(), clipboard-write=(self)"
    : "camera=(), geolocation=(), microphone=()");
  if (!allowFrame) {
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
  }
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip auth entirely for webhooks and public APIs — no Supabase call needed
  const isWebhook = pathname.startsWith("/api/webhooks");
  const isPublicApi = pathname.startsWith("/api/stream");
  const isHealthCheck = pathname === "/api/health";
  const isEmbed = pathname.startsWith("/embed");
  const isEmbedApi = pathname.startsWith("/api/embed/");
  // TV wallboard: key-gated (TV_DASHBOARD_KEY) inside the route/page, not Supabase
  const isTv = pathname === "/tv" || pathname.startsWith("/api/tv/");

  if (isWebhook || isPublicApi || isHealthCheck || isEmbedApi || isTv) {
    const response = applySecurityHeaders(NextResponse.next({ request }));
    if (isEmbedApi || isTv) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return response;
  }

  // Embed pages: allow framing (for Halo iframe) and clipboard access
  if (isEmbed) {
    const response = applySecurityHeaders(NextResponse.next({ request }), true);
    const configuredOrigin = process.env.HALO_EMBED_ORIGIN;
    let frameOrigin = "";
    try {
      const parsed = configuredOrigin ? new URL(configuredOrigin) : null;
      if (parsed && (parsed.protocol === "https:" || parsed.protocol === "http:")) frameOrigin = parsed.origin;
    } catch {
      frameOrigin = "";
    }
    response.headers.set("Content-Security-Policy", `frame-ancestors 'self'${frameOrigin ? ` ${frameOrigin}` : ""};`);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  let supabaseResponse = applySecurityHeaders(NextResponse.next({ request }));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isAuthPage = pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api/");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[MIDDLEWARE] Missing Supabase env vars");
    if (isAuthPage) return supabaseResponse;
    return applySecurityHeaders(NextResponse.json(
      { error: "Authentication service is not configured" },
      { status: isApiRoute ? 503 : 500 },
    ));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = applySecurityHeaders(NextResponse.next({ request }));
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    console.error("[MIDDLEWARE] Auth check failed:", (err as Error).message);
    if (isAuthPage) return supabaseResponse;
    return applySecurityHeaders(NextResponse.json(
      { error: "Authentication service is temporarily unavailable" },
      { status: isApiRoute ? 503 : 500 },
    ));
  }

  if (!user && !isAuthPage) {
    if (isApiRoute) {
      return applySecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/tickets";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return supabaseResponse;
}
