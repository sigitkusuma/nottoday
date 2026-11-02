import { describe, expect, it } from "vitest";
import example from "../../engine/examples/dev.config.json";
import { parseConfig } from "../src/parse";

const withRoute = (route: unknown) =>
  JSON.stringify({ lists: {}, apps: { demo: { signingSecret: "SLACK_SIGNING_SECRET_DEMO", routes: [route] } } });

describe("parseConfig", () => {
  it("accepts a valid config", () => {
    const result = parseConfig(JSON.stringify(example));
    expect(result.ok).toBe(true);
  });

  it("accepts an app with no routes yet (it can still pass Slack's URL check)", () => {
    expect(parseConfig(JSON.stringify({ lists: {}, apps: { demo: { signingSecret: "S", routes: [] } } })).ok).toBe(true);
  });

  it.each([
    ["not JSON", "{", "config is not valid JSON"],
    ["no apps", JSON.stringify({ lists: {} }), "apps must be an object"],
    ["list of numbers", JSON.stringify({ lists: { team: [1] }, apps: {} }), "lists.team must be an array of strings"],
    ["routes not an array", JSON.stringify({ lists: {}, apps: { a: { signingSecret: "S", routes: {} } } }), "apps.a.routes must be an array"],
    ["unknown trigger", withRoute({ name: "r", on: { type: "cron" }, forwardTo: "https://x.test" }), "on.type must be one of"],
    ["events missing", withRoute({ name: "r", on: { type: "event" }, forwardTo: "https://x.test" }), "on.events must be an array of strings"],
    ["list filter wrong type", withRoute({ name: "r", on: { type: "event", events: ["message"] }, filters: { mentionIn: 5 }, forwardTo: "https://x.test" }), "mentionIn must be an array"],
    ["boolean filter as string", withRoute({ name: "r", on: { type: "event", events: ["message"] }, filters: { ignoreBots: "yes" }, forwardTo: "https://x.test" }), "ignoreBots must be true or false"],
    ["unknown filter", withRoute({ name: "r", on: { type: "event", events: ["message"] }, filters: { mentionsIn: "@team" }, forwardTo: "https://x.test" }), "mentionsIn is not a known filter"],
    ["misspelled mode", withRoute({ name: "r", mode: "shadw", on: { type: "event", events: ["message"] }, forwardTo: "https://x.test" }), 'mode must be "enforce" or "shadow"'],
  ])("rejects %s", (_label, json, message) => {
    const result = parseConfig(json);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
  });
});
