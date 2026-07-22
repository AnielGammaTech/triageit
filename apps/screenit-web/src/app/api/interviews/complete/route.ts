import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInterviewByToken } from "@/lib/data";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";
import type { CandidateReport, RequirementEvidence } from "@/lib/screenit-types";
import { buildEvidenceReportPrompt, calibrateGeneratedReport, generatedReportJsonSchema, generatedReportSchema, type GeneratedReport } from "@/lib/report-calibration";
import { consumeRateLimit, requestFingerprint } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(6).max(256),
  transcript: z.array(z.object({ speaker: z.enum(["ScreenIT", "Candidate"]), text: z.string().min(1).max(8000) })).max(100),
});

async function generateReport(requirements: readonly string[], transcript: string): Promise<GeneratedReport> {
  const fallback: RequirementEvidence[] = requirements.map((requirement) => ({ requirement, level: "unclear", evidence: "A recruiter should review the interview transcript for relevant evidence." }));
  const fallbackReport: GeneratedReport = { summary: "The structured interview is complete and ready for human review.", evidence: fallback, clarifications: requirements.slice(0, 2).map((item) => `Confirm evidence for: ${item}`), roleAlignment: "insufficient_evidence", fitRationale: "There is not enough explicit interview evidence to assess alignment to the role requirements.", statedMotivation: "Not discussed.", conversationSignals: [], answerQuality: "insufficient", answerQualityRationale: "There was not enough usable candidate response content to assess answer quality.", answerConcerns: [] };
  if (!process.env.OPENAI_API_KEY || !transcript.trim()) return fallbackReport;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({
      model: process.env.SCREENIT_REPORT_MODEL ?? "gpt-5-mini",
      store: false,
      input: buildEvidenceReportPrompt(requirements, transcript),
      text: { format: { type: "json_schema", name: "candidate_evidence_report", strict: true, schema: generatedReportJsonSchema } },
    }) });
    if (!response.ok) throw new Error(`Report model returned ${response.status}`);
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("Report model returned no text");
    const parsed = generatedReportSchema.parse(JSON.parse(outputText));
    return calibrateGeneratedReport(parsed, requirements);
  } catch (error) {
    console.error("[ScreenIT] Evidence report generation failed", error);
    return { ...fallbackReport, clarifications: ["Review the transcript before deciding next steps."], fitRationale: "The AI report could not be completed, so a recruiter must review the transcript directly." };
  }
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid interview transcript is required" }, { status: 400 });
  const rateLimit = consumeRateLimit(`complete:${parsed.data.token}:${requestFingerprint(request)}`, 5, 60 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many completion attempts. Please contact the recruiter." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const interview = await getInterviewByToken(parsed.data.token);
  if (!interview) return NextResponse.json({ error: "Interview invitation not found" }, { status: 404 });
  if (!hasScreenItDatabase()) return NextResponse.json({ error: "Candidate storage is not configured" }, { status: 503 });
  const transcriptText = parsed.data.transcript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  const generated = await generateReport(interview.position.requirements, transcriptText);
  const report: CandidateReport = { id: crypto.randomUUID(), candidateId: interview.candidate.id, ...generated, recommendation: "recruiter_review", generatedAt: new Date().toISOString() };
  const supabase = getScreenItServiceClient();
  const [reportResult, candidateResult, interviewResult] = await Promise.all([
    supabase.from("screenit_reports").upsert({ id: report.id, candidate_id: report.candidateId, summary: report.summary, requirement_evidence: report.evidence, clarifications: report.clarifications, recommendation: report.recommendation, role_alignment: report.roleAlignment, fit_rationale: report.fitRationale, stated_motivation: report.statedMotivation, conversation_signals: report.conversationSignals, answer_quality: report.answerQuality, answer_quality_rationale: report.answerQualityRationale, answer_concerns: report.answerConcerns, generated_at: report.generatedAt }, { onConflict: "candidate_id" }),
    supabase.from("screenit_candidates").update({ stage: "review", completed_at: report.generatedAt }).eq("id", report.candidateId),
    supabase.from("screenit_interviews").upsert({ candidate_id: report.candidateId, consented_at: new Date().toISOString(), transcript: parsed.data.transcript, completed_at: report.generatedAt }, { onConflict: "candidate_id" }),
  ]);
  const persistenceError = reportResult.error ?? candidateResult.error ?? interviewResult.error;
  if (persistenceError) {
    console.error("[ScreenIT] Interview persistence failed", persistenceError);
    return NextResponse.json({ error: "The report was created but could not be saved. Please retry." }, { status: 500 });
  }
  return NextResponse.json({ report });
}
