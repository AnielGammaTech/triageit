import { describe, expect, it } from "vitest";
import { ignoredCallMethod } from "./call-ignore-policy.js";

function input(overrides: Partial<Parameters<typeof ignoredCallMethod>[0]> = {}) {
  return {
    transcript: null,
    startedAt: "2026-07-15T15:00:00.000Z",
    endedAt: "2026-07-15T15:00:05.000Z",
    matchedBy: "transcript_too_short",
    analysisAttempts: 0,
    ...overrides,
  };
}

describe("ignoredCallMethod", () => {
  it("ignores silence and non-actionable hangups", () => {
    expect(ignoredCallMethod(input())).toBe("ignored_silence");
    expect(ignoredCallMethod(input({ transcript: "Hi, this is Paul with Quality Enterprise." })))
      .toBe("ignored_short_call");
  });

  it("ignores clear IVR and voicemail-system prompts", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:01:00.000Z",
      transcript: "Thank you for calling. Please press 1 for support or dial the extension now.",
    }))).toBe("ignored_ivr");
    expect(ignoredCallMethod(input({
      transcript: "Hi, this is Paul with Quality Enterprises, I can't get your call right now.",
    }))).toBe("ignored_ivr");
  });

  it("does not treat ordinary hold language as an IVR by itself", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:01:00.000Z",
      transcript: "Please hold while I check why the server is showing an error.",
    }))).toBeNull();
  });

  it("keeps short calls with a ticket number or issue language reviewable", () => {
    expect(ignoredCallMethod(input({ transcript: "Calling about ticket 0041139." }))).toBeNull();
    expect(ignoredCallMethod(input({ transcript: "My printer is down. Call me back." }))).toBeNull();
  });

  it("moves exhausted unusable transcripts out of unmatched review", () => {
    expect(ignoredCallMethod(input({
      startedAt: "2026-07-15T15:00:00.000Z",
      endedAt: "2026-07-15T15:05:00.000Z",
      transcript: "Hello, this is a test call.",
      analysisAttempts: 20,
    }))).toBe("ignored_unusable_recording");
  });

  it("preserves an existing ignored classification", () => {
    expect(ignoredCallMethod(input({ matchedBy: "ignored_ivr" }))).toBe("ignored_ivr");
  });
});
