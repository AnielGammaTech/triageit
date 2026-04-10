import { NextResponse } from "next/server";

/**
 * POST /api/embed/agent-invoke
 * Proxy to worker's /agent/invoke endpoint with embed token auth.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { halo_id?: number; agent_name?: string; token?: string };
  const { halo_id, agent_name, token } = body;

  const secret = process.env.EMBED_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!halo_id || !agent_name) {
    return NextResponse.json({ error: "halo_id and agent_name required" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";

  try {
    const res = await fetch(`${workerUrl}/agent/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halo_id, agent_name }),
      signal: AbortSignal.timeout(120000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
