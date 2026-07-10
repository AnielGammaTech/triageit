import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 500 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing setup id" }, { status: 400 });
  }

  const response = await workerFetch(
    `${workerUrl}/msgraph/setup/status?id=${encodeURIComponent(id)}`,
  );

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw text.
  }

  return NextResponse.json(payload, { status: response.status });
}
