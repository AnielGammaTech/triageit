import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";

const schema = z.object({ phone: z.string().trim().min(7).max(40) });

function workerConfiguration() {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WORKER_SHARED_SECRET ?? process.env.TRIAGEIT_WORKER_SECRET;
  return { url, secret };
}

async function triggerWorker() {
  const { url, secret } = workerConfiguration();
  if (!url || !secret) throw new Error("The ScreenIT phone worker is not configured");
  const response = await fetch(`${url}/screenit-call-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`The phone worker returned ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return response.json() as Promise<{ called?: number }>;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  if (!hasScreenItDatabase()) return NextResponse.json({ call: null });
  const { candidateId } = await context.params;
  const supabase = getScreenItServiceClient();
  const { data, error } = await supabase.from("screenit_call_requests").select("id, phone, status, error, answered_at, completed_at, created_at, updated_at").eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ call: data });
}

export async function POST(request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  if (!hasScreenItDatabase()) return NextResponse.json({ error: "Candidate storage is not configured" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.phone.replace(/\D/g, "").length < 7) return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  const { candidateId } = await context.params;
  const supabase = getScreenItServiceClient();
  const { data: candidate, error: candidateError } = await supabase.from("screenit_candidates").select("id, screening_questions").eq("id", candidateId).maybeSingle();
  if (candidateError || !candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!Array.isArray(candidate.screening_questions) || candidate.screening_questions.length === 0) return NextResponse.json({ error: "Generate the résumé screening plan before calling" }, { status: 409 });

  const { data: active } = await supabase.from("screenit_call_requests").select("id, status, phone").eq("candidate_id", candidateId).in("status", ["pending", "calling", "connected"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let call = active;
  if (!call) {
    const { data, error } = await supabase.from("screenit_call_requests").insert({ candidate_id: candidateId, phone: parsed.data.phone, status: "pending" }).select("id, status, phone").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "A screening call is already active" }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    call = data;
  }

  await supabase.from("screenit_candidates").update({ phone: parsed.data.phone, interview_mode: "phone", stage: "interviewing", updated_at: new Date().toISOString() }).eq("id", candidateId);
  try {
    const result = await triggerWorker();
    if (!result.called && call.status === "pending") throw new Error("The worker did not start the pending call");
    return NextResponse.json({ call: { ...call, status: "calling", phone: parsed.data.phone } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    await supabase.from("screenit_call_requests").update({ status: "failed", error: message.slice(0, 500), completed_at: now, updated_at: now }).eq("id", call.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
