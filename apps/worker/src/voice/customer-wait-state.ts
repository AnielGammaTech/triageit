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
const CALL_REQUEST_RE = /\b(?:call\s+(?:me|us|him|her|them|back)|call\s+back|callback|give\s+(?:me|us|him|her|them)\s+a\s+call|phone\s+(?:me|us|him|her|them)|ring\s+(?:me|us|him|her|them)|(?:please|can you|could you|would you)\s+call)\b/i;
const UPDATE_REQUEST_RE = /\b(update|follow(?:ing)? up|hear back|let me know|status|reply|email)\b/i;
const CUSTOMER_UPDATE_CADENCE_MS = 4 * 60 * 60 * 1000;

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

/** Customer-visible outbound email. Internal notes and non-email actions do not satisfy response SLAs. */
export function isOutboundCustomerEmail(action: ActionRecord): boolean {
  if (action.hiddenfromuser !== false) return false;
  return action.emaildirection?.toUpperCase() === "O" || /\bemail\b/i.test(action.outcome ?? "");
}

export function analyzeCustomerWaitState(
  actions: ReadonlyArray<ActionRecord>,
  statusName: string | null | undefined,
  nowMs = Date.now(),
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
  const waitingOnCustomer = /waiting on customer/i.test(statusName ?? "");
  const outboundUpdateOverdue = Boolean(latestCustomer)
    && latestOutboundMs > 0
    && nowMs - latestOutboundMs >= CUSTOMER_UPDATE_CADENCE_MS
    && !waitingOnCustomer;
  // A newer reply clears the immediate customer-response signal, but not
  // forever. On an open SLA call, an update older than Gamma's four-hour
  // communication cadence still requires the tech to consider a fresh update.
  const waitingForUpdate = Boolean(latestCustomer) && (newerThanOutbound || outboundUpdateOverdue);

  let reason: string | null = null;
  if (waitingForUpdate) {
    const who = latestCustomer?.who?.trim() || "The customer";
    if (explicitRequest) {
      reason = requestedContactMethod === "call"
        ? `${who} asked for a call and no newer customer-facing reply is on the ticket.`
        : `${who} asked for an update and no newer customer-facing reply is on the ticket.`;
    } else if (customerReplyStatus) {
      reason = `${who} replied and the ticket is still in ${statusName ?? "Customer Reply"}.`;
    } else if (outboundUpdateOverdue) {
      reason = `Gamma Tech's last customer-facing update is more than four hours old and no newer update has been sent.`;
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
