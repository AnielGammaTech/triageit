import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip auth entirely for webhooks and public APIs — no Supabase call needed
  const isWebhook = pathname.startsWith("/api/webhooks");
  const isPublicApi = pathname.startsWith("/api/stream");
  const isHealthCheck = pathname === "/api/health";
  const isEmbed = pathname.startsWith("/embed");
  const isEmbedApi = pathname.startsWith("/api/embed/");

  if (isWebhook || isPublicApi || isHealthCheck || isEmbedApi) {
    return NextResponse.next({ request });
  }

  // Embed pages: allow framing (for Halo iframe) and clipboard access
  if (isEmbed) {
    const response = NextResponse.next({ request });
    response.headers.set("X-Frame-Options", "ALLOWALL");
    response.headers.delete("X-Frame-Options"); // Remove restrictive default
    response.headers.set("Permissions-Policy", "clipboard-write=(self)");
    response.headers.set("Content-Security-Policy", "frame-ancestors *;");
    return response;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isAuthPage = pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api/");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[MIDDLEWARE] Missing Supabase env vars");
    if (isAuthPage) return supabaseResponse;
    return NextResponse.json(
      { error: "Authentication service is not configured" },
      { status: isApiRoute ? 503 : 500 },
    );
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
        supabaseResponse = NextResponse.next({ request });
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
    return NextResponse.json(
      { error: "Authentication service is temporarily unavailable" },
      { status: isApiRoute ? 503 : 500 },
    );
  }

  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/tickets";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
