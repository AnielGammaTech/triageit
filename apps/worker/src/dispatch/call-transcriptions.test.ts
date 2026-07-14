import { describe, expect, it } from "vitest";
import { callMatchLabel, shouldIncludeCallTranscription, type CallTranscriptionItem } from "./call-transcriptions.js";

function callItem(
  techName: string,
  agentName: string | null,
  matchMethod = "llm_transcript_global",
): Pick<CallTranscriptionItem, "techName" | "from" | "to" | "ticket" | "matchMethod"> {
  return {
    techName,
    matchMethod,
    from: { name: techName, number: "123" },
    to: { name: "Customer", number: "2395550100" },
    ticket: agentName
      ? {
          haloId: 41123,
          summary: "Test ticket",
          clientName: "Test client",
          status: "Open",
          agentName,
          customerName: "Customer",
        }
      : null,
  };
}

describe("callMatchLabel", () => {
  it("explains direct and AI ticket matches", () => {
    expect(callMatchLabel("spoken_ticket_number")).toBe("Ticket number spoken on call");
    expect(callMatchLabel("llm_transcript_global")).toBe("Transcript matched across open tickets");
    expect(callMatchLabel("llm_ticket_callback_number")).toBe("Callback number and transcript matched");
    expect(callMatchLabel("manual_dispatch")).toBe("Matched by dispatch");
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
    expect(callMatchLabel("identified_customer_no_ticket_match")).toBe("Customer identified; no related ticket found");
  });
});

describe("shouldIncludeCallTranscription", () => {
  it("keeps support-team calls", () => {
    expect(shouldIncludeCallTranscription(callItem("Lawyer, Matthew", null))).toBe(true);
  });

  it("keeps Roman and Todd only when the matched ticket is assigned to them", () => {
    expect(shouldIncludeCallTranscription(callItem("Hernandez, Roman", "Roman Hernandez"))).toBe(true);
    expect(shouldIncludeCallTranscription(callItem("Cassetty, Todd", "Todd Cassetty"))).toBe(true);
    expect(shouldIncludeCallTranscription(callItem("Hernandez, Roman", "Matthew Lawyer"))).toBe(false);
    expect(shouldIncludeCallTranscription(callItem("Cassetty, Todd", null))).toBe(false);
  });

  it("excludes non-IT employees even if an old analysis row has a match", () => {
    expect(shouldIncludeCallTranscription(callItem("Arzan, Amber", "Matthew Lawyer"))).toBe(false);
    expect(shouldIncludeCallTranscription(callItem("Arzan, Amber", "Matthew Lawyer", "ignored_non_support_staff"))).toBe(false);
  });
});
