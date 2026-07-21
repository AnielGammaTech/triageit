import { NextResponse } from "next/server";
import { getWorkspaceSnapshot } from "@/lib/data";
import { analyzeResume } from "@/lib/resume-ai";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";

export async function GET(_request: Request, { params }: { readonly params: Promise<{ candidateId: string }> }) {
  if (!hasScreenItDatabase()) return NextResponse.json({ error: "Candidate storage is not configured" }, { status: 503 });
  const { candidateId } = await params;
  const result = await getScreenItServiceClient()
    .from("screenit_candidates")
    .select("resume_highlights,resume_clarifications,screening_questions")
    .eq("id", candidateId)
    .maybeSingle();

  if (result.error || !result.data) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  const questions = Array.isArray(result.data.screening_questions) ? result.data.screening_questions : [];
  return NextResponse.json({
    ready: questions.length > 0,
    analysis: {
      highlights: Array.isArray(result.data.resume_highlights) ? result.data.resume_highlights : [],
      clarifications: Array.isArray(result.data.resume_clarifications) ? result.data.resume_clarifications : [],
      questions,
    },
  });
}

export async function POST(_request: Request, { params }: { readonly params: Promise<{ candidateId: string }> }) {
  if (!hasScreenItDatabase()) return NextResponse.json({ error: "Candidate storage is not configured" }, { status: 503 });
  const { candidateId } = await params;
  const supabase = getScreenItServiceClient();
  const candidateResult = await supabase.from("screenit_candidates").select("position_id,resume_file_name,resume_storage_path").eq("id", candidateId).maybeSingle();
  if (candidateResult.error || !candidateResult.data) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  const candidate = candidateResult.data;
  if (!candidate.resume_storage_path) return NextResponse.json({ error: "This candidate does not have a stored résumé" }, { status: 409 });

  const workspace = await getWorkspaceSnapshot();
  const position = workspace.positions.find((item) => item.id === candidate.position_id);
  if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const download = await supabase.storage.from("screenit-resumes").download(candidate.resume_storage_path);
  if (download.error || !download.data) return NextResponse.json({ error: "Résumé could not be loaded" }, { status: 500 });
  const resume = new File([await download.data.arrayBuffer()], candidate.resume_file_name, { type: download.data.type || "application/octet-stream" });
  const analysis = await analyzeResume(resume, position);
  const update = await supabase.from("screenit_candidates").update({ resume_highlights: analysis.highlights, resume_clarifications: analysis.clarifications, screening_questions: analysis.questions }).eq("id", candidateId);
  if (update.error) {
    console.error("[ScreenIT] Screening plan update failed", update.error);
    return NextResponse.json({ error: "Screening plan could not be saved" }, { status: 500 });
  }
  return NextResponse.json({ analysis });
}
