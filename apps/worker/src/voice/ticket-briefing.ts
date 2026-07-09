import type { HaloClient } from "../integrations/halo/client.js";
import { lastActivityMs, type CallerContext, type CallerTicket } from "./status-script.js";

/**
 * Conversation briefing for the realtime voice assistant: everything the
 * model may speak about, fetched up front so status questions ("any
 * update on my ticket?") are answered from REAL ticket activity — the
 * latest customer-facing note or email — never invented.
 */

export interface TicketBriefing {
  readonly ticket: CallerTicket;
  /** Latest customer-visible action (public note or email), if any. */
  readonly lastCustomerUpdate: {
    readonly who: string;
    readonly when: string;
    readonly text: string;
  } | null;
}

const MAX_BRIEFED_TICKETS = 3;
const MAX_UPDATE_CHARS = 600;

function actionDate(a: { actiondatecreated?: string; datetime?: string; datecreated?: string }): number {
  const raw = a.actiondatecreated ?? a.datetime ?? a.datecreated;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Halo notes are HTML — flatten to something speakable. */
export function toSpeakableText(html: string, maxChars = MAX_UPDATE_CHARS): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).replace(/\s+\S*$/, "")}…` : text;
}

/** Fetch the most recent customer-facing action (public note or email) for one ticket. */
export async function fetchLastCustomerUpdate(
  halo: HaloClient,
  haloId: number,
): Promise<TicketBriefing["lastCustomerUpdate"]> {
  try {
    const actions = await halo.getTicketActions(haloId);
    const visible = actions
      .filter((a) => a.hiddenfromuser === false && toSpeakableText(a.note ?? "").length > 0)
      .sort((a, b) => actionDate(b) - actionDate(a));
    const latest = visible[0];
    if (!latest) return null;
    const raw = latest.actiondatecreated ?? latest.datetime ?? latest.datecreated;
    const when = raw
      ? new Date(raw).toLocaleString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "recently";
    return {
      who: latest.who ?? "our team",
      when,
      text: toSpeakableText(latest.note ?? ""),
    };
  } catch (error) {
    console.warn(`[VOICE] Could not fetch actions for #${haloId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function buildTicketBriefings(
  halo: HaloClient,
  ctx: CallerContext,
): Promise<ReadonlyArray<TicketBriefing>> {
  const tickets = ctx.spokenTickets.slice(0, MAX_BRIEFED_TICKETS);
  return Promise.all(
    tickets.map(async (ticket) => ({
      ticket,
      lastCustomerUpdate: await fetchLastCustomerUpdate(halo, ticket.halo_id),
    })),
  );
}

/** Render the briefing block that goes into the realtime session instructions. */
function ageInDays(ms: number): number {
  return ms > 0 ? Math.floor((Date.now() - ms) / 86_400_000) : -1;
}

function agePhrase(days: number): string {
  if (days < 0) return "unknown age";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `about ${Math.round(days / 30)} month(s) ago`;
}

export function formatBriefing(ctx: CallerContext, briefings: ReadonlyArray<TicketBriefing>): string {
  if (!ctx.knownCaller) {
    return "CALLER: unknown number — not in our system. Do not share any ticket details unless they provide a specific ticket number that checks out via the lookup_ticket tool.";
  }
  const callerName = ctx.users[0]?.name ?? null;
  const lines: string[] = [
    `CALLER: recognized by their phone number — it matches ${callerName ?? "a contact"} at ${ctx.clientName ?? "an unknown company"} in our records. If they ask how you know who they are, say their number is on file with their company's account.`,
    briefings.length === 0 ? "No open tickets for this caller right now." : `OPEN TICKETS, freshest activity first (${briefings.length}):`,
  ];
  for (const b of briefings) {
    const t = b.ticket;
    const created = ageInDays(t.created_at ? new Date(t.created_at).getTime() : 0);
    const active = ageInDays(lastActivityMs(t));
    lines.push(
      `- Ticket ${t.halo_id}: "${toSpeakableText(t.summary, 120)}" — status: ${t.halo_status ?? "open"}${t.halo_agent ? `, assigned to ${t.halo_agent}` : ", not yet assigned"}${t.user_name ? `, reported by ${t.user_name}` : ""}. Opened ${agePhrase(created)}, last activity ${agePhrase(active)}.`,
    );
    lines.push(
      b.lastCustomerUpdate
        ? `  Latest update we sent (${b.lastCustomerUpdate.who}, ${b.lastCustomerUpdate.when}): "${b.lastCustomerUpdate.text}"`
        : `  No customer-facing update has been posted yet.`,
    );
  }
  if (briefings.length > 1) {
    lines.push(
      `Lead with the MOST RECENTLY ACTIVE ticket — that is almost always what they're calling about. Mention older open tickets only briefly ("you also have an older ticket about X") or when the caller brings them up.`,
    );
  }
  return lines.join("\n");
}
