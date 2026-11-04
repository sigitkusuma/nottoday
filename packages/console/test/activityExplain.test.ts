import { describe, expect, it } from "vitest";
import { explainEvent, forwardFailed, routeResult } from "../src/web/activityExplain";
import type { LiveDecision, LiveEvent } from "../src/web/useLive";

const ev = (over: Partial<LiveEvent>): LiveEvent => ({ time: "2026-11-04T07:30:00Z", kind: "event", app: "scout", type: "message", channel: "C1", routes: [], ...over });
const route = (over: Partial<LiveDecision>): LiveDecision => ({ route: "r", mode: "enforce", filter: "pass", forwarded: true, status: 200, ...over });
const explain = (over: Partial<LiveEvent>, appHasRoutes = true) => explainEvent(ev(over), { appHasRoutes });

describe("explainEvent", () => {
  it("not routed: says which event no route lists, and what to do", () => {
    const x = explain({ type: "app_mention", routes: [] });
    expect(x.headline).toBe("Not routed: no route lists app_mention");
    expect(x.why.join(" ")).toContain("even in shadow mode");
    expect(x.why.join(" ")).toContain("Event Subscriptions");
    expect(x.action).toEqual({ label: "Open scout's routes", path: "apps/scout" });
  });

  it("not routed on an app with no routes asks for a route instead", () => {
    const x = explain({ routes: [] }, false);
    expect(x.why[0]).toContain("no routes yet");
    expect(x.action?.label).toBe("Add a route");
  });

  it("n8n error: names the route and status, and what that status usually means", () => {
    const x = explain({ routes: [route({ status: 404 })] });
    expect(x.headline).toBe("Forwarded, but n8n didn't accept it");
    expect(x.why[0]).toContain("r: HTTP 404");
    expect(x.why[1]).toContain("workflow is inactive");
  });

  it("n8n never answered", () => {
    const x = explain({ routes: [route({ status: undefined, error: "timeout" })] });
    expect(x.why.join(" ")).toContain("no answer");
    expect(x.why.join(" ")).toContain("Error: timeout");
  });

  it("shadow: forwarded, but the filter would drop it, with the reason in words", () => {
    const x = explain({ routes: [route({ mode: "shadow", filter: "fail", reason: "ignoreBots" })] });
    expect(x.headline).toContain("shadow mode");
    expect(x.why[0]).toContain("r: it was posted by a bot");
  });

  it("sent, and dropped by a filter", () => {
    expect(explain({ routes: [route({})] }).headline).toBe("Sent to n8n");
    const dropped = explain({ routes: [route({ forwarded: false, status: undefined, filter: "fail", reason: "requireMention" })] });
    expect(dropped.headline).toContain("one n8n execution saved");
    expect(dropped.why[0]).toContain("doesn't mention anyone");
  });

  it("rejections point at the app", () => {
    const bad = explain({ kind: "bad_signature", type: undefined, routes: undefined });
    expect(bad.headline).toContain("signature");
    expect(bad.action?.path).toBe("apps/scout");
    expect(explain({ kind: "missing_secret" }).action?.path).toBe("apps/scout");
    expect(explain({ kind: "unknown_app", app: "nope" }).action?.path).toBe("apps");
  });

  it("uses the sender's name for other kinds of apps", () => {
    expect(explain({ kind: "verified", source: "github" }).headline).toContain("GitHub");
  });
});

describe("routeResult", () => {
  it("states what happened to the request on one route", () => {
    expect(routeResult(route({}))).toBe("Sent to n8n (HTTP 200)");
    expect(routeResult(route({ forwarded: false, status: undefined }))).toBe("Dropped, never sent to n8n");
    expect(routeResult(route({ status: 502, attempts: 3 }))).toBe("n8n didn't accept it (HTTP 502) after 3 tries");
    expect(routeResult(route({ status: undefined }))).toBe("n8n didn't accept it (no answer)");
    expect(routeResult(route({ mode: "shadow", filter: "fail" }))).toContain("shadow mode");
  });

  it("counts a forward as failed unless n8n answered below 400", () => {
    expect(forwardFailed(route({ status: 399 }))).toBe(false);
    expect(forwardFailed(route({ status: 400 }))).toBe(true);
    expect(forwardFailed(route({ forwarded: false, status: undefined }))).toBe(false);
  });
});
