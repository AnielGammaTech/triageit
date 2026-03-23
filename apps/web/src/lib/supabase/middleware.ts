import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Skip auth entirely for webhooks and public APIs — no Supabase call needed
  const isWebhook = request.nextUrl.pathname.startsWith("/api/webhooks");
  const isPublicApi = request.nextUrl.pathname.startsWith("/api/stream");
  const isHealthCheck = request.nextUrl.pathname === "/api/health";
  const isEmbed = request.nextUrl.pathname.startsWith("/embed");
  const isEmbedApi =
    request.nextUrl.pathname === "/api/summarize" ||
    request.nextUrl.pathname === "/api/triage";

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

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[MIDDLEWARE] Missing Supabase env vars");
    return supabaseResponse;
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
    // Supabase fetch failed (network hiccup, DNS issue, etc.)
    // Don't crash the entire app — let the request through and
    // individual pages will handle missing auth gracefully
    console.error("[MIDDLEWARE] Auth check failed:", (err as Error).message);
    return supabaseResponse;
  }

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");

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
