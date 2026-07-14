import { describe, expect, it } from "vitest";
import { TOOLS } from "@/content/tools";
import { MOCKUPS } from "@/components/mockups";

describe("mockup registry", () => {
  it("has a mockup component for every tool", () => {
    for (const tool of TOOLS) {
      expect(MOCKUPS[tool.mockup], `missing mockup: ${tool.mockup}`).toBeTypeOf("function");
    }
  });
});
