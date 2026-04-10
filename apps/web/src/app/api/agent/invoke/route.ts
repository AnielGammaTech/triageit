import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json() as { halo_id?: number; agent_name?: string; prompt?: string };
  const { halo_id, agent_name, prompt } = body;

  if (!halo_id || !agent_name) {
    return NextResponse.json({ error: "halo_id and agent_name required" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";

  try {
    const res = await fetch(`${workerUrl}/agent/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halo_id, agent_name, prompt }),
      signal: AbortSignal.timeout(120_000),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
