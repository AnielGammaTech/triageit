import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

/**
 * GET /api/dispatch/suggest — authenticated proxy to the worker's
 * assignment suggestion endpoint (top techs per unassigned ticket).
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "dispatch-suggest");
  if (rl) return rl;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });
  }

  try {
    const response = await workerFetch(`${workerUrl}/dispatch/suggest`);

    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Keep raw text.
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (err) {
    console.error("[DISPATCH-SUGGEST] Worker fetch failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load assignment suggestions" }, { status: 502 });
  }
}
