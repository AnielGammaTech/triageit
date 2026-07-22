import { z } from "zod";
import type { CandidateReport, RequirementEvidence } from "@/lib/screenit-types";

export type GeneratedReport = Pick<
  CandidateReport,
  | "summary"
  | "evidence"
  | "clarifications"
  | "roleAlignment"
  | "fitRationale"
  | "statedMotivation"
  | "conversationSignals"
  | "answerQuality"
  | "answerQualityRationale"
  | "answerConcerns"
>;

export const generatedReportSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(z.object({
    requirement: z.string().min(1),
    level: z.enum(["demonstrated", "partial", "unclear", "not_demonstrated"]),
    evidence: z.string().min(1),
  })),
  clarifications: z.array(z.string()),
  roleAlignment: z.enum(["strong_alignment", "partial_alignment", "limited_alignment", "insufficient_evidence"]),
  fitRationale: z.string().min(1),
  statedMotivation: z.string().min(1),
  conversationSignals: z.array(z.object({ signal: z.string().min(1), evidence: z.string().min(1) })).max(5),
  answerQuality: z.enum(["strong", "mixed", "weak", "insufficient"]),
  answerQualityRationale: z.string().min(1),
  answerConcerns: z.array(z.string()).max(5),
});

export const generatedReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "evidence", "clarifications", "roleAlignment", "fitRationale", "statedMotivation", "conversationSignals", "answerQuality", "answerQualityRationale", "answerConcerns"],
  properties: {
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["requirement", "level", "evidence"], properties: { requirement: { type: "string" }, level: { type: "string", enum: ["demonstrated", "partial", "unclear", "not_demonstrated"] }, evidence: { type: "string" } } } },
    clarifications: { type: "array", items: { type: "string" } },
    roleAlignment: { type: "string", enum: ["strong_alignment", "partial_alignment", "limited_alignment", "insufficient_evidence"] },
    fitRationale: { type: "string" },
    statedMotivation: { type: "string" },
    conversationSignals: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["signal", "evidence"], properties: { signal: { type: "string" }, evidence: { type: "string" } } } },
    answerQuality: { type: "string", enum: ["strong", "mixed", "weak", "insufficient"] },
    answerQualityRationale: { type: "string" },
    answerConcerns: { type: "array", maxItems: 5, items: { type: "string" } },
  },
} as const;

export function buildEvidenceReportPrompt(requirements: readonly string[], transcript: string): string {
  return `Create a candid recruiter evidence report from this interview. Do not soften, polish, or repair weak candidate answers. Use only the words and concrete job-related examples in the transcript. Do not count interviewer hints, leading questions, or repeated prompts as candidate evidence.

EVIDENCE LEVELS:
- demonstrated: the candidate gave a relevant, specific example showing their own actions and a result for the whole requirement.
- partial: related experience was stated, but a major component, action, detail, or outcome is missing.
- not_demonstrated: the candidate explicitly said they lack the required experience, gave only unrelated experience, contradicted the claimed evidence, or did not answer after clarification.
- unclear: the topic was not covered or transcription prevents a fair assessment.
- A product name, broad claim, slogan, or adjacent experience is never enough for demonstrated.
- For a combined requirement, demonstrated requires concrete evidence for every major component. Use partial when only one component is supported.
- Supporting several sites inside one organization is not the same as supporting multiple MSP customer environments. Credit only the environment actually described.
- If the candidate says they did not use a required RMM, PSA, ticketing, documentation, or Microsoft 365 workflow, record that plainly and do not convert it into transferable competence.

ANSWER QUALITY:
- Assess only the content of the candidate's answers: whether they addressed the question, explained their own actions, supplied understandable specifics, stayed internally consistent, and described an outcome.
- strong: consistently direct, specific, coherent answers with concrete examples.
- mixed: useful evidence exists, but several answers are vague or incomplete.
- weak: repeated non-answers, very vague or confusing explanations, contradictions, explicit refusals to answer, or inability to explain actions/results materially limit the evidence.
- insufficient: too little usable candidate speech to assess.
- In answerConcerns, list at most five concise observable concerns and quote or closely paraphrase the relevant answer. Do not diagnose the person.
- Do not penalize the candidate for the interviewer's repetition, poor questions, or transcription errors.
- Do not criticize missing employer names, employment dates, totals, or history unless the role requirements explicitly ask for them. If the interviewer asked for information that was not on the resume and was unrelated to a requirement, omit it from the summary, clarifications, rationale, and answerConcerns.

ROLE ALIGNMENT:
- strong_alignment requires concrete evidence for nearly all core requirements, no material explicit gaps, and strong or mixed answer quality.
- partial_alignment requires concrete evidence for a majority of core requirements and cannot be used when answerQuality is weak.
- limited_alignment means some relevant evidence exists, but major requirements are missing or answer quality prevents confident assessment.
- insufficient_evidence means there is too little usable information to compare with the role.

MOTIVATION AND SIGNALS:
- Capture motivation only when the candidate states a concrete reason for wanting IT work, this role, or continued learning. General phrases such as "I have always liked IT," "I am interested in tech," or naming news topics without a learning action are weak evidence; say exactly that rather than presenting strong motivation.
- Never infer motivation, enthusiasm, emotion, personality, honesty, engagement, or culture fit from voice, tone, accent, speed, pauses, grammar, or speaking style.
- conversationSignals may include at most five evidence-backed job behaviors such as ownership, customer awareness, documentation, appropriate help-seeking, or learning. Do not invent a positive signal to balance a concern.
- Never issue a hire or reject recommendation and never infer protected traits.

Return one evidence item for every requirement, in the same order and using the exact requirement text.

Requirements:
${requirements.map((item) => `- ${item}`).join("\n")}

Transcript:
${transcript}`;
}

export function calibrateGeneratedReport(report: GeneratedReport, requirements: readonly string[]): GeneratedReport {
  const byRequirement = new Map(report.evidence.map((item) => [item.requirement.trim().toLowerCase(), item]));
  const evidence: RequirementEvidence[] = requirements.map((requirement) => {
    const item = byRequirement.get(requirement.trim().toLowerCase()) ?? {
      requirement,
      level: "unclear" as const,
      evidence: "The interview did not provide reliable evidence for this requirement.",
    };
    const requirementText = requirement.toLowerCase();
    const evidenceText = item.evidence.toLowerCase();
    const requiresMultipleCustomers = /multiple (customer|client) environments/.test(requirementText);
    const onlyShowsInternalLocations = /(school|site|location|branch|department)/.test(evidenceText) && !/(msp|multiple customers|multiple clients|separate customers|separate clients)/.test(evidenceText);
    if (item.level === "demonstrated" && requiresMultipleCustomers && onlyShowsInternalLocations) {
      return { ...item, requirement, level: "partial" as const };
    }
    return { ...item, requirement };
  });

  const requirementsText = requirements.join(" ").toLowerCase();
  const employmentHistoryIsRequired = /(employment history|employer names?|employment dates?|work history)/.test(requirementsText);
  const unrelatedEmploymentHistory = /(employment history|employer names?|earlier employers?|prior employers?|employment dates?|employers? and dates)/i;
  const clarifications = employmentHistoryIsRequired ? report.clarifications : report.clarifications.filter((item) => !unrelatedEmploymentHistory.test(item));
  const answerConcerns = employmentHistoryIsRequired ? report.answerConcerns : report.answerConcerns.filter((item) => !unrelatedEmploymentHistory.test(item));

  const demonstrated = evidence.filter((item) => item.level === "demonstrated").length;
  const partial = evidence.filter((item) => item.level === "partial").length;
  const notDemonstrated = evidence.filter((item) => item.level === "not_demonstrated").length;
  const weightedCoverage = evidence.length ? (demonstrated + (partial * 0.5)) / evidence.length : 0;
  let roleAlignment = report.roleAlignment;

  // The model may never promote a weak interview through an optimistic summary.
  // These rules only downgrade; they do not manufacture stronger evidence.
  if (report.answerQuality === "insufficient") roleAlignment = "insufficient_evidence";
  else if (report.answerQuality === "weak" || notDemonstrated >= Math.ceil(evidence.length / 2) || weightedCoverage < 0.45) roleAlignment = "limited_alignment";
  else if (roleAlignment === "strong_alignment" && (report.answerQuality !== "strong" || notDemonstrated > 0 || weightedCoverage < 0.8)) roleAlignment = "partial_alignment";
  else if (roleAlignment === "partial_alignment" && weightedCoverage < 0.55) roleAlignment = "limited_alignment";

  return {
    ...report,
    evidence,
    clarifications,
    roleAlignment,
    answerConcerns: [...new Set(answerConcerns.map((item) => item.trim()).filter(Boolean))].slice(0, 5),
  };
}
