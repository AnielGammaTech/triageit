import { describe, expect, it } from "vitest";
import {
  deriveDispatchAction,
  type DispatchTicketSignals,
} from "./action-queue.js";

const NOW = Date.parse("2026-07-13T16:00:00.000Z");

function ticket(overrides: Partial<DispatchTicketSignals> = {}): DispatchTicketSignals {
  return {
    haloId: 100,
    status: "In Progress",
    assignedTo: "Raul Tapanes",
    priority: 3,
    createdAt: "2026-07-13T12:00:00.000Z",
    lastCustomerReplyAt: null,
    lastTechActionAt: "2026-07-13T15:00:00.000Z",
    slaCurrentlyBreached: false,
    slaFixBy: null,
    slaRespondBy: null,
    slaOnHold: false,
    ownerState: "available",
    ...overrides,
  };
}

describe("deriveDispatchAction", () => {
  it("puts a live SLA breach ahead of every other signal", () => {
    const action = deriveDispatchAction(
      ticket({ status: "New", assignedTo: null, slaCurrentlyBreached: true }),
      NOW,
    );
    expect(action?.kind).toBe("sla_breach");
    expect(action?.lane).toBe("now");
  });

  it("makes an unassigned ticket a now action", () => {
    const action = deriveDispatchAction(ticket({ status: "New", assignedTo: null }), NOW);
    expect(action).toMatchObject({ kind: "assign", lane: "now" });
  });

  it("never calls an assigned New ticket unowned", () => {
    const action = deriveDispatchAction(ticket({ status: "New", assignedTo: "Raul Tapanes" }), NOW);
    expect(action?.kind).not.toBe("assign");
    expect(action?.reason).not.toBe("No helpdesk technician owns this");
  });

  it("asks for coverage when an active ticket owner is off", () => {
    const action = deriveDispatchAction(
      ticket({ status: "Customer Reply", ownerState: "off" }),
      NOW,
    );
    expect(action).toMatchObject({ kind: "cover", lane: "now" });
    expect(action?.reason).toContain("Raul Tapanes");
  });

  it("surfaces deadlines inside 24 hours and escalates those inside 4", () => {
    expect(
      deriveDispatchAction(ticket({ slaFixBy: "2026-07-14T12:00:00.000Z" }), NOW),
    ).toMatchObject({ kind: "due_soon", lane: "today" });
    expect(
      deriveDispatchAction(ticket({ slaFixBy: "2026-07-13T18:00:00.000Z" }), NOW),
    ).toMatchObject({ kind: "due_soon", lane: "now" });
  });

  it("does not use deadlines while the SLA is on hold", () => {
    expect(
      deriveDispatchAction(
        ticket({ status: "Waiting on Customer", slaFixBy: "2026-07-13T18:00:00.000Z", slaOnHold: true }),
        NOW,
      ),
    ).toBeNull();
  });

  it("turns customer replies and waiting-on-tech tickets into today actions", () => {
    expect(
      deriveDispatchAction(ticket({ status: "Customer Reply" }), NOW),
    ).toMatchObject({ kind: "customer_reply", lane: "today" });
    expect(
      deriveDispatchAction(ticket({ status: "Waiting on Tech" }), NOW),
    ).toMatchObject({ kind: "waiting_on_tech", lane: "today" });
  });

  it("watches stale active work without flagging parked workflow states", () => {
    const staleAt = "2026-07-08T16:00:00.000Z";
    expect(
      deriveDispatchAction(ticket({ lastTechActionAt: staleAt }), NOW),
    ).toMatchObject({ kind: "stale", lane: "watch" });
    expect(
      deriveDispatchAction(ticket({ status: "Waiting on Customer", lastTechActionAt: staleAt }), NOW),
    ).toBeNull();
  });
});
