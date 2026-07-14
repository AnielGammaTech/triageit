import { describe, expect, it } from "vitest";
import { validateInitialAcknowledgmentDraft } from "../dispatch/customer-update-approvals.js";
import { buildInitialAcknowledgmentDraft } from "./ticket-response-compliance.js";

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
});

