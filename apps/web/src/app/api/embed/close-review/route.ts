import { NextResponse } from "next/server";

interface EmbedCloseReviewBody {
  readonly halo_id?: number;
  readonly token?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EmbedCloseReviewBody;

    const secret = process.env.EMBED_SECRET;
    if (!secret || body.token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body.halo_id || typeof body.halo_id !== "number") {
      return NextResponse.json({ error: "Missing or invalid halo_id" }, { status: 400 });
    }

    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) {
      return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });
    }

    const res = await fetch(`${workerUrl}/close-review`, {
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
