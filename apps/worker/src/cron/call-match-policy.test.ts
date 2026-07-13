import { describe, expect, it } from "vitest";
import { choosePhoneTicketMatchStrategy } from "./call-match-policy.js";

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
