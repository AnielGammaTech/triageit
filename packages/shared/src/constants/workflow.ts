import type { HaloWorkflowOwnerRole, HaloWorkflowStatus } from "../types/workflow.js";

export const WORKFLOW_STATUSES: ReadonlyArray<HaloWorkflowStatus> = [
  "NEW",
  "WOT",
  "IN_PROGRESS",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "NEEDS_QUOTE",
  "PAST_DUE",
  "RESOLVED",
];

export const WORKFLOW_OWNER_ROLES: ReadonlyArray<HaloWorkflowOwnerRole> = [
  "Triage",
  "Assigned Tech",
  "Parts Owner",
  "Triage Lead",
  "Help Desk Manager",
  "Director",
];

export const HELPDESK_TECHNICIANS = [
  "Raul Tapanes",
  "Jarid Carlson",
  "Matthew Lawyer",
  "Ryan Fitzpatrick",
  "Darren Davillier",
] as const;

/**
 * Real org roles (user-corrected 2026-07-09 after the AI invented a
 * "Cloud team"): there are NO specialty teams — techs handle everything.
 * Account managers own billing/licensing/account requests.
 */
export const ACCOUNT_MANAGERS = ["Todd Cassetty", "Roman Hernandez"] as const;
export const DISPATCHER = "Bryanna Marquez";
export const TEAM_FACTS = `Gamma Tech roles — use these EXACTLY, never invent teams or roles:
- Helpdesk techs (handle ALL technical work, no specialty teams exist): Raul Tapanes, Jarid Carlson, Matthew Lawyer, Ryan Fitzpatrick, Darren Davillier.
- Account managers (own billing, licensing, cancellations, renewals, account requests): Todd Cassetty, Roman Hernandez.
- Dispatcher: Bryanna Marquez. Management: Aniel (owner) and David Ayala.
There is no "Cloud team", "Network team", or any other specialty team.`;

export const NON_TECH_STAFF = [
  "Bryanna",
  "David",
  "Jonathan",
  "Roman Hernandez",
  "Todd",
  "Aniel",
] as const;

export const FORMER_STAFF_NAMES = [
  "Dylan",
  "Dylan Henjum",
] as const;

export const INTERNAL_STAFF_NAMES = [
  ...HELPDESK_TECHNICIANS,
  ...NON_TECH_STAFF,
  ...FORMER_STAFF_NAMES,
] as const;

function normalizeStaffName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isNameMatch(candidate: string, expected: string): boolean {
  const normalizedCandidate = normalizeStaffName(candidate);
  const normalizedExpected = normalizeStaffName(expected);
  if (!normalizedCandidate || !normalizedExpected) return false;
  if (normalizedCandidate === normalizedExpected) return true;
  if (normalizedCandidate.includes(normalizedExpected)) return true;

  const parts = normalizedExpected.split(" ").filter(Boolean);
  return parts.length > 1 && parts.every((part) => normalizedCandidate.includes(part));
}

export function isHelpdeskTechnicianName(name: string | null | undefined): boolean {
  if (!name) return false;
  return HELPDESK_TECHNICIANS.some((tech) => isNameMatch(name, tech));
}

export function isKnownNonTechStaffName(name: string | null | undefined): boolean {
  if (!name) return false;
  return NON_TECH_STAFF.some((staff) => isNameMatch(name, staff));
}

export function isInternalStaffName(name: string | null | undefined): boolean {
  if (!name) return false;
  return INTERNAL_STAFF_NAMES.some((staff) => isNameMatch(name, staff));
}

export function deriveWorkflowStatusFromHalo(
  haloStatus: string | null | undefined,
  hasAssignedTech: boolean,
): HaloWorkflowStatus {
  const status = (haloStatus ?? "").toLowerCase();

  if (status.includes("closed") || status.includes("resolved") || status.includes("cancelled") || status.includes("canceled") || status.includes("completed")) {
    return "RESOLVED";
  }

  if (status.includes("past-due") || status.includes("past due")) {
    return "PAST_DUE";
  }

  if (status.includes("quote")) {
    return "NEEDS_QUOTE";
  }

  if (status.includes("part")) {
    return "WAITING_ON_PARTS";
  }

  if (status.includes("waiting on customer") || status.includes("pending vendor") || status.includes("on hold")) {
    return "WAITING_ON_CUSTOMER";
  }

  if (status.includes("in progress") || status.includes("scheduled")) {
    return "IN_PROGRESS";
  }

  if (status.includes("customer reply")) {
    return hasAssignedTech ? "WOT" : "NEW";
  }

  if (status.includes("new")) {
    return "NEW";
  }

  return hasAssignedTech ? "WOT" : "NEW";
}

export function deriveWorkflowOwnerRole(
  workflowStatus: HaloWorkflowStatus,
  hasAssignedTech: boolean,
): HaloWorkflowOwnerRole | null {
  if (workflowStatus === "RESOLVED") return null;
  if (workflowStatus === "WAITING_ON_PARTS") return "Parts Owner";
  if (workflowStatus === "NEW") return "Triage";
  return hasAssignedTech ? "Assigned Tech" : "Triage";
}
