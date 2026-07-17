import { describe, expect, it } from "vitest";
import { extractSpokenTicketNumbers } from "./call-analysis.js";

describe("spoken Halo ticket numbers", () => {
  it("extracts an explicitly spoken ticket number", () => {
    expect(extractSpokenTicketNumbers("I wanted to call really quick about ticket 40139."))
      .toEqual([40139]);
  });

  it("normalizes leading zeros and spaced digits", () => {
    expect(extractSpokenTicketNumbers("This is for ticket number 0040139, not case 4 1 2 2 2."))
      .toEqual([40139, 41222]);
  });

  it("does not combine currency or comma-formatted values into a ticket", () => {
    expect(extractSpokenTicketNumbers("The invoice was $409.12 and the total was 40,911."))
      .toEqual([]);
  });
});
