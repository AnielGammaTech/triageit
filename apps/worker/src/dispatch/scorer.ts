import type { TechStatus } from "./presence.js";

export interface TechCandidate {
  readonly tech: string;
  readonly status: TechStatus;                 // from presence.ts
  readonly openTickets: number;
  readonly breaching: number;
  readonly strongCategories: ReadonlyArray<string>;
  readonly weakCategories: ReadonlyArray<string>;
  readonly recentSimilarForClient: number;     // resolved tickets, same client+type, 30d
}

export interface TicketToAssign {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly ticketType: string | null;          // Ryan classification type
}

export interface Suggestion {
  readonly tech: string;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}

const AVAILABILITY_POINTS: Record<TechStatus["state"], number> = {
  available: 40, working: 28, on_call: 24, meeting: 18, dnd: 14, away: 12, onsite: 10, unknown: 8, unreachable: 4, off: 0,
};

// Short availability phrase per state — the full status detail ("onsite —
// advance medical of naples, llc — malware pop ups until 6:15 pm") floods
// the suggestion UI; the board row already shows the detail.
const AVAILABILITY_PHRASE: Record<TechStatus["state"], string> = {
  available: "Available now",
  on_call: "On a call",
  meeting: "In a meeting",
  onsite: "Onsite now",
  off: "Off today",
  working: "Working a ticket",
  dnd: "Phone on Do Not Disturb",
  away: "Phone set to away",
  unreachable: "Phone not registered",
  unknown: "No live signal",
};

export function scoreTechForTicket(t: TechCandidate, ticket: TicketToAssign): Suggestion {
  const reasons: string[] = [];
  const avail = AVAILABILITY_POINTS[t.status.state];
  reasons.push(AVAILABILITY_PHRASE[t.status.state]);
  // Inverse load 0-30: 0 open → 30, 30+ open → 0. Breaching tickets weigh double.
  const effectiveLoad = t.openTickets + t.breaching;
  const load = Math.max(0, 30 - effectiveLoad);
  reasons.push(`${t.openTickets} open${t.breaching > 0 ? ` (${t.breaching} breaching)` : ""}`);
  let fit = 0;
  const type = (ticket.ticketType ?? "").toLowerCase();
  if (type && t.strongCategories.some((c) => c.toLowerCase() === type)) { fit += 15; reasons.push(`strong on ${type} (Toby)`); }
  if (type && t.weakCategories.some((c) => c.toLowerCase() === type)) { fit -= 10; reasons.push(`weak on ${type} (Toby)`); }
  let recency = 0;
  if (t.recentSimilarForClient > 0) { recency = Math.min(10, t.recentSimilarForClient * 5); reasons.push(`resolved ${t.recentSimilarForClient} similar for ${ticket.client_name ?? "this client"} recently`); }
  return { tech: t.tech, score: avail + load + fit + recency, reasons };
}
