import { describe, expect, it } from "vitest";
import { isCustomerResponseClient } from "./eligibility.js";

describe("isCustomerResponseClient", () => {
  it("keeps real customer organizations", () => {
    expect(isCustomerResponseClient("COLLIER PODIATRY, P.A")).toBe(true);
    expect(isCustomerResponseClient("HUMANE SOCIETY OF NAPLES, INC")).toBe(true);
  });

  it("excludes automated and internal system intake", () => {
    expect(isCustomerResponseClient("Alerts")).toBe(false);
    expect(isCustomerResponseClient("Unknown")).toBe(false);
    expect(isCustomerResponseClient("GAMMA TECH SERVICES LLC")).toBe(false);
    expect(isCustomerResponseClient(null)).toBe(false);
  });
});
