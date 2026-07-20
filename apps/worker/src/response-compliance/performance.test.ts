import { describe, expect, it } from "vitest";
import { buildTechnicianEmailPerformance, type TechnicianResponsePerformanceRow } from "./performance.js";

function row(input: Partial<TechnicianResponsePerformanceRow>): TechnicianResponsePerformanceRow {
  return {
    assigned_tech: "Jarid Carlson",
    assigned_at: "2026-07-20T20:45:00.000Z", // Monday 4:45 PM ET
    ticket_created_at: "2026-07-20T20:45:00.000Z",
    technician_response_at: "2026-07-21T12:15:00.000Z", // Tuesday 8:15 AM ET = 30 business minutes
    technician_response_met: true,
    ...input,
  };
}

describe("technician email performance", () => {
  it("reports rolling on-time rate, median email time, and missing emails", () => {
    const result = buildTechnicianEmailPerformance([
      row({}),
      row({
        technician_response_at: "2026-07-21T13:45:00.000Z",
        technician_response_met: false,
      }),
      row({
        assigned_tech: "Darren Davillier",
        technician_response_at: null,
        technician_response_met: false,
      }),
    ], new Date("2026-07-21T16:00:00.000Z"));

    expect(result.team).toMatchObject({ measured: 3, onTime: 1, missed: 2, onTimePercent: 33, noEmail: 1 });
    expect(result.technicians[0]).toMatchObject({
      tech: "Jarid Carlson",
      measured: 2,
      onTime: 1,
      missed: 1,
      onTimePercent: 50,
      medianEmailMinutes: 75,
      noEmail: 0,
    });
    expect(result.technicians[1]).toMatchObject({
      tech: "Darren Davillier",
      measured: 1,
      onTimePercent: 0,
      medianEmailMinutes: null,
      noEmail: 1,
    });
  });

  it("excludes pending, old, unassigned, and non-helpdesk rows", () => {
    const result = buildTechnicianEmailPerformance([
      row({ technician_response_met: null }),
      row({ ticket_created_at: "2026-07-01T12:00:00.000Z" }),
      row({ assigned_tech: null }),
      row({ assigned_tech: "Bryanna Marquez" }),
    ], new Date("2026-07-21T16:00:00.000Z"));

    expect(result.team.measured).toBe(0);
    expect(result.technicians).toEqual([]);
  });
});
