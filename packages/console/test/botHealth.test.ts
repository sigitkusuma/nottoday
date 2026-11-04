import { describe, expect, it } from "vitest";
import { botStatus, botTotals, decisionTone, eventTone, pulse } from "../src/web/botHealth";
import type { AppConfig, RouteSummary } from "../src/web/types";
import type { LiveEvent } from "../src/web/useLive";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const app = (routes = 1): AppConfig => ({
  signingSecret: "S",
  routes: Array.from({ length: routes }, (_, i) => ({ name: `r${i}`, on: { type: "event", events: ["message"] }, forwardTo: "https://n8n.example/webhook/x", mode: "enforce" })),
});
const base = { key: "support", app: app(), missingSecret: false, routes: [] as RouteSummary[], live: [] as LiveEvent[], now: NOW };
const ev = (over: Partial<LiveEvent>): LiveEvent => ({ time: new Date(NOW - 60_000).toISOString(), kind: "event", app: "support", ...over });
const summary = (over: Partial<RouteSummary>): RouteSummary => ({ app: "support", route: "r0", mode: "enforce", received: 0, forwarded: 0, dropped: 0, wouldDrop: 0, reasons: {}, n8nErrors: 0, ...over });

describe("botStatus", () => {
  it("puts a missing secret first", () => {
    expect(botStatus({ ...base, missingSecret: true }).health).toBe("no-secret");
  });

  it("flags a wrong secret only while nothing good has arrived since", () => {
    const bad = { lastBadSignature: "2026-11-02T11:00:00Z" };
    expect(botStatus({ ...base, signal: { app: "support", ...bad } }).health).toBe("bad-secret");
    expect(botStatus({ ...base, signal: { app: "support", ...bad, lastRequest: "2026-11-02T11:30:00Z" } }).health).not.toBe("bad-secret");
  });

  it("uses live events too, which are fresher than stats", () => {
    const live = [ev({ kind: "bad_signature", time: new Date(NOW - 5_000).toISOString() })];
    expect(botStatus({ ...base, live }).health).toBe("bad-secret");
  });

  it("reports n8n errors, then no routes, then receiving / quiet / waiting", () => {
    expect(botStatus({ ...base, routes: [summary({ n8nErrors: 3 })] }).health).toBe("n8n-errors");
    expect(botStatus({ ...base, app: app(0) }).health).toBe("no-routes");
    expect(botStatus({ ...base, live: [ev({})] }).health).toBe("receiving");
    expect(botStatus({ ...base, signal: { app: "support", lastRequest: "2026-11-02T08:00:00Z" } }).health).toBe("quiet");
    expect(botStatus(base).health).toBe("waiting");
  });

  it("names the status code and what it usually means", () => {
    const st = botStatus({ ...base, routes: [summary({ n8nErrors: 3, errorStatuses: { "405": 3 } })] });
    expect(st.detail).toContain("r0");
    expect(st.detail).toContain("HTTP 405 (3×)");
    expect(st.detail).toContain("Production URL");
  });

  it("ignores errors from routes that are now turned off or removed", () => {
    const off: AppConfig = { ...app(), routes: [{ ...app().routes[0], enabled: false }] };
    expect(botStatus({ ...base, app: off, routes: [summary({ n8nErrors: 3 })] }).health).not.toBe("n8n-errors");
    expect(botStatus({ ...base, routes: [summary({ route: "deleted", n8nErrors: 3 })] }).health).not.toBe("n8n-errors");
  });

  it("ignores other bots' live events", () => {
    expect(botStatus({ ...base, live: [ev({ app: "other" })] }).health).toBe("waiting");
  });
});

describe("pulse", () => {
  it("shows one dot per event for this bot, newest first, capped", () => {
    const live = [
      ev({ routes: [{ route: "r0", mode: "enforce", filter: "pass", forwarded: true, status: 200 }] }),
      ev({ app: "other" }),
      ev({ routes: [{ route: "r0", mode: "enforce", filter: "fail", reason: "ignoreBots", forwarded: false }] }),
      ev({ routes: [{ route: "r0", mode: "shadow", filter: "fail", reason: "ignoreBots", forwarded: true, status: 200 }] }),
      ev({ kind: "bad_signature" }),
    ];
    expect(pulse(live, "support").map((p) => p.tone)).toEqual(["sent", "saved", "shadow", "bad"]);
    expect(pulse(live, "support", 2)).toHaveLength(2);
  });
});

describe("botTotals", () => {
  it("adds up one bot's routes and counts would-save only for shadow routes", () => {
    const rows = [summary({ route: "a", received: 10, forwarded: 4, dropped: 6 }), summary({ route: "b", received: 5, forwarded: 5, wouldDrop: 2 }), summary({ app: "other", received: 99 })];
    const t = botTotals(rows, "support", (r) => (r === "b" ? "shadow" : "enforce"));
    expect(t).toEqual({ received: 15, forwarded: 9, saved: 6, wouldSave: 2 });
  });
});

describe("eventTone: each outcome has its own tone, so the activity list can be read at a glance", () => {
  const route = (over: object) => ({ route: "r0", mode: "enforce", filter: "pass", forwarded: true, status: 200, ...over });
  const tone = (over: Partial<LiveEvent>) => eventTone(ev(over)).tone;

  it("tells apart sent, dropped by a filter, shadow, not routed, n8n error and rejected", () => {
    expect(tone({ routes: [route({})] })).toBe("sent");
    expect(tone({ routes: [route({ forwarded: false, status: undefined, filter: "fail", reason: "ignoreBots" })] })).toBe("saved");
    expect(tone({ routes: [route({ mode: "shadow", filter: "fail", reason: "ignoreBots" })] })).toBe("shadow");
    expect(tone({ routes: [] })).toBe("unrouted");
    expect(tone({ routes: undefined })).toBe("unrouted");
    expect(tone({ routes: [route({ status: 404 })] })).toBe("error");
    expect(tone({ routes: [route({ status: undefined })] })).toBe("error");
    expect(tone({ kind: "bad_signature" })).toBe("bad");
    expect(tone({ kind: "verified" })).toBe("info");
  });

  it("an n8n error outranks the rest, and one failing route is enough", () => {
    expect(tone({ routes: [route({}), route({ route: "r1", status: 500 })] })).toBe("error");
  });

  it("stats rows get the same tones", () => {
    const d = (over: object) => decisionTone({ outcome: "forwarded", mode: "enforce", filter: "pass", status: 200, ...over }).tone;
    expect(d({})).toBe("sent");
    expect(d({ outcome: "dropped", status: 0 })).toBe("saved");
    expect(d({ outcome: "unrouted", status: 0 })).toBe("unrouted");
    expect(d({ mode: "shadow", filter: "fail" })).toBe("shadow");
    expect(d({ status: 502 })).toBe("error");
    expect(d({ outcome: "bad_signature", status: 0 })).toBe("bad");
    expect(d({ outcome: "url_verification", status: 0 })).toBe("info");
  });
});
