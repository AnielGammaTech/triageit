import { describe, expect, it } from "vitest";
import { analyzeCustomerWaitState } from "./customer-wait-state.js";

function action(input: Record<string, unknown>) {
  return {
    id: Number(input.id ?? 1),
    ticket_id: 41000,
    note: String(input.note ?? ""),
    outcome: "note",
    hiddenfromuser: false,
    ...input,
  } as never;
}

describe("analyzeCustomerWaitState", () => {
  it("marks a newer customer callback request as waiting", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "We are checking this.", datetime: "2026-07-13T09:00:00-04:00" }),
      action({ id: 2, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Please call me with an update.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Customer Reply");

    expect(state.waitingForUpdate).toBe(true);
    expect(state.reason).toContain("asked for a call or update");
  });

  it("does not mark the customer waiting after a newer public tech reply", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Can you update me?", datetime: "2026-07-13T09:00:00-04:00" }),
      action({ id: 2, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "Here is the latest update.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Waiting on Tech");

    expect(state.waitingForUpdate).toBe(false);
  });

  it("does not trust a stale Customer Reply status over a newer outbound reply", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Please call me.", datetime: "2026-07-13T09:00:00-04:00" }),
      action({ id: 2, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "I just called and left a voicemail.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Customer Reply");

    expect(state.waitingForUpdate).toBe(false);
  });

  it("ignores internal and TriageIT notes as customer communication", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "TriageIT", who_type: 0, note: "TriageIT escalation call summary", datetime: "2026-07-13T10:00:00-04:00" }),
      action({ id: 2, who: "Jarid Carlson", who_type: 1, note: "Checking logs", datetime: "2026-07-13T11:00:00-04:00", hiddenfromuser: true }),
    ], "PAST-DUE");

    expect(state.waitingForUpdate).toBe(false);
    expect(state.latestCustomerMessage).toBeNull();
  });
});
