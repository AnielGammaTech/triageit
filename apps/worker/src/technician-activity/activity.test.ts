import { describe, expect, it } from "vitest";
import type { HaloAction } from "@triageit/shared";
import { classifyTechnicianAction, summarizeTechnicianActivity } from "./activity.js";

function action(input: Partial<HaloAction>): HaloAction {
  return {
    id: 1,
    ticket_id: 42,
    note: "not stored",
    outcome: "Private Note",
    hiddenfromuser: true,
    who: "Darren Davillier",
    actiondatecreated: "2026-07-20T13:00:00Z",
    ...input,
  };
}

describe("technician activity", () => {
  it("counts real customer email and work time without retaining note content", () => {
    const row = classifyTechnicianAction(action({
      outcome: "Email User",
      hiddenfromuser: false,
      emaildirection: "O",
      timetaken: 0.5,
    }));
    expect(row).toMatchObject({
      technician_name: "Darren Davillier",
      category: "customer_email",
      work_minutes: 30,
      is_customer_visible: true,
    });
    expect(row).not.toHaveProperty("note");
  });

  it("excludes system and automated/non-technician actions", () => {
    expect(classifyTechnicianAction(action({ outcome: "Rule Applied" }))).toBeNull();
    expect(classifyTechnicianAction(action({ who: "TriageIT", outcome: "Private Note" }))).toBeNull();
    expect(classifyTechnicianAction(action({ who: "Bryanna Marquez", outcome: "Email User" }))).toBeNull();
  });

  it("keeps private notes separate when Halo also includes status metadata", () => {
    expect(classifyTechnicianAction(action({
      outcome: "Private Note",
      old_status: "In Progress",
      new_status: "In Progress",
    }))).toMatchObject({ category: "private_note" });
  });

  it("summarizes distinct tickets and exact action types per technician", () => {
    const rows = [
      classifyTechnicianAction(action({ id: 1, ticket_id: 10, outcome: "Email User", hiddenfromuser: false, emaildirection: "O", timetaken: 0.25 }))!,
      classifyTechnicianAction(action({ id: 2, ticket_id: 10, outcome: "Private Note", timetaken: 0.5 }))!,
      classifyTechnicianAction(action({ id: 3, ticket_id: 11, outcome: "Change Status", old_status: "New", new_status: "In Progress" }))!,
    ];
    const summary = summarizeTechnicianActivity(rows);
    const darren = summary.technicians.find((tech) => tech.technician === "Darren Davillier");
    expect(darren).toMatchObject({
      ticketsTouched: 2,
      actions: 3,
      customerEmails: 1,
      privateNotes: 1,
      statusChanges: 1,
      workMinutes: 45,
    });
  });
});
