import { after, NextRequest, NextResponse } from "next/server";
import { getCandidate, getWorkspaceSnapshot } from "@/lib/data";
import { analyzeResume } from "@/lib/resume-ai";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";
import type { Candidate } from "@/lib/screenit-types";

const allowedExtensions = new Set(["pdf", "doc", "docx"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function existingCandidateResponse(intakeRequestId: string) {
  const supabase = getScreenItServiceClient();
  const existing = await supabase.from("screenit_candidates").select("id").eq("intake_request_id", intakeRequestId).maybeSingle();
  if (existing.error || !existing.data?.id) return null;
  const result = await getCandidate(String(existing.data.id));
  return result?.candidate ?? null;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const phone = String(form.get("phone") ?? "").trim() || null;
  const positionId = String(form.get("positionId") ?? "").trim();
  const intakeRequestId = String(form.get("intakeRequestId") ?? "").trim();
  const resume = form.get("resume");
  if (!name || !email.includes("@") || !positionId || !uuidPattern.test(intakeRequestId) || !(resume instanceof File)) return NextResponse.json({ error: "Name, email, position, and resume are required" }, { status: 400 });
  const extension = resume.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension) || resume.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Use a PDF or DOCX resume smaller than 10 MB" }, { status: 400 });
  const workspace = await getWorkspaceSnapshot();
  const position = workspace.positions.find((item) => item.id === positionId);
  if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (!hasScreenItDatabase()) return NextResponse.json({ error: "Candidate storage is not configured. Open Settings for details." }, { status: 503 });

  const existingCandidate = await existingCandidateResponse(intakeRequestId);
  if (existingCandidate) return NextResponse.json({ candidate: existingCandidate, deduplicated: true });

  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "");
  const createdAt = new Date().toISOString();
  const inviteExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const candidate: Candidate = { id, positionId, name, email, phone, stage: "new", resumeFileName: resume.name, resumeHighlights: [], resumeClarifications: [], screeningQuestions: [], interviewMode: "browser", scheduledAt: null, completedAt: null, inviteToken: token, inviteExpiresAt, createdAt };
  const supabase = getScreenItServiceClient();
  const insert = await supabase.from("screenit_candidates").insert({ id, position_id: positionId, full_name: name, email, phone, stage: "new", resume_file_name: resume.name, resume_highlights: [], interview_mode: "browser", public_invite_token: token, public_invite_expires_at: inviteExpiresAt, intake_request_id: intakeRequestId, created_at: createdAt });
  if (insert.error) {
    if (insert.error.code === "23505") {
      const duplicate = await existingCandidateResponse(intakeRequestId);
      if (duplicate) return NextResponse.json({ candidate: duplicate, deduplicated: true });
    }
    console.error("[ScreenIT] Candidate insert failed", insert.error);
    return NextResponse.json({ error: "Candidate could not be created" }, { status: 500 });
  }

  const resumeBytes = await resume.arrayBuffer();
  const filePath = `${id}/${crypto.randomUUID()}.${extension}`;
  const upload = await supabase.storage.from("screenit-resumes").upload(filePath, resumeBytes, { contentType: resume.type || "application/octet-stream", upsert: false });
  if (upload.error) {
    await supabase.from("screenit_candidates").delete().eq("id", id);
    console.error("[ScreenIT] Resume upload failed", upload.error);
    return NextResponse.json({ error: "Resume could not be stored" }, { status: 500 });
  }
  const stored = await supabase.from("screenit_candidates").update({ resume_storage_path: filePath }).eq("id", id);
  if (stored.error) {
    await Promise.all([
      supabase.storage.from("screenit-resumes").remove([filePath]),
      supabase.from("screenit_candidates").delete().eq("id", id),
    ]);
    console.error("[ScreenIT] Resume path update failed", stored.error);
    return NextResponse.json({ error: "Candidate could not be created" }, { status: 500 });
  }

  const analysisFile = new File([resumeBytes], resume.name, { type: resume.type || "application/octet-stream" });
  after(async () => {
    const analysis = await analyzeResume(analysisFile, position);
    const result = await getScreenItServiceClient().from("screenit_candidates").update({ resume_highlights: analysis.highlights, resume_clarifications: analysis.clarifications, screening_questions: analysis.questions }).eq("id", id);
    if (result.error) console.error("[ScreenIT] Resume analysis could not be saved", result.error);
  });

  return NextResponse.json({ candidate, analysisPending: true }, { status: 201 });
}
