import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json() as { halo_id?: number };
  if (!body.halo_id) {
    return NextResponse.json({ error: "halo_id is required" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_URL ?? "http://localhost:3001";

  try {
    const res = await fetch(`${workerUrl}/kb-ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ halo_id: body.halo_id }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Worker error" }));
      return NextResponse.json(errData, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
