export type PositionStatus = "draft" | "active" | "paused" | "closed";
export type CandidateStage = "new" | "invited" | "interviewing" | "review" | "advanced" | "closed";
export type EvidenceLevel = "demonstrated" | "partial" | "unclear" | "not_demonstrated";
export type AnswerQuality = "strong" | "mixed" | "weak" | "insufficient" | "not_assessed";

export interface InterviewQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly reason: string;
  readonly required: boolean;
}

export interface Position {
  readonly id: string;
  readonly title: string;
  readonly department: string;
  readonly location: string;
  readonly status: PositionStatus;
  readonly candidateCount: number;
  readonly reviewCount: number;
  readonly requirements: readonly string[];
  readonly questions: readonly InterviewQuestion[];
  readonly createdAt: string;
}

export interface Candidate {
  readonly id: string;
  readonly positionId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly stage: CandidateStage;
  readonly resumeFileName: string;
  readonly resumeHighlights: readonly string[];
  readonly resumeClarifications: readonly string[];
  readonly screeningQuestions: readonly InterviewQuestion[];
  readonly interviewMode: "browser" | "phone" | null;
  readonly scheduledAt: string | null;
  readonly completedAt: string | null;
  readonly inviteToken: string;
  readonly inviteExpiresAt: string | null;
  readonly createdAt: string;
}

export interface RequirementEvidence {
  readonly requirement: string;
  readonly level: EvidenceLevel;
  readonly evidence: string;
}

export interface ConversationSignal {
  readonly signal: string;
  readonly evidence: string;
}

export interface CandidateReport {
  readonly id: string;
  readonly candidateId: string;
  readonly summary: string;
  readonly evidence: readonly RequirementEvidence[];
  readonly clarifications: readonly string[];
  readonly recommendation: "recruiter_review" | "follow_up" | "incomplete";
  readonly roleAlignment: "strong_alignment" | "partial_alignment" | "limited_alignment" | "insufficient_evidence";
  readonly fitRationale: string;
  readonly statedMotivation: string;
  readonly conversationSignals: readonly ConversationSignal[];
  readonly answerQuality: AnswerQuality;
  readonly answerQualityRationale: string;
  readonly answerConcerns: readonly string[];
  readonly generatedAt: string;
}

export interface WorkspaceSnapshot {
  readonly source: "database" | "demo";
  readonly positions: readonly Position[];
  readonly candidates: readonly Candidate[];
  readonly reports: readonly CandidateReport[];
}
