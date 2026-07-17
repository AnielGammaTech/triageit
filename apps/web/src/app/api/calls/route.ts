import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 30, 60_000, "call-transcriptions");
  if (limited) return limited;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "Worker unavailable" }, { status: 503 });
  try {
    const response = await workerFetch(`${workerUrl}/calls/transcriptions`);
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Preserve the upstream body for diagnostics.
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("[CALLS] Worker fetch failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load 3CX calls" }, { status: 502 });
  }
}
