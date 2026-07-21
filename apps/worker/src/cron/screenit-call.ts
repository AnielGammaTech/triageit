import { createSupabaseClient } from "../db/supabase.js";
import { CallControlClient } from "../voice/call-control.js";
import { registerScreeningCall } from "../voice/listener.js";
import type { ScreeningCallContext } from "../voice/screening-handler.js";
import type { ThreeCxConfig } from "@triageit/shared";

const ROUTE_POINT_DN = process.env.VOICE_ROUTE_POINT_DN ?? "triageit";

interface ScreeningQuestionRow {
  readonly prompt?: unknown;
  readonly reason?: unknown;
}

function questionsFrom(value: unknown): ScreeningCallContext["questions"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as ScreeningQuestionRow;
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    if (!prompt) return [];
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    return [{ prompt, ...(reason ? { reason } : {}) }];
  }).slice(0, 8);
}

export async function runScreeningCallRequests(): Promise<{ processed: number; called: number }> {
  const supabase = createSupabaseClient();
  const { data: requests, error: requestError } = await supabase
    .from("screenit_call_requests")
    .select("id, candidate_id, phone")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3);
  if (requestError) throw new Error(requestError.message);
  if (!requests?.length) return { processed: 0, called: 0 };

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "threecx")
    .eq("is_active", true)
    .maybeSingle();
  if (integrationError || !integration) {
    throw new Error("The active 3CX Call Control integration is not available");
  }
  const cc = new CallControlClient(integration.config as ThreeCxConfig);
  let called = 0;

  for (const request of requests) {
    try {
      const { data: candidate, error: candidateError } = await supabase
        .from("screenit_candidates")
        .select("id, position_id, full_name, public_invite_token, screening_questions")
        .eq("id", request.candidate_id)
        .maybeSingle();
      if (candidateError || !candidate) throw new Error(candidateError?.message ?? "Candidate not found");

      const { data: position, error: positionError } = await supabase
        .from("screenit_positions")
        .select("title, questions")
        .eq("id", candidate.position_id)
        .maybeSingle();
      if (positionError || !position) throw new Error(positionError?.message ?? "Position not found");

      const phone = String(request.phone ?? "").trim();
      const questions = questionsFrom(candidate.screening_questions).length
        ? questionsFrom(candidate.screening_questions)
        : questionsFrom(position.questions);
      if (!phone) throw new Error("Candidate phone number is missing");
      if (!questions.length) throw new Error("Generate a screening plan before placing the call");

      const cancelRegistration = registerScreeningCall(phone, {
        requestId: String(request.id),
        candidateId: String(candidate.id),
        inviteToken: String(candidate.public_invite_token),
        candidateName: String(candidate.full_name),
        positionTitle: String(position.title),
        questions,
      }, () => {
        void supabase.from("screenit_call_requests").update({
          status: "no_answer",
          error: "The candidate did not answer within 60 seconds",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", request.id);
      });

      const ok = await cc.makecall(ROUTE_POINT_DN, phone, 20 * 60);
      if (!ok) cancelRegistration();
      const now = new Date().toISOString();
      await supabase.from("screenit_call_requests").update({
        status: ok ? "calling" : "failed",
        error: ok ? null : "3CX did not accept the outbound call",
        updated_at: now,
        ...(ok ? {} : { completed_at: now }),
      }).eq("id", request.id);
      if (ok) {
        called++;
        console.log(`[SCREENIT-CALL] Dialing ${phone} for ${candidate.full_name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SCREENIT-CALL] Request ${request.id} failed:`, message);
      const now = new Date().toISOString();
      await supabase.from("screenit_call_requests").update({ status: "failed", error: message.slice(0, 500), completed_at: now, updated_at: now }).eq("id", request.id);
    }
  }

  return { processed: requests.length, called };
}
