import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/cron-jobs/trigger
 * Triggers a specific cron job to run immediately via the worker.
 */
export async function POST(request: NextRequest) {
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
      const text = await response.text();
      return NextResponse.json(
        { error: `Worker returned ${response.status}: ${text}` },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach worker: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
