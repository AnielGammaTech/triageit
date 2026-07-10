import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";

export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 500 });
  }

  const response = await workerFetch(`${workerUrl}/msgraph/setup/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw text.
  }

  return NextResponse.json(payload, { status: response.status });
}
