import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";
import { readJsonBody } from "@/lib/api/json-body";

/**
 * POST /api/cron-jobs/trigger
 * Triggers a specific cron job to run immediately via the worker.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const parsed = await readJsonBody<{ job_id?: unknown }>(request, 4096);
  if (!parsed.ok) return parsed.response;
  const { job_id } = parsed.data;

  if (typeof job_id !== "string" || !/^[0-9a-f-]{36}$/i.test(job_id)) {
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
    const response = await workerFetch(`${workerUrl}/cron/trigger`, {
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
