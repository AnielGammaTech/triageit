import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";

/**
 * POST /api/admin/health/toby-analyze
 * Trigger Toby Flenderson's daily analysis manually via the worker service.
 */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { success: false, error: "WORKER_URL not configured" },
      { status: 500 },
    );
  }

  try {
    const response = await workerFetch(`${workerUrl}/toby/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { success: false, error: `Toby analysis failed: ${response.status}`, details: errText },
        { status: 500 },
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: "Toby analysis complete",
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
