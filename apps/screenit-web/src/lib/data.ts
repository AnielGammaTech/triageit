import "server-only";

import { demoWorkspace } from "@/lib/demo-data";
import { getScreenItServiceClient, hasScreenItDatabase } from "@/lib/supabase";
import type {
  Candidate,
  CandidateReport,
  Position,
  WorkspaceSnapshot,
} from "@/lib/screenit-types";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  if (!hasScreenItDatabase()) return demoWorkspace;

  try {
    const supabase = getScreenItServiceClient();
    const [positionsResult, candidatesResult, reportsResult] = await Promise.all([
      supabase.from("screenit_positions").select("*").order("created_at", { ascending: false }),
      supabase.from("screenit_candidates").select("*").order("created_at", { ascending: false }),
      supabase.from("screenit_reports").select("*").order("generated_at", { ascending: false }),
    ]);

    if (positionsResult.error || candidatesResult.error || reportsResult.error) {
      throw positionsResult.error ?? candidatesResult.error ?? reportsResult.error;
    }

    const candidates: Candidate[] = (candidatesResult.data ?? []).map((row) => ({
      id: String(row.id),
      positionId: String(row.position_id),
      name: String(row.full_name),
      email: String(row.email),
      phone: row.phone ? String(row.phone) : null,
      stage: row.stage as Candidate["stage"],
      resumeFileName: String(row.resume_file_name ?? "Resume"),
      resumeHighlights: asStringArray(row.resume_highlights),
      interviewMode: (row.interview_mode as Candidate["interviewMode"]) ?? null,
      scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      inviteToken: String(row.public_invite_token ?? ""),
      inviteExpiresAt: row.public_invite_expires_at ? String(row.public_invite_expires_at) : null,
      createdAt: String(row.created_at),
    }));

    const reports: CandidateReport[] = (reportsResult.data ?? []).map((row) => ({
      id: String(row.id),
      candidateId: String(row.candidate_id),
      summary: String(row.summary),
      evidence: Array.isArray(row.requirement_evidence) ? row.requirement_evidence : [],
      clarifications: asStringArray(row.clarifications),
      recommendation: row.recommendation as CandidateReport["recommendation"],
      generatedAt: String(row.generated_at),
    }));

    const positions: Position[] = (positionsResult.data ?? []).map((row) => {
      const positionCandidates = candidates.filter((candidate) => candidate.positionId === row.id);
      return {
        id: String(row.id),
        title: String(row.title),
        department: String(row.department ?? "General"),
        location: String(row.location ?? "Not specified"),
        status: row.status as Position["status"],
        candidateCount: positionCandidates.length,
        reviewCount: positionCandidates.filter((candidate) => candidate.stage === "review").length,
        requirements: asStringArray(row.requirements),
        questions: Array.isArray(row.questions) ? row.questions : [],
        createdAt: String(row.created_at),
      };
    });

    return { source: "database", positions, candidates, reports };
  } catch (error) {
    console.error("[ScreenIT] Database read failed; using the demo workspace", error);
    return demoWorkspace;
  }
}

export async function getCandidate(candidateId: string) {
  const workspace = await getWorkspaceSnapshot();
  const candidate = workspace.candidates.find((item) => item.id === candidateId) ?? null;
  if (!candidate) return null;
  const position = workspace.positions.find((item) => item.id === candidate.positionId) ?? null;
  const report = workspace.reports.find((item) => item.candidateId === candidate.id) ?? null;
  return { workspace, candidate, position, report };
}

export async function getInterviewByToken(token: string) {
  const workspace = await getWorkspaceSnapshot();
  const candidate = workspace.candidates.find((item) => item.inviteToken === token) ?? null;
  if (!candidate) return null;
  if (candidate.inviteExpiresAt && new Date(candidate.inviteExpiresAt).getTime() < Date.now()) return null;
  const position = workspace.positions.find((item) => item.id === candidate.positionId) ?? null;
  return position ? { candidate, position } : null;
}
