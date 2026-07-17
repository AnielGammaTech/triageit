import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/api/worker";
import { secureTokenEqual } from "@/lib/api/secure-token";
import { readJsonBody } from "@/lib/api/json-body";

interface EmbedCloseReviewBody {
  readonly halo_id?: number;
  readonly token?: string;
}

export async function POST(request: Request) {
  try {
    const parsed = await readJsonBody<EmbedCloseReviewBody>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const secret = process.env.EMBED_SECRET;
    if (!secureTokenEqual(body.token, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body.halo_id || typeof body.halo_id !== "number") {
      return NextResponse.json({ error: "Missing or invalid halo_id" }, { status: 400 });
    }

    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) {
      return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });
    }

    const res = await workerFetch(`${workerUrl}/close-review`, {
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
