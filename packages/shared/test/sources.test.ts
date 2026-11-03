import { describe, expect, it } from "vitest";
import { parseConfig, requestPath, validateConfig, type AppConfig, type GatewayConfig } from "../src";

const route = { name: "r", on: { type: "event" as const, events: ["push"] }, forwardTo: "https://n8n.test/webhook/x" };
const withApp = (app: AppConfig, lists: Record<string, string[]> = {}): GatewayConfig => ({ lists, apps: { a: app } });

describe("sources in the config", () => {
  it("builds each source's URL path", () => {
    expect(requestPath("slack", "a")).toBe("/slack/a");
    expect(requestPath("github", "a")).toBe("/github/a");
    expect(requestPath("telegram", "a")).toBe("/telegram/a");
    expect(requestPath("webhook", "a")).toBe("/hook/a");
  });

  it("accepts a GitHub app with match conditions", () => {
    expect(validateConfig(withApp({ source: "github", signingSecret: "GITHUB_SECRET_A", routes: [{ ...route, match: [{ field: "branch", op: "is", value: "main" }] }] }))).toEqual([]);
  });

  it("requires a verify method for webhooks, and only for webhooks", () => {
    expect(validateConfig(withApp({ source: "webhook", signingSecret: "WEBHOOK_SECRET_A", routes: [] })).join()).toContain("verify is required");
    expect(validateConfig(withApp({ source: "webhook", signingSecret: "WEBHOOK_SECRET_A", verify: { type: "hmac", header: "bad header", encoding: "hex" }, routes: [] })).join()).toContain("header must be a header name");
    expect(validateConfig(withApp({ source: "github", signingSecret: "GITHUB_SECRET_A", verify: { type: "url-token", param: "t" }, routes: [] })).join()).toContain("only applies to webhook apps");
  });

  it("keeps Slack-only triggers and filters off other sources", () => {
    const errors = validateConfig(
      withApp({ source: "telegram", signingSecret: "TELEGRAM_SECRET_A", routes: [{ ...route, on: { type: "command", commands: ["/x"] } }, { ...route, name: "f", filters: { ignoreBots: true } }] }),
    ).join();
    expect(errors).toContain('on.type must be "event" for telegram apps');
    expect(errors).toContain("filters only apply to Slack apps");
  });

  it("checks conditions: operator, value, regular expression and lists", () => {
    const errors = validateConfig(
      withApp({
        source: "github",
        signingSecret: "GITHUB_SECRET_A",
        routes: [
          {
            ...route,
            match: [
              { field: "a", op: "nope" as "is" },
              { field: "b", op: "in" },
              { field: "c", op: "matches", value: "(" },
              { field: "d", op: "in", value: "@missing" },
              { field: "e", op: "exists", value: "x" },
            ],
          },
        ],
      }),
    ).join("\n");
    expect(errors).toContain("match[0].op must be one of");
    expect(errors).toContain("match[1].value is required for in");
    expect(errors).toContain("match[2].value is not a valid regular expression");
    expect(errors).toContain("match[3].value uses unknown list @missing");
    expect(errors).toContain("match[4].value is not used by exists");
  });

  it("rejects an unknown source and a malformed match when parsing stored JSON", () => {
    expect(validateConfig(withApp({ source: "discord" as "slack", signingSecret: "X", routes: [] })).join()).toContain("source must be one of");
    const parsed = parseConfig(JSON.stringify(withApp({ source: "github", signingSecret: "GITHUB_SECRET_A", routes: [{ ...route, match: [{ field: 1 }] as never }] })));
    expect(parsed.ok).toBe(false);
  });

  it("still treats an app without a source as Slack", () => {
    expect(validateConfig(withApp({ signingSecret: "SLACK_SIGNING_SECRET_A", routes: [{ ...route, on: { type: "command", commands: ["/ask"] } }] }))).toEqual([]);
  });
});
