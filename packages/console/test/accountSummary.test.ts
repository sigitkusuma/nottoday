import { describe, expect, it } from "vitest";
import { accountProblems, describeAccount, summarizeActive, summarizeOverview, type AccountHead } from "../src/web/accountSummary";
import { makeBots } from "../src/web/botHealth";
import type { AccountOverview, AppConfig, RouteSummary } from "../src/web/types";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const app = (): AppConfig => ({ signingSecret: "S", routes: [{ name: "r0", on: { type: "event", events: ["message"] }, forwardTo: "https://n8n.example/webhook/x", mode: "enforce" }] });
const head = (over: Partial<AccountHead> = {}): AccountHead => ({ id: "c1", name: "Beta Labs", url: "https://gw.beta.workers.dev", active: false, statsEnabled: true, ...over });
const route = (over: Partial<RouteSummary>): RouteSummary => ({ app: "support", route: "r0", mode: "enforce", received: 0, forwarded: 0, dropped: 0, wouldDrop: 0, reasons: {}, n8nErrors: 0, ...over });
const overview = (over: Partial<AccountOverview> = {}): AccountOverview => ({
  id: "c1",
  active: false,
  accountId: "acc2",
  accountName: "Beta Labs",
  scriptName: "gw",
  url: "https://gw.beta.workers.dev",
  statsEnabled: true,
  health: { reachable: true },
  apps: { support: app() },
  missingSecrets: [],
  routes: [],
  signals: [{ app: "support", lastRequest: "2026-11-04T11:58:00Z" }],
  ...over,
});

describe("describeAccount", () => {
  it("says what is true, worst first", () => {
    expect(describeAccount({ load: "loading", bots: [] })).toEqual({ tone: "idle", line: "Checking…" });
    expect(describeAccount({ load: "error", bots: [] }).tone).toBe("bad");
    expect(describeAccount({ load: "ready", reachable: false, bots: [] })).toEqual({ tone: "bad", line: "Gateway not answering" });
    expect(describeAccount({ load: "ready", reachable: true, bots: [] })).toEqual({ tone: "idle", line: "No apps yet" });
  });
});

describe("summarizeOverview", () => {
  it("a healthy account is all good, with what it saved", () => {
    const s = summarizeOverview(head(), overview({ routes: [route({ dropped: 40 }), route({ route: "r1", dropped: 2 })] }), NOW, true);
    expect(s).toMatchObject({ load: "ready", tone: "ok", line: "1 app · all good", saved: 42 });
  });

  it("counts apps that need attention and names the reason", () => {
    const s = summarizeOverview(head(), overview({ missingSecrets: ["support"], apps: { support: app(), other: app() } }), NOW, true);
    expect(s.tone).toBe("bad");
    expect(s.line).toBe("2 apps · 1 needs attention");
    expect(s.bots[0].key).toBe("support"); // worst first
    expect(accountProblems(s)).toEqual([{ text: expect.stringContaining("Beta Labs · support:"), appKey: "support" }]);
  });

  it("an app that has never received anything needs a look, not attention", () => {
    const s = summarizeOverview(head(), overview({ signals: [] }), NOW, true);
    expect(s).toMatchObject({ tone: "warn", line: "1 app · 1 needs a look" });
    expect(accountProblems(s)).toEqual([]);
  });

  it("an unreachable gateway is a problem of the account", () => {
    const s = summarizeOverview(head(), overview({ health: { reachable: false } }), NOW, true);
    expect(s.tone).toBe("bad");
    expect(accountProblems(s)).toEqual([{ text: "Beta Labs: the gateway at https://gw.beta.workers.dev isn't answering." }]);
  });

  it("an account that couldn't be read says why", () => {
    const s = summarizeOverview(head(), overview({ error: "Cloudflare: Invalid API Token", apps: undefined }), NOW, true);
    expect(s).toMatchObject({ load: "error", tone: "bad", saved: null });
    expect(accountProblems(s)[0].text).toContain("Invalid API Token");
  });

  it("is loading until the first read, then an error if the account is missing from it", () => {
    expect(summarizeOverview(head(), undefined, NOW, false)).toMatchObject({ load: "loading", line: "Checking…" });
    expect(summarizeOverview(head(), undefined, NOW, true).load).toBe("error");
  });

  it("has no saved count when stats are off", () => {
    expect(summarizeOverview(head({ statsEnabled: false }), overview({ statsEnabled: false }), NOW, true).saved).toBeNull();
  });
});

describe("summarizeActive", () => {
  it("uses the bots the console already holds", () => {
    const bots = makeBots({ apps: { support: app() }, missingSecrets: [], routes: [route({ dropped: 5 })], signals: [{ app: "support", lastRequest: "2026-11-04T11:59:00Z" }], live: [], now: NOW });
    expect(summarizeActive(head({ active: true }), bots, true, [route({ dropped: 5 })])).toMatchObject({ active: true, tone: "ok", saved: 5, line: "1 app · all good" });
  });
});
