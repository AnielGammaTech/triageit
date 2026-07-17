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
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:11:00.000Z",
      transcript: "This is Inky Technology. Press any key to continue.",
    }))).toBe("ignored_ivr");
  });

  it("does not treat ordinary hold language as an IVR by itself", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:01:00.000Z",
      transcript: "Please hold while I check why the server is showing an error.",
    }))).toBeNull();
  });

  it("keeps a real conversation after a long automated introduction", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:06:00.000Z",
      matchedBy: "ignored_ivr",
      transcript: "Thank you for calling. For English press 1. Please remain on the line. This is Mia. How can I help? Hi, my name is Matthew with Gamma Tech Services. I am looking for Emily. What exactly is going on with the card reader? The mobile reader is not working. Let me check the account and open a ticket.",
    }))).toBeNull();
  });

  it("keeps a technician message left after a voicemail greeting", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:01:00.000Z",
      matchedBy: "ignored_ivr",
      transcript: "Your call has been forwarded to voicemail. At the tone, please record your message. Hey Harry, it's Ryan from Gamma Tech. I unblocked the sign-in for your account. Call me back if you have any questions.",
    }))).toBeNull();
  });

  it("keeps a voicemail that turns into a live troubleshooting call", () => {
    expect(ignoredCallMethod(input({
      endedAt: "2026-07-15T15:08:00.000Z",
      matchedBy: "ignored_ivr",
      transcript: "Your call has been forwarded to voicemail. At the tone, record your message. Hey, this is the tech checking the scanner. Oh, you just picked up while I was leaving a voicemail. Can you test scan to email? I am gonna check the printer settings and send a test. The printer reports a send error. Let me restart it and try again.",
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

  it("preserves an existing ignored classification only while the full transcript remains automated", () => {
    expect(ignoredCallMethod(input({
      matchedBy: "ignored_ivr",
      transcript: "Thank you for calling. Please press 1 for support or dial the extension now.",
    }))).toBe("ignored_ivr");
  });
});
