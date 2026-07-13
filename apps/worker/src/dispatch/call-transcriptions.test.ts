import { describe, expect, it } from "vitest";
import { callMatchLabel } from "./call-transcriptions.js";

describe("callMatchLabel", () => {
  it("explains direct and AI ticket matches", () => {
    expect(callMatchLabel("spoken_ticket_number")).toBe("Ticket number spoken on call");
    expect(callMatchLabel("llm_transcript_global")).toBe("Transcript matched across open tickets");
    expect(callMatchLabel("llm_ticket_callback_number")).toBe("Callback number and transcript matched");
  });

  it("identifies calls between staff without implying a failed ticket match", () => {
    expect(callMatchLabel("internal_call")).toBe("Internal staff call");
  });

  it("surfaces a failed Halo note without hiding the match method", () => {
    expect(callMatchLabel("llm_transcript_user_note_failed")).toBe("Transcript matched to customer ticket; Halo note failed");
  });

  it("gives readable unmatched reasons", () => {
    expect(callMatchLabel("ambiguous_multiple_open")).toBe("Several possible open tickets");
    expect(callMatchLabel("shared_phone_no_transcript_match")).toBe("Shared number with no clear ticket match");
  });
});
