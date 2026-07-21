import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceSnapshot } from "@/lib/data";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";
import type { Candidate } from "@/lib/screenit-types";

const allowedExtensions = new Set(["pdf", "doc", "docx"]);

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const positionId = String(form.get("positionId") ?? "").trim();
  const resume = form.get("resume");
  if (!name || !email.includes("@") || !positionId || !(resume instanceof File)) return NextResponse.json({ error: "Name, email, position, and resume are required" }, { status: 400 });
  const extension = resume.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension) || resume.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Use a PDF or DOCX resume smaller than 10 MB" }, { status: 400 });
  const workspace = await getWorkspaceSnapshot();
  if (!workspace.positions.some((position) => position.id === positionId)) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "");
  const createdAt = new Date().toISOString();
  const inviteExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const candidate: Candidate = { id, positionId, name, email, phone: null, stage: "new", resumeFileName: resume.name, resumeHighlights: [], interviewMode: null, scheduledAt: null, completedAt: null, inviteToken: token, inviteExpiresAt, createdAt };
  if (hasScreenItDatabase()) {
    const supabase = getScreenItServiceClient();
    const filePath = `${id}/${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage.from("screenit-resumes").upload(filePath, await resume.arrayBuffer(), { contentType: resume.type || "application/octet-stream", upsert: false });
    if (upload.error) return NextResponse.json({ error: "Resume could not be stored" }, { status: 500 });
    const insert = await supabase.from("screenit_candidates").insert({ id, position_id: positionId, full_name: name, email, stage: "new", resume_file_name: resume.name, resume_storage_path: filePath, resume_highlights: [], public_invite_token: token, public_invite_expires_at: inviteExpiresAt, created_at: createdAt });
    if (insert.error) return NextResponse.json({ error: "Candidate could not be created" }, { status: 500 });
  }
  return NextResponse.json({ candidate }, { status: 201 });
}
