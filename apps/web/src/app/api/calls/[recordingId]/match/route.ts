import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function POST(request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 12, 60_000, "manual-call-match");
  if (limited) return limited;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "Worker unavailable" }, { status: 503 });
  const { recordingId } = await params;
  const body = await request.json().catch(() => ({})) as { halo_id?: unknown };
  const haloId = Number(body.halo_id);
  if (!Number.isInteger(haloId) || haloId <= 0) {
    return NextResponse.json({ error: "Enter a valid Halo ticket number" }, { status: 400 });
  }

  try {
    const response = await workerFetch(`${workerUrl}/calls/transcriptions/${encodeURIComponent(recordingId)}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halo_id: haloId }),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("[CALLS] Manual match failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not match the call" }, { status: 502 });
  }
}
