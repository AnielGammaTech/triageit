import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeNorthAmericanPhoneNumber, TwilioClient } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeNorthAmericanPhoneNumber", () => {
  it("normalizes common 3CX phone formats to E.164", () => {
    expect(normalizeNorthAmericanPhoneNumber("(239) 555-0100")).toBe("+12395550100");
    expect(normalizeNorthAmericanPhoneNumber("1-239-555-0100")).toBe("+12395550100");
  });

  it("rejects extensions and non-North-American numbers", () => {
    expect(normalizeNorthAmericanPhoneNumber("143")).toBeNull();
    expect(normalizeNorthAmericanPhoneNumber("+44 20 7946 0958")).toBeNull();
  });
});

describe("TwilioClient.lookupCallerName", () => {
  it("requests Lookup v2 caller_name and returns the carrier identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        phone_number: "+12395550100",
        caller_name: {
          caller_name: "ALLEN CONCRETE INC",
          caller_type: "BUSINESS",
          error_code: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TwilioClient({
      account_sid: "AC_test",
      auth_token: "secret",
    }).lookupCallerName("239-555-0100");

    expect(result).toEqual({
      phoneNumber: "+12395550100",
      callerName: "ALLEN CONCRETE INC",
      callerType: "BUSINESS",
      errorCode: null,
    });
    const [requestUrl, options] = fetchMock.mock.calls[0];
    const url = new URL(requestUrl);
    expect(decodeURIComponent(url.pathname)).toBe("/v2/PhoneNumbers/+12395550100");
    expect(url.searchParams.get("Fields")).toBe("caller_name");
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from("AC_test:secret").toString("base64")}`);
  });

  it("returns a safe empty identity when Twilio has no CNAM record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        phone_number: "+12395550100",
        caller_name: { caller_name: null, caller_type: null, error_code: 60601 },
      }),
    }));

    await expect(new TwilioClient({
      account_sid: "AC_test",
      auth_token: "secret",
    }).lookupCallerName("+1 239 555 0100")).resolves.toEqual({
      phoneNumber: "+12395550100",
      callerName: null,
      callerType: null,
      errorCode: 60601,
    });
  });
});
