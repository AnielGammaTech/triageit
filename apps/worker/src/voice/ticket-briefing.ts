import type { HaloClient } from "../integrations/halo/client.js";
import type { CallerContext, CallerTicket } from "./status-script.js";

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
export function formatBriefing(ctx: CallerContext, briefings: ReadonlyArray<TicketBriefing>): string {
  if (!ctx.knownCaller) {
    return "CALLER: unknown number — not in our system. Do not share any ticket details unless they provide a specific ticket number that checks out via the lookup_ticket tool.";
  }
  const lines: string[] = [
    `CALLER: known — ${ctx.clientName ?? "client unknown"}.`,
    briefings.length === 0 ? "No open tickets for this caller right now." : `OPEN TICKETS (${briefings.length}):`,
  ];
  for (const b of briefings) {
    const t = b.ticket;
    lines.push(
      `- Ticket ${t.halo_id}: "${toSpeakableText(t.summary, 120)}" — status: ${t.halo_status ?? "open"}${t.halo_agent ? `, assigned to ${t.halo_agent}` : ", not yet assigned"}${t.user_name ? `, reported by ${t.user_name}` : ""}.`,
    );
    lines.push(
      b.lastCustomerUpdate
        ? `  Latest update we sent (${b.lastCustomerUpdate.who}, ${b.lastCustomerUpdate.when}): "${b.lastCustomerUpdate.text}"`
        : `  No customer-facing update has been posted yet.`,
    );
  }
  return lines.join("\n");
}
