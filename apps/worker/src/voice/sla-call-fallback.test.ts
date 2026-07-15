import { describe, expect, it } from "vitest";
import {
  buildDispatcherFollowupObjective,
  isDispatcherFollowupObjective,
  spokenDispatcherFollowupObjective,
} from "./sla-call-fallback.js";

describe("SLA call dispatch fallback", () => {
  it("builds a natural no-answer instruction for Bryanna", () => {
    const objective = buildDispatcherFollowupObjective({
      haloId: 41107,
      techName: "Matthew Lawyer",
      reason: "no_answer",
    });

    expect(isDispatcherFollowupObjective(objective)).toBe(true);
    expect(spokenDispatcherFollowupObjective(objective)).toContain("Matthew Lawyer");
    expect(spokenDispatcherFollowupObjective(objective)).toContain("ticket #41107");
    expect(spokenDispatcherFollowupObjective(objective)).toContain("did not answer");
    expect(spokenDispatcherFollowupObjective(objective)).not.toContain("[DISPATCH FOLLOW-UP]");
  });

  it("distinguishes voicemail from a dialing failure", () => {
    expect(spokenDispatcherFollowupObjective(buildDispatcherFollowupObjective({
      haloId: 41107,
      techName: "Jarid Carlson",
      reason: "voicemail",
    }))).toContain("voicemail");
    expect(spokenDispatcherFollowupObjective(buildDispatcherFollowupObjective({
      haloId: 41107,
      techName: null,
      reason: "dial_failed",
    }))).toContain("could not be connected");
  });
});
