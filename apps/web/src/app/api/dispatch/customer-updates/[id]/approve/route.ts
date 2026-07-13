import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 12, 60_000, "dispatch-customer-update-approve");
  if (limited) return limited;
  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { draft_message?: unknown };
  try {
    const response = await workerFetch(`${workerUrl}/dispatch/customer-updates/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft_message: typeof body.draft_message === "string" ? body.draft_message : "",
        approved_by_user_id: auth.user.id,
        approved_by_email: auth.user.email ?? null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("[DISPATCH-UPDATES] Approve failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to approve customer update" }, { status: 502 });
  }
}
