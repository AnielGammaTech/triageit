import { NextResponse } from "next/server";

/**
 * POST /api/embed/kb-ideas
 * Proxy to worker's /kb-ideas endpoint with embed token auth.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { halo_id?: number; token?: string };
  const { halo_id, token } = body;

  const secret = process.env.EMBED_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!halo_id) {
    return NextResponse.json({ error: "halo_id required" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";

  try {
    const res = await fetch(`${workerUrl}/kb-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halo_id }),
      signal: AbortSignal.timeout(120000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
