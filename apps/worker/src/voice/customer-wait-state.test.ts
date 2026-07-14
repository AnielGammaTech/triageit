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
    expect(state.requestedContactMethod).toBe("call");
    expect(state.reason).toContain("asked for a call");
  });

  it("uses a written reply when the customer requested an update but not a call", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Please email me a status update.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Customer Reply");

    expect(state.waitingForUpdate).toBe(true);
    expect(state.requestedContactMethod).toBe("reply");
    expect(state.reason).toContain("asked for an update");
  });

  it("does not mark the customer waiting after a newer public tech reply", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Can you update me?", datetime: "2026-07-13T09:00:00-04:00" }),
      action({ id: 2, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "Here is the latest update.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Waiting on Tech", new Date("2026-07-13T11:00:00-04:00").getTime());

    expect(state.waitingForUpdate).toBe(false);
  });

  it("does not trust a stale Customer Reply status over a newer outbound reply", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "Please call me.", datetime: "2026-07-13T09:00:00-04:00" }),
      action({ id: 2, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "I just called and left a voicemail.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "Customer Reply", new Date("2026-07-13T11:00:00-04:00").getTime());

    expect(state.waitingForUpdate).toBe(false);
  });

  it("requires a fresh update when the last public response is over four hours old", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Rosalinda Gonzalez", who_type: 2, emaildirection: "I", note: "Would we have a new phone available for Jose?", datetime: "2026-07-08T10:10:00-04:00" }),
      action({ id: 2, who: "Bryanna Marquez", who_type: 1, emaildirection: "O", note: "A new phone will need to be ordered. We will provide another update.", datetime: "2026-07-08T15:56:00-04:00" }),
      action({ id: 3, who: "Bryanna Marquez", who_type: 1, hiddenfromuser: true, note: "I will reach out to Rosalinda again tomorrow.", datetime: "2026-07-09T17:11:00-04:00" }),
    ], "PAST-DUE", new Date("2026-07-14T09:30:00-04:00").getTime());

    expect(state.waitingForUpdate).toBe(true);
    expect(state.requestedContactMethod).toBe("reply");
    expect(state.reason).toContain("more than four hours old");
  });

  it("does not demand an update when the ticket is explicitly waiting on the customer", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "Carlos Customer", who_type: 2, emaildirection: "I", note: "I will check and get back to you.", datetime: "2026-07-08T10:00:00-04:00" }),
      action({ id: 2, who: "Ryan Fitzpatrick", who_type: 1, emaildirection: "O", note: "Please send us the serial number when you have it.", datetime: "2026-07-08T11:00:00-04:00" }),
    ], "Waiting on Customer", new Date("2026-07-14T09:30:00-04:00").getTime());

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

  it("does not treat a public TriageIT action as an inbound customer reply", () => {
    const state = analyzeCustomerWaitState([
      action({ id: 1, who: "TriageIT", who_type: 1, note: "Customer reported a payroll outage.", datetime: "2026-07-13T10:00:00-04:00" }),
    ], "PAST-DUE");

    expect(state.waitingForUpdate).toBe(false);
    expect(state.latestCustomerMessage).toBeNull();
  });
});
