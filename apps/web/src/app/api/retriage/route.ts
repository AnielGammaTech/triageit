import { NextResponse } from "next/server";

/**
 * POST /api/retriage
 *
 * Triggers a full daily re-triage scan on the worker.
 * Pulls all open tickets from Halo, runs rule checks + AI analysis,
 * updates ticket tracking columns, and sends Teams notifications.
 */
export async function POST() {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "WORKER_URL not configured — cannot trigger re-triage" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${workerUrl}/retriage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Worker returned ${response.status}: ${text}` },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json({ status: "completed", ...result });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach worker: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
