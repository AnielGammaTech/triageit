import { isInternalStaffName, type HaloAction } from "@triageit/shared";
import { toSpeakableText } from "./ticket-briefing.js";

type ActionRecord = HaloAction & {
  readonly who_type?: number;
  readonly emaildirection?: string;
};

export interface CustomerWaitState {
  readonly waitingForUpdate: boolean;
  readonly reason: string | null;
  readonly latestCustomerMessage: string | null;
  readonly latestCustomerAt: string | null;
  readonly latestOutboundAt: string | null;
}

const TRIAGEIT_NOTE_RE = /triage\s*it|call summary|tech review|escalation call|phone message|ai triage/i;
const CALLBACK_RE = /\b(call|callback|call back|phone|update|follow(?:ing)? up|hear back|let me know|status)\b/i;

function actionDate(action: HaloAction): number {
  const raw = action.actiondatecreated ?? action.datetime ?? action.datecreated;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : 0;
}

function actionDateText(action: HaloAction | undefined): string | null {
  return action?.actiondatecreated ?? action?.datetime ?? action?.datecreated ?? null;
}

function isCustomerAction(action: ActionRecord): boolean {
  if (action.hiddenfromuser !== false) return false;
  if (action.who_type === 2 || action.emaildirection?.toUpperCase() === "I") return true;
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
    .sort((a, b) => actionDate(b) - actionDate(a));

  const latestCustomer = meaningful.find(isCustomerAction);
  const latestOutbound = meaningful.find(isOutboundStaffAction);
  const latestCustomerMs = latestCustomer ? actionDate(latestCustomer) : 0;
  const latestOutboundMs = latestOutbound ? actionDate(latestOutbound) : 0;
  const latestCustomerMessage = latestCustomer ? toSpeakableText(latestCustomer.note ?? "", 320) : null;
  const customerReplyStatus = /customer reply|updated by (?:user|customer)/i.test(statusName ?? "");
  const explicitRequest = latestCustomerMessage ? CALLBACK_RE.test(latestCustomerMessage) : false;
  const newerThanOutbound = Boolean(latestCustomer) && (latestOutboundMs === 0 || latestCustomerMs > latestOutboundMs);
  // Activity order is authoritative. Halo status can lag behind an outbound
  // reply, so a stale Customer Reply status must not create a false alert.
  const waitingForUpdate = Boolean(latestCustomer) && newerThanOutbound;

  let reason: string | null = null;
  if (waitingForUpdate) {
    const who = latestCustomer?.who?.trim() || "The customer";
    if (explicitRequest) {
      reason = `${who} asked for a call or update and no newer customer-facing reply is on the ticket.`;
    } else if (customerReplyStatus) {
      reason = `${who} replied and the ticket is still in ${statusName ?? "Customer Reply"}.`;
    } else {
      reason = `${who} sent the latest customer-facing message and no newer reply from Gamma Tech is on the ticket.`;
    }
  }

  return {
    waitingForUpdate,
    reason,
    latestCustomerMessage,
    latestCustomerAt: actionDateText(latestCustomer),
    latestOutboundAt: actionDateText(latestOutbound),
  };
}
