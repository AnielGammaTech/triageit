import { describe, expect, it } from "vitest";
import { buildScreeningInstructions, type ScreeningCallContext } from "./screening-handler.js";

const screening: ScreeningCallContext = {
  requestId: "request-1",
  candidateId: "candidate-1",
  inviteToken: "invite-1",
  candidateName: "Jordan Example",
  positionTitle: "Service Desk Technician",
  resumeFacts: ["Worked at Example School supporting Windows endpoints."],
  resumeClarifications: ["Clarify how support requests were tracked."],
  questions: [{ prompt: "Tell me about a difficult support issue you personally resolved.", reason: "Tests troubleshooting ownership" }],
};

describe("buildScreeningInstructions", () => {
  it("uses resume evidence without imposing a fixed question cap", () => {
    const prompt = buildScreeningInstructions(screening);

    expect(prompt).toContain("Worked at Example School supporting Windows endpoints.");
    expect(prompt).toContain("There is no fixed question count");
    expect(prompt).not.toContain("HARD BUDGET");
    expect(prompt).not.toContain("SIX-QUESTION");
  });

  it("requires targeted clarification without repeat loops", () => {
    const prompt = buildScreeningInstructions(screening);

    expect(prompt).toContain("at most one final targeted clarification");
    expect(prompt).toContain("Never enter a loop");
    expect(prompt).toContain("check whether the candidate already answered it");
  });

  it("challenges unsupported claims without accusing the candidate", () => {
    const prompt = buildScreeningInstructions(screening);

    expect(prompt).toContain("what they personally did and what result they observed");
    expect(prompt).toContain("Do not accuse the candidate of lying");
    expect(prompt).toContain("explicitly confirms they do not have that experience");
  });
});
