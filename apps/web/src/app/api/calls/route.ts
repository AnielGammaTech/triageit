import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getWorkerUrl, workerFetch } from "@/lib/api/worker";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const limited = checkRateLimit(auth.user.id, 30, 60_000, "call-transcriptions");
  if (limited) return limited;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) return NextResponse.json({ error: "Worker unavailable" }, { status: 503 });
  try {
    const [response, profileResult] = await Promise.all([
      workerFetch(`${workerUrl}/calls/transcriptions`),
      (await createClient())
        .from("profiles")
        .select("full_name, role")
        .eq("id", auth.user.id)
        .maybeSingle(),
    ]);
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Preserve the upstream body for diagnostics.
    }
    const profile = profileResult.data;
    const enriched = payload && typeof payload === "object" && !Array.isArray(payload)
      ? {
          ...(payload as Record<string, unknown>),
          viewer: {
            name: profile?.full_name?.trim() || null,
            role: profile?.role ?? "viewer",
          },
        }
      : payload;
    return NextResponse.json(enriched, { status: response.status });
  } catch (error) {
    console.error("[CALLS] Worker fetch failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load 3CX calls" }, { status: 502 });
  }
}
