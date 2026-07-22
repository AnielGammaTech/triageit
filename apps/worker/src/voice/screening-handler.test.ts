import { describe, expect, it } from "vitest";
import { countSpokenQuestions } from "./screening-handler.js";

describe("countSpokenQuestions", () => {
  it("counts every question in a stacked interviewer turn", () => {
    expect(countSpokenQuestions("Which tools did you use? And how did you track requests?")).toBe(2);
  });

  it("does not consume the question budget for statements or acknowledgements", () => {
    expect(countSpokenQuestions("Thank you. The recruiting team will review this conversation.")).toBe(0);
  });

  it("recognizes full-width question marks in transcripts", () => {
    expect(countSpokenQuestions("What did you handle？")).toBe(1);
  });
});
