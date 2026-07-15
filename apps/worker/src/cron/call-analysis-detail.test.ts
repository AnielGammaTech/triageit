import { describe, expect, it } from "vitest";
import { buildCallAnalysisPrompt, buildCallSummaryNote, type CallInsights } from "./call-analysis.js";

const recording = {
  Id: 1,
  StartTime: "2026-07-15T13:51:30Z",
  EndTime: "2026-07-15T14:28:56Z",
};

describe("call analysis completeness", () => {
  it("includes transcript details beyond the old 24k cutoff", () => {
    const transcript = `${"early ".repeat(4_500)}TAIL_SUPPORT_DETAIL`;
    const prompt = buildCallAnalysisPrompt(recording, transcript, "Matthew Lawyer", "outbound", "Outlook group issue");

    expect(prompt).toContain("TAIL_SUPPORT_DETAIL");
    expect(prompt).toContain("Continue scanning after those sections");
    expect(prompt).toContain("customer objections or corrections");
    expect(prompt).toContain("Exclude unrelated background conversations");
    expect(prompt).toContain("Does that plan work for you?");
  });

  it("renders the customer report and findings while escaping transcript-derived HTML", () => {
    const insights: CallInsights = {
      relevant_to_ticket: true,
      summary: "Sandy disputed the initial <group recreated> conclusion.",
      customer_reported: ["Sandy & Jess had already retried the instructed capitalization."],
      key_findings: ["Confirmed: Outlook showed a stale cached group."],
      actions_taken: ["Checked server logs."],
      commitments: ["Tech: continue the forced refresh."],
      next_steps: ["Confirm the group clears for both users."],
      suggestions: [],
      customer_sentiment: "frustrated",
      suggested_customer_email: null,
    };

    const note = buildCallSummaryNote(recording, insights, "Matthew Lawyer", "outbound", "12392612663");

    expect(note).toContain("CUSTOMER REPORTED");
    expect(note).toContain("KEY FINDINGS");
    expect(note).toContain("Sandy &amp; Jess");
    expect(note).toContain("&lt;group recreated&gt;");
    expect(note).not.toContain("<group recreated>");
  });
});
