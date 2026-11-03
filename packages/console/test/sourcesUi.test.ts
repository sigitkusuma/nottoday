import { describe, expect, it } from "vitest";
import { validateConfig, type AppConfig, type GatewayConfig, type SourceType } from "@gw/shared";
import { decide, parseGithubRequest } from "@gw/engine/router";
import { botStatus } from "../src/web/botHealth";
import { reasonText, summarizeRoute } from "../src/web/routeSummary";
import { SOURCES, VERIFY_PRESETS } from "../src/web/sources";

const appFor = (source: SourceType, extra: Partial<AppConfig> = {}): AppConfig => ({
  source,
  signingSecret: `${source.toUpperCase()}_SECRET_X`,
  ...(source === "webhook" ? { verify: VERIFY_PRESETS[0].verify } : {}),
  routes: [],
  ...extra,
});

describe("source templates", () => {
  for (const source of ["github", "telegram", "webhook"] as const) {
    it(`every ${source} template makes a route the gateway accepts (once its blanks are filled)`, () => {
      for (const t of SOURCES[source].templates) {
        const match = t.match?.map((c) => (c.field ? c : { ...c, field: "status", value: "paid" }));
        const config: GatewayConfig = { lists: {}, apps: { x: appFor(source, { routes: [{ name: t.id, on: t.on, match, respond: t.respond, forwardTo: "https://n8n.test/webhook/x" }] }) } };
        expect(validateConfig(config), t.id).toEqual([]);
      }
    });
  }

  it("the GitHub push template forwards a person's push to main and drops a bot's", () => {
    const t = SOURCES.github.templates.find((x) => x.id === "gh-push")!;
    const app = appFor("github", { routes: [{ name: "r", on: t.on, match: t.match, forwardTo: "https://n8n.test/webhook/x" }] });
    const push = (sender: string) => parseGithubRequest(new Headers({ "x-github-event": "push" }), JSON.stringify({ ref: "refs/heads/main", sender: { type: sender } }));
    expect(decide(app, push("User"), {})[0].forward).toBe(true);
    expect(decide(app, push("Bot"), {})[0]).toMatchObject({ forward: false, reason: "match:sender.type" });
  });

  it("every webhook preset is a valid verify setting", () => {
    for (const p of VERIFY_PRESETS) expect(validateConfig({ lists: {}, apps: { x: appFor("webhook", { verify: p.verify, eventField: p.eventField }) } }), p.id).toEqual([]);
  });
});

describe("summaries and reasons for other sources", () => {
  it("names events and conditions with the field labels people saw", () => {
    const text = summarizeRoute(
      { name: "r", on: { type: "event", events: ["push"] }, match: [{ field: "branch", op: "is", value: "main" }, { field: "sender.type", op: "isNot", value: "Bot" }], forwardTo: "https://x.test" },
      "github",
    ).join(" ");
    expect(text).toContain('Forwards pushes where Branch (pushes) is "main" and Sender type is not "Bot".');
    expect(text).toContain("Other events are dropped.");
  });

  it("warns when a route forwards everything", () => {
    expect(summarizeRoute({ name: "r", on: { type: "event", events: ["*"] }, forwardTo: "https://x.test" }, "webhook").join(" ")).toContain("saves nothing yet");
  });

  it("explains a failed condition", () => {
    expect(reasonText("match:workflow_run.conclusion", "github")).toBe("Workflow run result didn't match the route's condition");
  });
});

describe("health wording", () => {
  it("says who it's waiting for", () => {
    const base = { key: "x", missingSecret: false, routes: [], live: [], now: 0 };
    expect(botStatus({ ...base, app: appFor("github", { routes: [{ name: "r", on: { type: "event", events: ["*"] }, forwardTo: "https://x.test" }] }) }).label).toBe("Waiting for GitHub");
    expect(botStatus({ ...base, app: appFor("telegram"), missingSecret: true }).detail).toContain("Telegram's requests are refused");
  });
});
