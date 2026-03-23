import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

interface LoginEventBody {
  readonly user_id: string;
  readonly user_agent: string;
}

/**
 * Parse user-agent string into browser, OS, and device type.
 */
function parseUserAgent(ua: string): {
  readonly browser: string;
  readonly os: string;
  readonly device_type: string;
} {
  // Browser detection
  let browser = "Unknown";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome")) browser = "Safari";

  // OS detection
  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  // Device type
  let device_type = "desktop";
  if (ua.includes("Mobi") || ua.includes("Android") && !ua.includes("Tablet")) {
    device_type = "mobile";
  } else if (ua.includes("iPad") || ua.includes("Tablet")) {
    device_type = "tablet";
  }

  return { browser, os, device_type };
}

/**
 * POST /api/auth/login-event
 * Record a login event with device/IP info.
 * Called client-side after successful authentication.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as LoginEventBody;

    if (!body.user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const userAgent = body.user_agent || request.headers.get("user-agent") || "";
    const { browser, os, device_type } = parseUserAgent(userAgent);

    // Extract IP from headers (Railway/Vercel forward real IP)
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const serviceClient = await createServiceClient();

    const { error } = await serviceClient.from("login_events").insert({
      user_id: body.user_id,
      ip_address: ip,
      user_agent: userAgent,
      device_type,
      browser,
      os,
    });

    if (error) {
      console.error("[login-event] Failed to insert:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login-event] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
