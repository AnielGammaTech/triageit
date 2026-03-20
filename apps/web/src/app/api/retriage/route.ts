import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/retriage
 *
 * Triggers a full daily re-triage scan on the worker.
 * Pulls all open tickets from Halo, runs rule checks + AI analysis,
 * updates ticket tracking columns, and sends Teams notifications.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 10, 60_000, "retriage");
  if (rateLimited) return rateLimited;

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
      console.error(`[API] Retriage failed: ${response.status}`);
      return NextResponse.json(
        { error: "Retriage scan failed" },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json({ status: "completed", ...result });
  } catch (error) {
    console.error("[API] Retriage error:", error);
    return NextResponse.json(
      { error: "Failed to reach worker" },
      { status: 502 },
    );
  }
}
