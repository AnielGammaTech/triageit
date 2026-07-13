import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig, HaloTicket } from "@triageit/shared";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { HaloClient } from "../integrations/halo/client.js";

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
  readonly status: "pending" | "sending" | "sent" | "dismissed" | "failed";
  readonly error_message: string | null;
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
  readonly technicianConfirmed: boolean;
}

function cleanMessage(value: string, max: number): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function sameMessage(left: string, right: string): boolean {
  return cleanMessage(left, 4_000).replace(/\s+/g, " ") === cleanMessage(right, 4_000).replace(/\s+/g, " ");
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

export async function listCustomerUpdateApprovals(supabase: SupabaseClient): Promise<ReadonlyArray<CustomerUpdateApproval>> {
  const { data, error } = await supabase
    .from("dispatch_customer_updates")
    .select("id, ticket_id, halo_id, ticket_summary, client_name, customer_name, customer_email, tech_name, customer_waiting_reason, raw_message, draft_message, status, error_message, tech_approved_at, created_at")
    .in("status", ["pending", "failed"])
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
    .select("id, halo_id, ticket_summary, tech_approved_at")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error("This update was already handled by someone else");

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
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This update was already handled by someone else");
}
