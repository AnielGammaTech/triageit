import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 60, 60_000, "dispatch-response-compliance");
  if (limited) return limited;
  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });

  try {
    const response = await workerFetch(`${workerUrl}/dispatch/response-compliance`);
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("[RESPONSE-COMPLIANCE] Worker fetch failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load response compliance" }, { status: 502 });
  }
}

