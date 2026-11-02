import { describe, expect, it } from "vitest";
import config from "../../engine/examples/dev.config.json";
import { validateConfig } from "../src/validate";
import type { GatewayConfig } from "../src/types";

describe("example config", () => {
  it("is valid", () => {
    expect(validateConfig(config as GatewayConfig)).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("catches common mistakes", () => {
    const errors = validateConfig({
      lists: { team: ["U1", ""] },
      apps: {
        Bad: {
          signingSecret: "xoxb-real-secret-pasted",
          routes: [
            { name: "a", on: { type: "event", events: ["message"] }, filters: { mentionIn: "@missing", textMatches: "(" }, forwardTo: "http://n8n.test" },
            { name: "a", on: { type: "command", commands: ["ask"] }, filters: { ignoreBots: true }, forwardTo: "not a url" },
          ],
        },
      },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "lists.team contains an empty value",
        expect.stringContaining("app key must be lowercase"),
        expect.stringContaining("signingSecret must be a secret NAME"),
        expect.stringContaining("forwardTo must be https"),
        expect.stringContaining("unknown list @missing"),
        expect.stringContaining("not a valid regular expression"),
        expect.stringContaining("duplicate route name"),
        expect.stringContaining("must start with /"),
        expect.stringContaining("filters only apply to event routes"),
        expect.stringContaining("not a valid URL"),
      ]),
    );
  });
});
