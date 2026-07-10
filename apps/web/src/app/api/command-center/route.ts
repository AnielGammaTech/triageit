import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { buildCommandCenterPayload } from "@/lib/api/command-center-data";

/**
 * GET /api/command-center — authenticated dashboard variant.
 * The TV wallboard uses the key-gated /api/tv/command instead.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "command-center");
  if (rl) return rl;

  try {
    const payload = await buildCommandCenterPayload();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[COMMAND-CENTER] Failed to build payload:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load command center data" }, { status: 500 });
  }
}
