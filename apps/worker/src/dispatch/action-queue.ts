import type { TechStatus } from "./presence.js";
import { isCustomerWaitingForTech, isWaitingOnTechStatus } from "@triageit/shared";

export type DispatchActionKind =
  | "sla_breach"
  | "past_due"
  | "assign"
  | "cover"
  | "due_soon"
  | "customer_reply"
  | "waiting_on_tech"
  | "high_priority"
  | "stale";

export type DispatchActionLane = "now" | "today" | "watch";

export interface DispatchTicketSignals {
  readonly haloId: number;
  readonly status: string | null;
  readonly assignedTo: string | null;
  readonly priority: number | null;
  readonly createdAt: string;
  readonly lastCustomerReplyAt: string | null;
  readonly lastTechActionAt: string | null;
  readonly slaCurrentlyBreached: boolean;
  readonly slaFixBy: string | null;
  readonly slaRespondBy: string | null;
  readonly slaOnHold: boolean;
  readonly ownerState: TechStatus["state"] | null;
}

export interface DispatchActionDecision {
  readonly kind: DispatchActionKind;
  readonly lane: DispatchActionLane;
  readonly rank: number;
  readonly reason: string;
  readonly action: string;
  readonly since: string | null;
  readonly deadline: string | null;
}

const HOUR_MS = 3_600_000;
const STALE_AFTER_MS = 72 * HOUR_MS;
const DUE_SOON_MS = 24 * HOUR_MS;
const DUE_NOW_MS = 4 * HOUR_MS;

const normalize = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

function ownerLabel(assignedTo: string | null): string {
  const name = assignedTo?.trim();
  return name && normalize(name) !== "unassigned" ? name : "the assigned technician";
}

function validMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function nearestFutureDeadline(
  ticket: DispatchTicketSignals,
  nowMs: number,
): { readonly iso: string; readonly remainingMs: number } | null {
  if (ticket.slaOnHold) return null;
  const deadlines = [ticket.slaFixBy, ticket.slaRespondBy]
    .map((iso) => ({ iso, ms: validMs(iso) }))
    .filter((entry): entry is { readonly iso: string; readonly ms: number } =>
      entry.iso !== null && entry.ms !== null && entry.ms > nowMs,
    )
    .sort((a, b) => a.ms - b.ms);
  const nearest = deadlines[0];
  return nearest ? { iso: nearest.iso, remainingMs: nearest.ms - nowMs } : null;
}

function priorityBonus(priority: number | null): number {
  if (priority === 1) return 40;
  if (priority === 2) return 15;
  return 0;
}

function lastActivityMs(ticket: DispatchTicketSignals): number | null {
  return validMs(ticket.lastTechActionAt) ?? validMs(ticket.createdAt);
}

export function deriveDispatchAction(
  ticket: DispatchTicketSignals,
  nowMs: number = Date.now(),
): DispatchActionDecision | null {
  const status = normalize(ticket.status);
  const assigned = normalize(ticket.assignedTo);
  const unassigned = !assigned || assigned === "unassigned";
  const isCustomerReply = isCustomerWaitingForTech({
    statusId: null,
    statusName: ticket.status,
    lastCustomerReplyAt: ticket.lastCustomerReplyAt,
    lastTechActionAt: ticket.lastTechActionAt,
  });
  const isWaitingOnTech = isWaitingOnTechStatus(null, ticket.status);
  const isPastDue = status.includes("past-due") || status.includes("past due");
  const owner = ownerLabel(ticket.assignedTo);
  const bonus = priorityBonus(ticket.priority);

  if (ticket.slaCurrentlyBreached) {
    return {
      kind: "sla_breach",
      lane: "now",
      rank: 1_000 + bonus,
      reason: "SLA is breached",
      action: unassigned ? "Assign and escalate this now." : `Escalate with ${owner} now.`,
      since: ticket.lastTechActionAt ?? ticket.createdAt,
      deadline: null,
    };
  }

  if (isPastDue) {
    return {
      kind: "past_due",
      lane: "now",
      rank: 940 + bonus,
      reason: "Workflow is past due",
      action: unassigned ? "Assign an owner and recovery plan." : `Get a recovery plan from ${owner}.`,
      since: ticket.lastTechActionAt ?? ticket.createdAt,
      deadline: null,
    };
  }

  if (unassigned) {
    return {
      kind: "assign",
      lane: "now",
      rank: 900 + bonus,
      reason: "No helpdesk technician owns this",
      action: "Assign it to the recommended technician.",
      since: ticket.createdAt,
      deadline: null,
    };
  }

  const activelyNeedsOwner =
    isCustomerReply || isWaitingOnTech || status === "in progress" || status.includes("awaiting triage");
  if (ticket.ownerState === "off" && activelyNeedsOwner) {
    return {
      kind: "cover",
      lane: "now",
      rank: 860 + bonus,
      reason: `${owner} is off today`,
      action: "Move active work to available coverage.",
      since: isCustomerReply ? ticket.lastCustomerReplyAt : ticket.lastTechActionAt,
      deadline: null,
    };
  }

  const deadline = nearestFutureDeadline(ticket, nowMs);
  if (deadline && deadline.remainingMs <= DUE_SOON_MS) {
    const urgent = deadline.remainingMs <= DUE_NOW_MS;
    return {
      kind: "due_soon",
      lane: urgent ? "now" : "today",
      rank: (urgent ? 820 : 720) + bonus - Math.floor(deadline.remainingMs / HOUR_MS),
      reason: urgent ? "SLA deadline is within 4 hours" : "SLA deadline is within 24 hours",
      action: `Confirm ${owner} can clear the deadline.`,
      since: ticket.lastTechActionAt ?? ticket.createdAt,
      deadline: deadline.iso,
    };
  }

  if (isCustomerReply) {
    return {
      kind: "customer_reply",
      lane: "today",
      rank: 680 + bonus,
      reason: "Customer replied and is waiting",
      action: `Get ${owner} to respond or reassign it.`,
      since: ticket.lastCustomerReplyAt,
      deadline: null,
    };
  }

  if (isWaitingOnTech) {
    return {
      kind: "waiting_on_tech",
      lane: "today",
      rank: 640 + bonus,
      reason: "Waiting on technician action",
      action: `Confirm ${owner} is actively working it.`,
      since: ticket.lastTechActionAt ?? ticket.createdAt,
      deadline: null,
    };
  }

  if (ticket.priority === 1 && !status.includes("waiting on customer") && !status.includes("waiting on parts")) {
    return {
      kind: "high_priority",
      lane: "today",
      rank: 600,
      reason: "High-priority ticket needs an active plan",
      action: `Confirm ownership and next step with ${owner}.`,
      since: ticket.lastTechActionAt ?? ticket.createdAt,
      deadline: null,
    };
  }

  const lastActivity = lastActivityMs(ticket);
  const canGoStale = status === "in progress" || status.includes("awaiting triage");
  if (canGoStale && lastActivity !== null && nowMs - lastActivity > STALE_AFTER_MS) {
    return {
      kind: "stale",
      lane: "watch",
      rank: 400 + bonus + Math.min(100, Math.floor((nowMs - lastActivity) / (24 * HOUR_MS))),
      reason: "No technician activity for more than 3 days",
      action: `Review ownership and next step with ${owner}.`,
      since: new Date(lastActivity).toISOString(),
      deadline: null,
    };
  }

  return null;
}
