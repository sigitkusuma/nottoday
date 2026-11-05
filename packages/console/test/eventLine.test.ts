import { describe as group, expect, it } from "vitest";
import { describe } from "../src/web/activityExplain";
import type { LiveDecision, LiveEvent } from "../src/web/useLive";

const ev = (routes: LiveDecision[], over: Partial<LiveEvent> = {}): LiveEvent => ({ time: "2026-11-05T06:10:00Z", kind: "event", app: "scout", type: "message", channel: "C1", routes, ...over });
const route = (over: Partial<LiveDecision>): LiveDecision => ({ route: "r", mode: "enforce", filter: "pass", forwarded: true, status: 200, ...over });

group("describe: one line per request in Activity", () => {
  it("says why a route dropped it, in words rather than the filter's key", () => {
    expect(describe(ev([route({ route: "pages", filter: "fail", forwarded: false, reason: "mentionIn" })]))).toBe(
      "message: pages dropped it because it doesn't mention anyone on the list.",
    );
  });

  it("shadow: says what the route would drop and that it was forwarded anyway", () => {
    expect(describe(ev([route({ route: "triage", mode: "shadow", filter: "fail", reason: "channels" })]))).toBe(
      "message: triage would drop it because it's not in one of the listed channels (shadow mode: forwarded).",
    );
  });

  it("names a condition's field for non-Slack apps", () => {
    const line = describe(ev([route({ filter: "fail", forwarded: false, reason: "match:ref" })], { source: "github", type: "push" }));
    expect(line).toMatch(/^push: r dropped it because .+ didn't match the route's condition\.$/);
  });

  it("without a reason, still reads as a sentence", () => {
    expect(describe(ev([route({ filter: "fail", forwarded: false })]))).toBe("message: r dropped it.");
  });

  it("forwarded routes show n8n's status", () => {
    expect(describe(ev([route({})]))).toBe("message: r forwarded (n8n 200).");
  });
});
