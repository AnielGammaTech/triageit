import { describe, expect, it } from "vitest";
import type { HaloAction } from "@triageit/shared";
import { validateInitialAcknowledgmentDraft } from "../dispatch/customer-update-approvals.js";
import { buildInitialAcknowledgmentDraft, sortedOutboundEmails } from "./ticket-response-compliance.js";

function action(input: Partial<HaloAction>): HaloAction {
  return {
    id: input.id ?? 1,
    ticket_id: 41222,
    note: input.note ?? "",
    outcome: input.outcome ?? "note",
    hiddenfromuser: input.hiddenfromuser ?? false,
    ...input,
  };
}

describe("initial customer acknowledgment", () => {
  it("includes the assigned technician's exact next update and asks whether it works", () => {
    const due = "2026-07-14T19:30:00.000Z";
    const draft = buildInitialAcknowledgmentDraft({
      customerName: "Rosalinda Smith",
      summary: "New phones were ordered",
      assignedTech: "David Ayala",
      technicianDueAt: due,
    });
    expect(draft).toContain("Hi Rosalinda,");
    expect(draft).toContain("David is assigned");
    expect(draft).toContain("July 14");
    expect(draft).toContain("3:30 PM Eastern");
    expect(draft).toContain("Please let us know if that time works for you");
    expect(validateInitialAcknowledgmentDraft(draft, due)).toBeNull();
  });

  it("does not invent a response deadline before a technician is assigned", () => {
    const draft = buildInitialAcknowledgmentDraft({
      customerName: null,
      summary: "Laptop issue",
      assignedTech: null,
      technicianDueAt: null,
    });
    expect(draft).toContain("assigning the right technician now");
    expect(validateInitialAcknowledgmentDraft(draft, null)).toBeNull();
  });

  it("uses the immediate Halo confirmation but excludes the original inbound email", () => {
    const ticketCreatedAt = Date.parse("2026-07-15T15:16:46.298Z");
    const outbound = sortedOutboundEmails([
      action({
        id: 1,
        who: "Dark Web Monitoring",
        who_type: 2,
        emaildirection: "I",
        outcome: "First User Email",
        actiondatecreated: "2026-07-15T15:16:41.800",
      }),
      action({
        id: 2,
        who: "System",
        who_type: 0,
        emaildirection: "O",
        outcome: "Emailed Confirmation",
        actiondatecreated: "2026-07-15T15:16:42.163",
      }),
    ], ticketCreatedAt);

    expect(outbound.map((item) => item.id)).toEqual([2]);
  });

  it("counts only customer-visible email and excludes calls, voicemail, internal, and AI notes", () => {
    const outbound = sortedOutboundEmails([
      action({
        id: 1,
        who: "Darren Davillier",
        who_type: 1,
        outcome: "Outbound phone call completed",
        actiondatecreated: "2026-07-20T15:05:00.000Z",
      }),
      action({
        id: 2,
        who: "Darren Davillier",
        who_type: 1,
        outcome: "Voicemail left",
        actiondatecreated: "2026-07-20T15:10:00.000Z",
      }),
      action({
        id: 3,
        who: "TriageIT",
        who_type: 1,
        emaildirection: "O",
        outcome: "Email sent",
        hiddenfromuser: true,
        actiondatecreated: "2026-07-20T15:15:00.000Z",
      }),
      action({
        id: 4,
        who: "Darren Davillier",
        who_type: 1,
        emaildirection: "O",
        outcome: "Email sent",
        hiddenfromuser: false,
        actiondatecreated: "2026-07-20T15:20:00.000Z",
      }),
    ], Date.parse("2026-07-20T15:00:00.000Z"));

    expect(outbound.map((item) => item.id)).toEqual([4]);
  });
});
