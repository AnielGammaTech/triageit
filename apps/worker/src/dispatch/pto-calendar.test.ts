import { describe, expect, it } from "vitest";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import type { RosterAgent } from "./board-sources.js";
import {
  parseOffSubject,
  techsMatchingOffSubject,
  techsOffFromSharedCalendar,
} from "./pto-calendar.js";

const roster: ReadonlyArray<RosterAgent> = [
  { id: 1, name: "Ryan Fitzpatrick", email: "ryan@gamma.tech" },
  { id: 2, name: "Matthew Tarnowski", email: "matthew@gamma.tech" },
  { id: 3, name: "Matthew Lawyer", email: "matthewl@gamma.tech" },
  { id: 4, name: "Bryanna Jones", email: "bryanna@gamma.tech" },
];

const event = (subject: string | null): MsGraphCalendarEvent => ({
  subject,
  startsAt: "2026-07-10T04:00:00.000Z",
  endsAt: "2026-07-11T04:00:00.000Z",
  showAs: "free", // shared PTO calendar events are all-day "free" (verified live)
  isAllDay: true,
  categories: [],
});

describe("parseOffSubject", () => {
  it("parses plain first-name subjects", () => {
    expect(parseOffSubject("Ryan OFF")).toEqual({ firstName: "Ryan", initial: null });
  });

  it("parses first name + last-name initial with dot", () => {
    expect(parseOffSubject("Matthew T. OFF")).toEqual({ firstName: "Matthew", initial: "T" });
  });

  it("parses initial without a dot and is case-insensitive", () => {
    expect(parseOffSubject("josh off")).toEqual({ firstName: "josh", initial: null });
    expect(parseOffSubject("Bryan OFF")).toEqual({ firstName: "Bryan", initial: null });
  });

  it("tolerates leading whitespace and trailing text", () => {
    expect(parseOffSubject("  Ryan OFF (vacation)")).toEqual({ firstName: "Ryan", initial: null });
  });

  it("rejects non-OFF subjects", () => {
    expect(parseOffSubject("Company Holiday")).toBeNull();
    expect(parseOffSubject("Ryan OFFICE visit")).toBeNull(); // \b guard
    expect(parseOffSubject(null)).toBeNull();
  });
});

describe("techsMatchingOffSubject", () => {
  it("matches a unique first name (the live 'Ryan OFF' case)", () => {
    expect(techsMatchingOffSubject("Ryan OFF", roster)).toEqual(["Ryan Fitzpatrick"]);
  });

  it("disambiguates by last-name initial", () => {
    expect(techsMatchingOffSubject("Matthew T. OFF", roster)).toEqual(["Matthew Tarnowski"]);
    expect(techsMatchingOffSubject("Matthew L. OFF", roster)).toEqual(["Matthew Lawyer"]);
  });

  it("marks NOBODY off when the initial matches no roster tech", () => {
    expect(techsMatchingOffSubject("Matthew Z. OFF", roster)).toEqual([]);
    expect(techsMatchingOffSubject("Ryan Q. OFF", roster)).toEqual([]);
  });

  it("matches all techs sharing a first name when no initial is given", () => {
    expect(techsMatchingOffSubject("Matthew OFF", roster)).toEqual([
      "Matthew Tarnowski",
      "Matthew Lawyer",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(techsMatchingOffSubject("BRYANNA OFF", roster)).toEqual(["Bryanna Jones"]);
  });
});

describe("techsOffFromSharedCalendar", () => {
  it("collects all matched techs across events", () => {
    const off = techsOffFromSharedCalendar(
      [event("Ryan OFF"), event("Matthew T. OFF"), event("Team Lunch")],
      roster,
    );
    expect(off).toEqual(new Set(["Ryan Fitzpatrick", "Matthew Tarnowski"]));
  });

  it("returns an empty set when nothing matches", () => {
    expect(techsOffFromSharedCalendar([event("Company Holiday")], roster).size).toBe(0);
  });
});
