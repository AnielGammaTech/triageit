import { describe, expect, it } from "vitest";
import { scoreTechForTicket, type TechCandidate, type TicketToAssign } from "./scorer.js";

const ticket: TicketToAssign = { halo_id: 1, summary: "Outlook broken", client_name: "Acme", ticketType: "email" };
const tech = (over: Partial<TechCandidate>): TechCandidate => ({
  tech: "T", status: { state: "available", detail: null }, openTickets: 10, breaching: 0,
  strongCategories: [], weakCategories: [], recentSimilarForClient: 0, ...over,
});

describe("scoreTechForTicket", () => {
  it("availability dominates: available+heavy beats off+idle", () => {
    const busy = scoreTechForTicket(tech({ openTickets: 30 }), ticket);
    const off = scoreTechForTicket(tech({ status: { state: "off", detail: null }, openTickets: 0 }), ticket);
    expect(busy.score).toBeGreaterThan(off.score);
  });
  it("lighter load scores higher, all else equal", () => {
    expect(scoreTechForTicket(tech({ openTickets: 5 }), ticket).score)
      .toBeGreaterThan(scoreTechForTicket(tech({ openTickets: 25 }), ticket).score);
  });
  it("skill fit is a tiebreaker, not a trump: available always beats on_call regardless of fit", () => {
    const fitButBusy = scoreTechForTicket(tech({ status: { state: "on_call", detail: null }, strongCategories: ["email"] }), ticket);
    const freeNoFit = scoreTechForTicket(tech({}), ticket);
    expect(freeNoFit.score).toBeGreaterThan(fitButBusy.score);
  });
  it("weak category subtracts and is stated in reasons", () => {
    const s = scoreTechForTicket(tech({ weakCategories: ["email"] }), ticket);
    expect(s.reasons.join(" ")).toMatch(/weak/i);
  });
  it("every contributing factor appears in reasons", () => {
    const s = scoreTechForTicket(tech({ strongCategories: ["email"], recentSimilarForClient: 2 }), ticket);
    expect(s.reasons.length).toBeGreaterThanOrEqual(3); // availability + load + fit (+ recency)
  });
});
