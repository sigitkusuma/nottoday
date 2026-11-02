import { describe, expect, it } from "vitest";
import type { Route } from "@gw/shared";
import { summarizeRoute } from "../src/web/routeSummary";
import { ROUTE_TEMPLATES } from "../src/web/components/templates";

const fromTemplate = (id: string, patch: Partial<Route> = {}): Route => {
  const t = ROUTE_TEMPLATES.find((x) => x.id === id)!;
  return { name: "r", forwardTo: "https://n8n.test/x", on: t.on, filters: t.filters, respond: t.respond, ...patch };
};
const text = (r: Route) => summarizeRoute(r).join(" ");

describe("summarizeRoute", () => {
  it("describes every template in plain words", () => {
    for (const t of ROUTE_TEMPLATES) {
      const sentences = summarizeRoute(fromTemplate(t.id));
      expect(sentences.length).toBeGreaterThan(0);
      for (const s of sentences) expect(s).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("mentions of people on a list", () => {
    const s = text(fromTemplate("mention-list"));
    expect(s).toContain("Forwards new messages, thread replies also sent to the channel and messages with a file");
    expect(s).toContain("that mention someone other than the sender");
    expect(s).toContain("Drops bot messages, edits, deletes and other message kinds such as joins and anything posted by a bot.");
  });

  it("direct messages", () => {
    expect(text(fromTemplate("dm"))).toContain("Forwards new messages in direct messages to the bot.");
  });

  it("keyword, with the list and the pattern named", () => {
    const r = fromTemplate("keyword");
    r.filters = { ...r.filters, mentionIn: "@oncall", textMatches: "\\b[Dd]eploy" };
    const s = text(r);
    expect(s).toContain("that mention someone in the list @oncall");
    expect(s).toContain("whose text matches \\b[Dd]eploy");
  });

  it("specific channels", () => {
    expect(text(fromTemplate("channels", { filters: { channels: ["C1", "C2"], ignoreBots: true } }))).toContain("in 2 channels");
  });

  it("slash commands and buttons", () => {
    expect(text(fromTemplate("command", { on: { type: "command", commands: ["/ask"] } }))).toBe("Forwards the slash command /ask and returns n8n's reply to Slack.");
    expect(text(fromTemplate("buttons"))).toBe("Forwards every button click, menu choice and modal submission.");
  });

  it("warns when a route has no filters", () => {
    expect(text({ name: "r", forwardTo: "https://n8n.test/x", on: { type: "event", events: ["message"] } })).toContain("saves nothing yet");
  });
});
