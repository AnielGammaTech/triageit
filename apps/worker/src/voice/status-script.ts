import type { createSupabaseClient } from "../db/supabase.js";
import type { HaloClient } from "../integrations/halo/client.js";

/**
 * Caller lookup + spoken status script for the AI phone line.
 *
 * Matching mirrors cron/call-analysis.ts: caller number → Halo users →
 * open Gamma Default tickets (tickettype_id=31, halo_is_open) for those
 * users' clients. The voicemail target is the caller's most recent open
 * ticket by user match, else the client's single open ticket.
 */

export interface CallerTicket {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly user_name: string | null;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_agent: string | null;
  readonly created_at?: string | null;
  readonly last_customer_reply_at?: string | null;
  readonly last_tech_action_at?: string | null;
}

/** Most recent activity of any kind on the ticket (for freshness ordering). */
export function lastActivityMs(t: CallerTicket): number {
  const times = [t.last_customer_reply_at, t.last_tech_action_at, t.created_at]
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((n) => Number.isFinite(n));
  return times.length > 0 ? Math.max(...times) : 0;
}

export interface CallerContext {
  readonly knownCaller: boolean;
  readonly clientName: string | null;
  /** Halo users this number maps to — first is used for ticket creation. */
  readonly users: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  /** Tickets to read aloud (max 3). */
  readonly spokenTickets: ReadonlyArray<CallerTicket>;
  /** Where a voicemail note should land, or null (unknown/ambiguous). */
  readonly voicemailTicket: CallerTicket | null;
}

const UNKNOWN_CALLER_CONTEXT: CallerContext = {
  knownCaller: false,
  clientName: null,
  users: [],
  spokenTickets: [],
  voicemailTicket: null,
};

const GAMMA_DEFAULT_TICKETTYPE_ID = 31;
const MAX_SPOKEN_TICKETS = 3;
const MAX_SUMMARY_CHARS = 70;

export async function buildCallerContext(
  supabase: ReturnType<typeof createSupabaseClient>,
  halo: HaloClient,
  callerNumber: string,
): Promise<CallerContext> {
  try {
    const users = await halo.searchUsersByPhone(callerNumber);
    if (users.length === 0) return UNKNOWN_CALLER_CONTEXT;

    const userNames = users.map((u) => u.name.toLowerCase());
    const clientNames = [...new Set(users.map((u) => u.client_name).filter((c): c is string => Boolean(c)))];

    const { data: openTickets, error } = await supabase
      .from("tickets")
      .select("id, halo_id, summary, user_name, client_name, halo_status, halo_agent, created_at, last_customer_reply_at, last_tech_action_at")
      .eq("tickettype_id", GAMMA_DEFAULT_TICKETTYPE_ID)
      .eq("halo_is_open", true)
      .in("client_name", clientNames.length > 0 ? clientNames : ["__none__"])
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      console.error("[VOICE] Open-ticket lookup failed:", error.message);
      // Known caller, but ticket state unknown — don't claim "no tickets"
      return { knownCaller: true, clientName: clientNames[0] ?? null, users: users.map((u) => ({ id: u.id, name: u.name })), spokenTickets: [], voicemailTicket: null };
    }

    // The caller's own tickets first, freshest ACTIVITY first — a caller
    // asking "any update?" means the ticket that moved last week, not the
    // long-lived project ticket that happened to be created most recently.
    const candidates = ((openTickets ?? []) as CallerTicket[])
      .slice()
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
    const byUser = candidates.filter((t) => t.user_name && userNames.includes(t.user_name.toLowerCase()));
    const voicemailTicket = byUser[0] ?? (candidates.length === 1 ? candidates[0] : null);
    const spokenTickets = (byUser.length > 0 ? byUser : candidates).slice(0, MAX_SPOKEN_TICKETS);

    return {
      knownCaller: true,
      clientName: clientNames[0] ?? null,
      users: users.map((u) => ({ id: u.id, name: u.name })),
      spokenTickets,
      voicemailTicket,
    };
  } catch (error) {
    console.error("[VOICE] Caller lookup failed:", error instanceof Error ? error.message : error);
    return UNKNOWN_CALLER_CONTEXT;
  }
}

/** Ticket summaries are free text from Halo — flatten to plain speech. */
function speakable(text: string): string {
  const cleaned = text.replace(/<[^>]+>/g, " ").replace(/[*_#`|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_SUMMARY_CHARS ? `${cleaned.slice(0, MAX_SUMMARY_CHARS).trimEnd()}` : cleaned;
}

export function composeStatusScript(ctx: CallerContext): string {
  const parts: string[] = [];

  if (!ctx.knownCaller) {
    // Unknown number ≠ unwelcome caller — greet like a receptionist, never
    // "we couldn't find you" (user request 2026-07-08)
    parts.push("Hello, and thank you for calling Gamma Tech. This is the automated assistant.");
    parts.push("How can we help you today?");
    parts.push("Press 1 to leave a message for our team, or press 2 to check a ticket by its number.");
    return parts.join(" ");
  }

  parts.push(
    ctx.clientName
      ? `Hello, and thank you for calling Gamma Tech. I see you're calling from ${ctx.clientName}.`
      : "Hello, and thank you for calling the Gamma Tech automated ticket line.",
  );

  if (ctx.spokenTickets.length === 0) {
    parts.push("I don't see any open tickets for your number right now.");
  } else {
    for (const ticket of ctx.spokenTickets) {
      parts.push(`Your ticket about ${speakable(ticket.summary)}, is currently ${ticket.halo_status ?? "open"}.`);
    }
  }

  parts.push("Press 1 to leave a message for your technician, or press 2 to check a ticket by its number.");
  return parts.join(" ");
}
