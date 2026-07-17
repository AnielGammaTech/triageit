import { describe, expect, it } from "vitest";
import { isAlertTicket } from "./erin-hannon.js";

describe("isAlertTicket", () => {
  it("recognizes a generated Cove device failure subject", () => {
    expect(
      isAlertTicket(
        "ffcf-dc01 in Fostering success is failing in Cove",
        null,
        "retriage",
        "critical",
      ),
    ).toBe(true);
  });

  it("does not treat a human Cove support request as an automated alert", () => {
    expect(
      isAlertTicket(
        "Can you please help us check Cove?",
        "We need help confirming yesterday's backup.",
        "backup",
        "support",
      ),
    ).toBe(false);
  });
});
