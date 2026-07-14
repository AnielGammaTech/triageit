import { describe, expect, it } from "vitest";
import { botIdMatchesApp } from "./bot.js";

describe("Teams bot identity routing", () => {
  const callBotId = "c5164f1d-d52b-4883-8456-fd7a38ed699a";
  const prisonMikeId = "0e794ae8-fb54-49b6-9f2f-a5e2664cd436";

  it("matches the dedicated call bot recipient", () => {
    expect(botIdMatchesApp(`28:${callBotId}`, callBotId)).toBe(true);
    expect(botIdMatchesApp(callBotId, callBotId)).toBe(true);
  });

  it("does not route Prison Mike to call review", () => {
    expect(botIdMatchesApp(`28:${prisonMikeId}`, callBotId)).toBe(false);
  });

  it("requires an exact bot application id", () => {
    expect(botIdMatchesApp(`prefix-${callBotId}`, callBotId)).toBe(false);
    expect(botIdMatchesApp(undefined, callBotId)).toBe(false);
    expect(botIdMatchesApp(`28:${callBotId}`, "")).toBe(false);
  });
});
