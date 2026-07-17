import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 20, 60_000, "dispatch-customer-update-dismiss");
  if (limited) return limited;
  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });

  const { id } = await params;
  try {
    const response = await workerFetch(`${workerUrl}/dispatch/customer-updates/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by_user_id: auth.user.id, approved_by_email: auth.user.email ?? null }),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("[DISPATCH-UPDATES] Dismiss failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to dismiss customer update" }, { status: 502 });
  }
}
