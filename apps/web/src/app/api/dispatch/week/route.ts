import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "dispatch-week");
  if (rl) return rl;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });
  }

  const start = new URL(request.url).searchParams.get("start");
  const qs = start ? `?start=${encodeURIComponent(start)}` : "";

  try {
    const response = await workerFetch(`${workerUrl}/dispatch/week${qs}`);
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Keep raw text.
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (err) {
    console.error("[API] dispatch/week proxy failed:", err);
    return NextResponse.json({ error: "Worker unreachable" }, { status: 502 });
  }
}
