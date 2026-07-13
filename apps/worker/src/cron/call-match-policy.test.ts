import { describe, expect, it } from "vitest";
import { isCallAuditStaffName, isSupportCallStaffName } from "@triageit/shared";
import {
  choosePhoneTicketMatchStrategy,
  phoneTicketSearchTerms,
  transcriptTicketMatchMinConfidence,
} from "./call-match-policy.js";

describe("choosePhoneTicketMatchStrategy", () => {
  it("allows a direct match for one contact with one open ticket", () => {
    expect(choosePhoneTicketMatchStrategy({
      haloUserCount: 1,
      exactUserTicketCount: 1,
      clientTicketCount: 4,
    })).toBe("direct_user");
  });

  it("requires client-wide transcript matching for a shared main line", () => {
    expect(choosePhoneTicketMatchStrategy({
      haloUserCount: 10,
      exactUserTicketCount: 1,
      clientTicketCount: 8,
    })).toBe("transcript_client");
  });

  it("does not directly match the only open ticket behind a shared line", () => {
    expect(choosePhoneTicketMatchStrategy({
      haloUserCount: 6,
      exactUserTicketCount: 1,
      clientTicketCount: 1,
    })).toBe("transcript_client");
  });

  it("disambiguates several tickets for one exact contact by transcript", () => {
    expect(choosePhoneTicketMatchStrategy({
      haloUserCount: 1,
      exactUserTicketCount: 3,
      clientTicketCount: 5,
    })).toBe("transcript_user");
  });

  it("declines when there are no client tickets", () => {
    expect(choosePhoneTicketMatchStrategy({
      haloUserCount: 1,
      exactUserTicketCount: 0,
      clientTicketCount: 0,
    })).toBe("none");
  });
});

describe("phoneTicketSearchTerms", () => {
  it("builds the callback-number formats found in ticket bodies", () => {
    expect(phoneTicketSearchTerms("+1 (239) 404-2533")).toEqual([
      "2394042533",
      "12394042533",
      "239-404-2533",
      "239 404 2533",
      "239.404.2533",
    ]);
  });
});

describe("support call scope", () => {
  it("keeps helpdesk, dispatch, and IT leadership calls", () => {
    expect(isSupportCallStaffName("Lawyer, Matthew")).toBe(true);
    expect(isSupportCallStaffName("Marquez, Bryanna")).toBe(true);
    expect(isSupportCallStaffName("Reyes, Aniel")).toBe(true);
  });

  it("excludes non-IT employee calls", () => {
    expect(isSupportCallStaffName("Arzan, Amber")).toBe(false);
    expect(isSupportCallStaffName("Konert, Bradd")).toBe(false);
    expect(isSupportCallStaffName("Hernandez, Roman")).toBe(false);
  });

  it("still analyzes account-manager calls so owned ticket work can be retained", () => {
    expect(isCallAuditStaffName("Hernandez, Roman")).toBe(true);
    expect(isCallAuditStaffName("Cassetty, Todd")).toBe(true);
    expect(isCallAuditStaffName("Arzan, Amber")).toBe(false);
  });
});

describe("transcriptTicketMatchMinConfidence", () => {
  const now = new Date("2026-07-13T21:00:00Z").getTime();

  it("requires stronger evidence for callback-number matches", () => {
    expect(transcriptTicketMatchMinConfidence("callback_number", true, "2026-07-13T12:00:00Z", now)).toBe(0.8);
    expect(transcriptTicketMatchMinConfidence("callback_number", false, "2026-04-15T12:00:00Z", now)).toBe(0.9);
  });

  it("keeps global matches strict and client-scoped matches practical", () => {
    expect(transcriptTicketMatchMinConfidence("global", true, null, now)).toBe(0.75);
    expect(transcriptTicketMatchMinConfidence("client", true, null, now)).toBe(0.6);
  });
});
