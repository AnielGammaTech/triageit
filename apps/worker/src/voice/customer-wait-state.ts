import { isInternalStaffName, type HaloAction } from "@triageit/shared";
import { toSpeakableText } from "./ticket-briefing.js";

type ActionRecord = HaloAction & {
  readonly who_type?: number;
  readonly emaildirection?: string;
};

export interface CustomerWaitState {
  readonly waitingForUpdate: boolean;
  readonly requestedContactMethod: "call" | "reply";
  readonly reason: string | null;
  readonly latestCustomerMessage: string | null;
  readonly latestCustomerAt: string | null;
  readonly latestOutboundAt: string | null;
}

const TRIAGEIT_NOTE_RE = /triage\s*it|call summary|tech review|escalation call|phone message|ai triage/i;
const CALL_REQUEST_RE = /\b(call|callback|call back|phone|ring me)\b/i;
const UPDATE_REQUEST_RE = /\b(update|follow(?:ing)? up|hear back|let me know|status|reply|email)\b/i;

export function haloActionTimestamp(action: HaloAction): number {
  const raw = action.actiondatecreated ?? action.datetime ?? action.datecreated;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : 0;
}

function actionDateText(action: HaloAction | undefined): string | null {
  return action?.actiondatecreated ?? action?.datetime ?? action?.datecreated ?? null;
}

export function isInboundCustomerAction(action: ActionRecord): boolean {
  if (action.hiddenfromuser !== false) return false;
  const direction = action.emaildirection?.toUpperCase();
  if (direction === "O" || action.who_type === 1 || /triage\s*it/i.test(action.who ?? "")) return false;
  if (direction === "I" || action.who_type === 2) return true;
  return Boolean(action.who) && !isInternalStaffName(action.who) && action.who_type !== 0;
}

function isOutboundStaffAction(action: ActionRecord): boolean {
  if (action.hiddenfromuser !== false) return false;
  return action.who_type === 1 || action.emaildirection?.toUpperCase() === "O" || isInternalStaffName(action.who);
}

export function analyzeCustomerWaitState(
  actions: ReadonlyArray<ActionRecord>,
  statusName: string | null | undefined,
): CustomerWaitState {
  const meaningful = [...actions]
    .filter((action) => {
      const text = toSpeakableText(action.note ?? "");
      return text.length >= 3 && !TRIAGEIT_NOTE_RE.test(text);
    })
    .sort((a, b) => haloActionTimestamp(b) - haloActionTimestamp(a));

  const latestCustomer = meaningful.find(isInboundCustomerAction);
  const latestOutbound = meaningful.find(isOutboundStaffAction);
  const latestCustomerMs = latestCustomer ? haloActionTimestamp(latestCustomer) : 0;
  const latestOutboundMs = latestOutbound ? haloActionTimestamp(latestOutbound) : 0;
  const latestCustomerMessage = latestCustomer ? toSpeakableText(latestCustomer.note ?? "", 320) : null;
  const customerReplyStatus = /customer reply|updated by (?:user|customer)/i.test(statusName ?? "");
  const requestedContactMethod = latestCustomerMessage && CALL_REQUEST_RE.test(latestCustomerMessage) ? "call" : "reply";
  const explicitRequest = latestCustomerMessage ? CALL_REQUEST_RE.test(latestCustomerMessage) || UPDATE_REQUEST_RE.test(latestCustomerMessage) : false;
  const newerThanOutbound = Boolean(latestCustomer) && (latestOutboundMs === 0 || latestCustomerMs > latestOutboundMs);
  // Activity order is authoritative. Halo status can lag behind an outbound
  // reply, so a stale Customer Reply status must not create a false alert.
  const waitingForUpdate = Boolean(latestCustomer) && newerThanOutbound;

  let reason: string | null = null;
  if (waitingForUpdate) {
    const who = latestCustomer?.who?.trim() || "The customer";
    if (explicitRequest) {
      reason = requestedContactMethod === "call"
        ? `${who} asked for a call and no newer customer-facing reply is on the ticket.`
        : `${who} asked for an update and no newer customer-facing reply is on the ticket.`;
    } else if (customerReplyStatus) {
      reason = `${who} replied and the ticket is still in ${statusName ?? "Customer Reply"}.`;
    } else {
      reason = `${who} sent the latest customer-facing message and no newer reply from Gamma Tech is on the ticket.`;
    }
  }

  return {
    waitingForUpdate,
    requestedContactMethod,
    reason,
    latestCustomerMessage,
    latestCustomerAt: actionDateText(latestCustomer),
    latestOutboundAt: actionDateText(latestOutbound),
  };
}
