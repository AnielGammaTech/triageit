import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloAction, HaloConfig, HaloTicket } from "@triageit/shared";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { HaloClient } from "../integrations/halo/client.js";
import { haloActionTimestamp, isInboundCustomerAction } from "../voice/customer-wait-state.js";

export interface CustomerUpdateApproval {
  readonly id: string;
  readonly ticket_id: string | null;
  readonly halo_id: number;
  readonly ticket_summary: string;
  readonly client_name: string | null;
  readonly customer_name: string | null;
  readonly customer_email: string | null;
  readonly tech_name: string | null;
  readonly customer_waiting_reason: string;
  readonly raw_message: string;
  readonly draft_message: string;
  readonly contact_method: "call" | "reply" | null;
  readonly next_action_at: string | null;
  readonly customer_reply_message: string | null;
  readonly customer_replied_at: string | null;
  readonly status: "pending" | "sending" | "sent" | "dismissed" | "failed" | "customer_declined";
  readonly error_message: string | null;
  readonly source: "sla_call" | "initial_acknowledgment";
  readonly approval_reason: string | null;
  readonly tech_approved_at: string;
  readonly created_at: string;
}

export interface ApprovalActor {
  readonly userId: string;
  readonly email: string | null;
}

interface StageCustomerUpdateInput {
  readonly ticketId: string | null;
  readonly haloId: number;
  readonly ticketSummary: string;
  readonly clientName: string | null;
  readonly customerName: string | null;
  readonly customerEmail: string | null;
  readonly techName: string | null;
  readonly customerWaitingReason: string;
  readonly rawMessage: string;
  readonly draftMessage: string;
  readonly contactMethod: "call" | "reply";
  readonly nextActionAt: string;
  readonly technicianConfirmed: boolean;
}

export interface StageInitialAcknowledgmentInput {
  readonly ticketId: string;
  readonly haloId: number;
  readonly ticketSummary: string;
  readonly clientName: string | null;
  readonly customerName: string | null;
  readonly customerEmail: string | null;
  readonly techName: string | null;
  readonly draftMessage: string;
  readonly nextActionAt: string | null;
  readonly dispatcherOutcome: "missed" | "pto_exempt" | "pto_unknown";
}

type CustomerScheduleReply = "accepted" | "needs_follow_up" | "neutral";
let lastReplyRefreshAt = 0;

function cleanMessage(value: string, max: number): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function sameMessage(left: string, right: string): boolean {
  return cleanMessage(left, 4_000).replace(/\s+/g, " ") === cleanMessage(right, 4_000).replace(/\s+/g, " ");
}

function nextActionParts(iso: string): { datePattern: RegExp; timePattern: RegExp; label: string } {
  const target = new Date(iso);
  if (!Number.isFinite(target.getTime())) throw new Error("The next-action time is invalid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(target);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const period = get("dayPeriod").toLowerCase().replace(".", "");
  const monthToken = `(?:${month.toLowerCase()}|${month.slice(0, 3).toLowerCase()}\\.?)`;
  const datePattern = new RegExp(`\\b${monthToken}\\s+${day}(?:st|nd|rd|th)?(?:,?\\s+${year})?\\b`, "i");
  const timePattern = minute === "00"
    ? new RegExp(`\\b${hour}(?::00)?\\s*${period[0]}\\.?m\\.?\\b`, "i")
    : new RegExp(`\\b${hour}:${minute}\\s*${period[0]}\\.?m\\.?\\b`, "i");
  return { datePattern, timePattern, label: `${month} ${day}, ${year} at ${hour}:${minute} ${get("dayPeriod")} Eastern` };
}

export function validateCustomerCommitmentDraft(
  draft: string,
  nextActionAt: string,
  contactMethod: "call" | "reply",
): string | null {
  const text = cleanMessage(draft, 4_000);
  const { datePattern, timePattern, label } = nextActionParts(nextActionAt);
  if (!datePattern.test(text) || !timePattern.test(text) || !/\b(eastern|et)\b/i.test(text)) {
    return `The customer draft must state the exact next-action date and time: ${label}`;
  }
  if (contactMethod === "call" && !/\b(call|phone)\b/i.test(text)) {
    return "The customer asked for a call, so the draft must explicitly say Gamma Tech will call them";
  }
  if (contactMethod === "reply" && !/\b(written update|reply|email|update)\b/i.test(text)) {
    return "The customer asked for a reply, so the draft must explicitly promise a written update or reply";
  }
  if (!/(?:does|will) (?:that|this)(?: time)? work|is (?:that|this)(?: time)? (?:okay|ok)|please let us know if (?:that|this)(?: time)? works/i.test(text)) {
    return "The customer draft must ask whether that next-action time works for them";
  }
  return null;
}

export function validateInitialAcknowledgmentDraft(
  draft: string,
  nextActionAt: string | null,
): string | null {
  const text = cleanMessage(draft, 4_000);
  if (!/\b(thank|thanks)\b/i.test(text) || !/\b(received|acknowledge|reviewing)\b/i.test(text)) {
    return "The initial message must thank the customer and confirm that Gamma Tech received the request";
  }
  if (!/\b(reply|contact|update|follow up|follow-up)\b/i.test(text)) {
    return "The initial message must explain how the customer will receive the next update";
  }
  if (nextActionAt) return validateCustomerCommitmentDraft(text, nextActionAt, "reply");
  return null;
}

export function classifyCustomerScheduleReply(message: string): CustomerScheduleReply {
  const text = cleanMessage(message, 4_000).toLowerCase();
  const negative = /\b(no|not|can't|cannot|won't|doesn't|does not|too late|too early|sooner|earlier|later|different time|instead|asap|immediately)\b/i.test(text)
    || /\b(?:after|before)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b/i.test(text)
    || /\b(?:can|could|would)\s+you\b.{0,60}\b(?:at|after|before)\s+\d{1,2}/i.test(text);
  if (negative) return "needs_follow_up";
  if (/\b(yes|that works|works for me|sounds good|perfect|that is fine|that's fine|that is okay|that's okay)\b/i.test(text)) return "accepted";
  return "neutral";
}

function requesterEmail(ticket: HaloTicket): string | null {
  const nested = ticket.user as { emailaddress?: unknown } | undefined;
  const candidates = [ticket.user_email, ticket.user_emailaddress, nested?.emailaddress, ticket.emailtolist];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const email = candidate.match(/[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+/)?.[0];
      if (email) return email;
    }
  }
  return null;
}

function requesterBlocksEmail(ticket: HaloTicket): boolean {
  const nested = ticket.user as { neversendemails?: unknown } | undefined;
  const value = nested?.neversendemails;
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function stageCustomerUpdate(
  supabase: SupabaseClient,
  input: StageCustomerUpdateInput,
): Promise<{ id: string; replacedExisting: boolean }> {
  if (!input.technicianConfirmed) throw new Error("The technician must approve the exact draft before it can be queued");
  const rawMessage = cleanMessage(input.rawMessage, 4_000);
  const draftMessage = cleanMessage(input.draftMessage, 4_000);
  if (rawMessage.length < 3) throw new Error("The technician's requested update is empty");
  if (draftMessage.length < 20) throw new Error("The approved customer update is too short");
  if (!input.customerWaitingReason.trim()) throw new Error("No customer-waiting reason was recorded");
  const draftError = validateCustomerCommitmentDraft(draftMessage, input.nextActionAt, input.contactMethod);
  if (draftError) throw new Error(draftError);

  const { data: existing } = await supabase
    .from("dispatch_customer_updates")
    .select("id")
    .eq("halo_id", input.haloId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    ticket_id: input.ticketId,
    halo_id: input.haloId,
    ticket_summary: input.ticketSummary.slice(0, 300),
    client_name: input.clientName,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    tech_name: input.techName,
    customer_waiting_reason: input.customerWaitingReason.slice(0, 700),
    raw_message: rawMessage,
    draft_message: draftMessage,
    contact_method: input.contactMethod,
    next_action_at: input.nextActionAt,
    status: "pending",
    source: "sla_call",
    tech_approved_at: new Date().toISOString(),
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  const query = existing
    ? supabase.from("dispatch_customer_updates").update(payload).eq("id", existing.id)
    : supabase.from("dispatch_customer_updates").insert(payload);
  const { data, error } = await query.select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not queue the customer update");
  return { id: String(data.id), replacedExisting: Boolean(existing) };
}

export async function stageInitialAcknowledgment(
  supabase: SupabaseClient,
  input: StageInitialAcknowledgmentInput,
): Promise<{ id: string; replacedExisting: boolean }> {
  const draftMessage = cleanMessage(input.draftMessage, 4_000);
  const draftError = validateInitialAcknowledgmentDraft(draftMessage, input.nextActionAt);
  if (draftError) throw new Error(draftError);

  const { data: existing } = await supabase
    .from("dispatch_customer_updates")
    .select("id")
    .eq("halo_id", input.haloId)
    .eq("source", "initial_acknowledgment")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const pto = input.dispatcherOutcome === "pto_exempt";
  const unknown = input.dispatcherOutcome === "pto_unknown";
  const reason = pto
    ? "Bryanna is marked PTO. The 30-business-minute dispatcher metric is exempt, but the customer still needs coverage."
    : unknown
      ? "No customer acknowledgment was posted within 30 business minutes. Bryanna's PTO status could not be verified, so the miss is pending review."
      : "No customer acknowledgment was posted within 30 business minutes. This is recorded as a missed dispatcher acknowledgment.";
  const now = new Date().toISOString();
  const payload = {
    ticket_id: input.ticketId,
    halo_id: input.haloId,
    ticket_summary: input.ticketSummary.slice(0, 300),
    client_name: input.clientName,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    tech_name: input.techName,
    customer_waiting_reason: reason,
    approval_reason: reason,
    raw_message: "TriageIT generated an initial acknowledgment after the 30-business-minute response clock expired.",
    draft_message: draftMessage,
    contact_method: input.nextActionAt ? "reply" : null,
    next_action_at: input.nextActionAt,
    status: "pending",
    source: "initial_acknowledgment",
    tech_approved_at: now,
    error_message: null,
    updated_at: now,
  };

  const query = existing
    ? supabase.from("dispatch_customer_updates").update(payload).eq("id", existing.id)
    : supabase.from("dispatch_customer_updates").insert(payload);
  const { data, error } = await query.select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not queue the initial customer acknowledgment");
  return { id: String(data.id), replacedExisting: Boolean(existing) };
}

export async function listCustomerUpdateApprovals(supabase: SupabaseClient): Promise<ReadonlyArray<CustomerUpdateApproval>> {
  const { data, error } = await supabase
    .from("dispatch_customer_updates")
    .select("id, ticket_id, halo_id, ticket_summary, client_name, customer_name, customer_email, tech_name, customer_waiting_reason, raw_message, draft_message, contact_method, next_action_at, customer_reply_message, customer_replied_at, status, error_message, source, approval_reason, tech_approved_at, created_at")
    .in("status", ["pending", "failed", "customer_declined"])
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReadonlyArray<CustomerUpdateApproval>;
}

export async function approveCustomerUpdate(
  supabase: SupabaseClient,
  id: string,
  draft: string,
  actor: ApprovalActor,
): Promise<{ haloActionId: number; recipient: string }> {
  if (!isWithinBusinessHours()) {
    throw new Error("Customer updates cannot be sent outside business hours (Monday-Friday, 8:00 AM-5:15 PM Eastern)");
  }
  const draftMessage = cleanMessage(draft, 4_000);
  if (draftMessage.length < 20) throw new Error("The customer update is too short to send");

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("dispatch_customer_updates")
    .update({
      status: "sending",
      draft_message: draftMessage,
      approved_by_user_id: actor.userId,
      approved_by_email: actor.email,
      approved_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("id, halo_id, ticket_summary, tech_approved_at, contact_method, next_action_at, source")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error("This update was already handled by someone else");
  const initialAcknowledgment = claimed.source === "initial_acknowledgment";
  if (!initialAcknowledgment && (!claimed.contact_method || !claimed.next_action_at)) {
    const message = "This draft predates the required next-action commitment and must be restaged from a technician call";
    await supabase.from("dispatch_customer_updates").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
    throw new Error(message);
  }
  const draftError = initialAcknowledgment
    ? validateInitialAcknowledgmentDraft(draftMessage, claimed.next_action_at ? String(claimed.next_action_at) : null)
    : validateCustomerCommitmentDraft(draftMessage, String(claimed.next_action_at), claimed.contact_method as "call" | "reply");
  if (draftError) {
    await supabase.from("dispatch_customer_updates").update({ status: "failed", error_message: draftError, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
    throw new Error(draftError);
  }

  try {
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .maybeSingle();
    if (integrationError || !integration) throw new Error(integrationError?.message ?? "Halo is not configured");
    const halo = new HaloClient(integration.config as HaloConfig);
    const ticket = await halo.getTicket(Number(claimed.halo_id));
    if (requesterBlocksEmail(ticket)) {
      throw new Error("The current Halo requester is marked as never receiving emails");
    }
    const recipient = requesterEmail(ticket);
    if (!recipient) throw new Error("The current Halo requester does not have a valid email address");
    const displayId = String(claimed.halo_id).padStart(7, "0");
    const subject = `Update on ticket #${displayId}: ${String(ticket.summary ?? claimed.ticket_summary).slice(0, 160)}`;
    // If Halo accepted a previous attempt but the HTTP response was lost,
    // reconcile the action instead of sending a duplicate customer email.
    const priorActions = await halo.getTicketActions(Number(claimed.halo_id), true);
    const approvedAfter = new Date(String(claimed.tech_approved_at)).getTime();
    const alreadySent = priorActions.find((action) => {
      const created = new Date(action.actiondatecreated ?? action.datetime ?? action.datecreated ?? 0).getTime();
      return action.hiddenfromuser === false
        && action.emaildirection?.toUpperCase() === "O"
        && created >= approvedAfter
        && sameMessage(action.note ?? "", draftMessage);
    });
    if (alreadySent) {
      const reconciledAt = new Date().toISOString();
      const { error: reconcileError } = await supabase
        .from("dispatch_customer_updates")
        .update({ status: "sent", customer_email: recipient, halo_action_id: alreadySent.id, sent_at: reconciledAt, updated_at: reconciledAt })
        .eq("id", id)
        .eq("status", "sending");
      if (reconcileError) throw new Error(`Existing Halo email found, but the approval audit could not be completed: ${reconcileError.message}`);
      if (initialAcknowledgment) {
        await recordApprovedInitialAcknowledgment(supabase, Number(claimed.halo_id), alreadySent.id, reconciledAt, actor);
      }
      return { haloActionId: alreadySent.id, recipient };
    }
    const haloActionId = await halo.sendCustomerEmail({
      ticketId: Number(claimed.halo_id),
      recipient,
      subject,
      message: draftMessage,
    });
    const sentAt = new Date().toISOString();
    const { error: finishError } = await supabase
      .from("dispatch_customer_updates")
      .update({ status: "sent", customer_email: recipient, halo_action_id: haloActionId || null, sent_at: sentAt, updated_at: sentAt })
      .eq("id", id)
      .eq("status", "sending");
    if (finishError) throw new Error(`Email sent, but the approval audit could not be completed: ${finishError.message}`);
    if (initialAcknowledgment) {
      await recordApprovedInitialAcknowledgment(supabase, Number(claimed.halo_id), haloActionId, sentAt, actor);
    }
    return { haloActionId, recipient };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("dispatch_customer_updates")
      .update({ status: "failed", error_message: message.slice(0, 1_000), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "sending");
    throw error;
  }
}

async function recordApprovedInitialAcknowledgment(
  supabase: SupabaseClient,
  haloId: number,
  actionId: number,
  sentAt: string,
  actor: ApprovalActor,
): Promise<void> {
  const { data: compliance } = await supabase
    .from("ticket_response_compliance")
    .select("acknowledgment_due_at")
    .eq("halo_id", haloId)
    .maybeSingle();
  const dueAt = compliance?.acknowledgment_due_at ? Date.parse(String(compliance.acknowledgment_due_at)) : NaN;
  const { error } = await supabase
    .from("ticket_response_compliance")
    .update({
      acknowledgment_at: sentAt,
      acknowledgment_by: actor.email ?? "Dispatch approver",
      acknowledgment_action_id: actionId || null,
      acknowledgment_met: Number.isFinite(dueAt) ? Date.parse(sentAt) <= dueAt : false,
      updated_at: new Date().toISOString(),
    })
    .eq("halo_id", haloId)
    .is("acknowledgment_at", null);
  if (error) console.warn(`[RESPONSE-COMPLIANCE] Email sent but compliance audit update failed for #${haloId}: ${error.message}`);
}

export async function dismissCustomerUpdate(supabase: SupabaseClient, id: string, actor: ApprovalActor): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dispatch_customer_updates")
    .update({
      status: "dismissed",
      approved_by_user_id: actor.userId,
      approved_by_email: actor.email,
      dismissed_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["pending", "failed", "customer_declined"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This update was already handled by someone else");
}

export async function refreshCustomerUpdateReplies(supabase: SupabaseClient): Promise<void> {
  const now = Date.now();
  if (now - lastReplyRefreshAt < 60_000) return;
  lastReplyRefreshAt = now;

  const cutoff = new Date(now - 14 * 24 * 60 * 60_000).toISOString();
  const { data: sent, error } = await supabase
    .from("dispatch_customer_updates")
    .select("id, halo_id, sent_at")
    .eq("status", "sent")
    .is("customer_replied_at", null)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  if (!sent?.length) return;

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .maybeSingle();
  if (integrationError || !integration) throw new Error(integrationError?.message ?? "Halo is not configured");
  const halo = new HaloClient(integration.config as HaloConfig);

  for (const item of sent) {
    const sentAt = new Date(String(item.sent_at)).getTime();
    const actions = await halo.getTicketActions(Number(item.halo_id), false);
    const reply = [...actions]
      .filter((action) => isInboundCustomerAction(action) && haloActionTimestamp(action) > sentAt)
      .sort((left, right) => haloActionTimestamp(left) - haloActionTimestamp(right))
      .find((action) => classifyCustomerScheduleReply(action.note ?? "") === "needs_follow_up") as HaloAction | undefined;
    if (!reply) continue;
    const message = cleanMessage(reply.note ?? "", 4_000);
    if (!message) continue;
    const repliedAt = new Date(haloActionTimestamp(reply)).toISOString();
    const update: Record<string, unknown> = {
      customer_reply_message: message,
      customer_replied_at: repliedAt,
      customer_reply_action_id: reply.id,
      updated_at: new Date().toISOString(),
      status: "customer_declined",
    };
    const { error: updateError } = await supabase.from("dispatch_customer_updates").update(update).eq("id", item.id).eq("status", "sent");
    if (updateError) throw new Error(updateError.message);
  }
}
