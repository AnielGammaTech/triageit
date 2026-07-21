import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInterviewByToken } from "@/lib/data";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";
import type { CandidateReport, RequirementEvidence } from "@/lib/screenit-types";
import { consumeRateLimit, requestFingerprint } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(6).max(256),
  transcript: z.array(z.object({ speaker: z.enum(["ScreenIT", "Candidate"]), text: z.string().min(1).max(8000) })).max(100),
});

async function generateReport(requirements: readonly string[], transcript: string): Promise<Pick<CandidateReport, "summary" | "evidence" | "clarifications">> {
  const fallback: RequirementEvidence[] = requirements.map((requirement) => ({ requirement, level: "unclear", evidence: "A recruiter should review the interview transcript for relevant evidence." }));
  if (!process.env.OPENAI_API_KEY || !transcript.trim()) return { summary: "The structured interview is complete and ready for human review.", evidence: fallback, clarifications: requirements.slice(0, 2).map((item) => `Confirm evidence for: ${item}`) };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({
      model: process.env.SCREENIT_REPORT_MODEL ?? "gpt-5-mini",
      input: `Create a structured recruiter evidence report. Use only explicit job-related statements in the transcript. Never infer protected traits, personality, emotion, accent, honesty, culture fit, or a hiring recommendation. Requirements:\n${requirements.map((item) => `- ${item}`).join("\n")}\n\nTranscript:\n${transcript}`,
      text: { format: { type: "json_schema", name: "candidate_evidence_report", strict: true, schema: { type: "object", additionalProperties: false, required: ["summary", "evidence", "clarifications"], properties: { summary: { type: "string" }, evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["requirement", "level", "evidence"], properties: { requirement: { type: "string" }, level: { type: "string", enum: ["demonstrated", "partial", "unclear", "not_demonstrated"] }, evidence: { type: "string" } } } }, clarifications: { type: "array", items: { type: "string" } } } } } },
    }) });
    if (!response.ok) throw new Error(`Report model returned ${response.status}`);
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("Report model returned no text");
    return JSON.parse(outputText) as Pick<CandidateReport, "summary" | "evidence" | "clarifications">;
  } catch (error) {
    console.error("[ScreenIT] Evidence report generation failed", error);
    return { summary: "The structured interview is complete and ready for human review.", evidence: fallback, clarifications: ["Review the transcript before deciding next steps."] };
  }
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid interview transcript is required" }, { status: 400 });
  const rateLimit = consumeRateLimit(`complete:${parsed.data.token}:${requestFingerprint(request)}`, 5, 60 * 60 * 1000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many completion attempts. Please contact the recruiter." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const interview = await getInterviewByToken(parsed.data.token);
  if (!interview) return NextResponse.json({ error: "Interview invitation not found" }, { status: 404 });
  const transcriptText = parsed.data.transcript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  const generated = await generateReport(interview.position.requirements, transcriptText);
  const report: CandidateReport = { id: crypto.randomUUID(), candidateId: interview.candidate.id, ...generated, recommendation: "recruiter_review", generatedAt: new Date().toISOString() };
  if (hasScreenItDatabase()) {
    const supabase = getScreenItServiceClient();
    const { error } = await supabase.from("screenit_reports").upsert({ id: report.id, candidate_id: report.candidateId, summary: report.summary, requirement_evidence: report.evidence, clarifications: report.clarifications, recommendation: report.recommendation, generated_at: report.generatedAt }, { onConflict: "candidate_id" });
    if (error) console.error("[ScreenIT] Report persistence failed", error);
    await supabase.from("screenit_candidates").update({ stage: "review", completed_at: report.generatedAt }).eq("id", report.candidateId);
    await supabase.from("screenit_interviews").upsert({ candidate_id: report.candidateId, consented_at: new Date().toISOString(), transcript: parsed.data.transcript, completed_at: report.generatedAt }, { onConflict: "candidate_id" });
  }
  return NextResponse.json({ report });
}
