import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/cron-jobs/trigger
 * Triggers a specific cron job to run immediately via the worker.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const body = await request.json();
  const { job_id } = body;

  if (!job_id) {
    return NextResponse.json(
      { error: "job_id is required" },
      { status: 400 },
    );
  }

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "WORKER_URL not configured — cannot trigger cron job" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${workerUrl}/cron/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id }),
    });

    if (!response.ok) {
      console.error(`[API] Cron trigger failed: ${response.status}`);
      return NextResponse.json(
        { error: "Failed to trigger cron job" },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Cron trigger error:", error);
    return NextResponse.json(
      { error: "Failed to reach worker" },
      { status: 502 },
    );
  }
}
