import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { TailHub, parseTailMessage, type LiveEvent, type LiveStatus } from "../src/server/tail";
import { BOT_EVENTS, botHandle, buildManifest, createAppUrl } from "../src/web/manifest";
import { FakeTailSocket, fakeCloudflare, fakeFetch, tailMessage, type FakeCloudflare } from "./fakes";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("parseTailMessage", () => {
  it("turns the engine's log lines into live events", () => {
    const events = parseTailMessage(
      JSON.stringify(
        tailMessage(
          { message: "url_verification", app: "support" },
          { message: "slack_request", app: "support", kind: "event", type: "message", channel: "C1", routes: [{ route: "r", mode: "enforce", filter: "pass", forwarded: true, status: 200 }] },
        ),
      ),
    );
    expect(events.map((e) => e.kind)).toEqual(["verified", "event"]);
    expect(events[1]).toMatchObject({ app: "support", type: "message", channel: "C1", time: "2026-11-02T08:00:00.000Z" });
  });

  it("recognises rejections and Worker errors, and ignores other output", () => {
    const msg = tailMessage({ message: "bad slack signature", app: "a" }, { message: "unknown app", app: "b" }, { message: "missing signing secret", app: "c" }, { other: 1 });
    const events = parseTailMessage(JSON.stringify({ ...msg, exceptions: [{ name: "TypeError", message: "boom" }] }));
    expect(events.map((e) => e.kind)).toEqual(["bad_signature", "unknown_app", "missing_secret", "error"]);
    expect(parseTailMessage("not json")).toEqual([]);
  });
});

describe("TailHub", () => {
  it("opens one session for all viewers and closes it when the last one leaves", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const hub = new TailHub(
      { open: async () => (opened.push("t1"), { id: "t1", url: "wss://tail.test/t1", expiresAt: new Date(Date.now() + 3600_000).toISOString() }), close: async (id) => void closed.push(id) },
      FakeTailSocket as unknown as typeof WebSocket,
    );
    const seenA: LiveEvent[] = [];
    const statuses: LiveStatus[] = [];
    const offA = hub.subscribe((e) => seenA.push(e), (s) => statuses.push(s));
    const offB = hub.subscribe(() => {}, () => {});
    await tick();
    await tick();
    expect(opened).toEqual(["t1"]);
    expect(statuses.at(-1)).toEqual({ state: "live" });
    expect(FakeTailSocket.last!.protocol).toBe("trace-v1");

    FakeTailSocket.last!.emit(tailMessage({ message: "url_verification", app: "x" }));
    expect(seenA.map((e) => e.kind)).toEqual(["verified"]);

    offA();
    expect(closed).toEqual([]);
    offB();
    await tick();
    expect(closed).toEqual(["t1"]);
    expect(FakeTailSocket.last!.closed).toBe(true);
  });

  it("reports unavailable when Cloudflare refuses the session", async () => {
    const hub = new TailHub({ open: async () => Promise.reject(new Error("Authentication error")), close: async () => {} }, FakeTailSocket as unknown as typeof WebSocket);
    const statuses: LiveStatus[] = [];
    hub.subscribe(() => {}, (s) => statuses.push(s));
    await tick();
    expect(statuses.at(-1)).toMatchObject({ state: "unavailable", message: expect.stringContaining("Authentication error") });
  });
});

describe("GET /api/live/stream", () => {
  const PORT = 4870;
  let home: string;
  let cf: FakeCloudflare;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "gw-live-"));
    process.env.NOTTODAY_HOME = home;
    cf = fakeCloudflare();
    app = createApp({
      sessionToken: "s",
      port: PORT,
      fetchImpl: fakeFetch(cf, undefined, () => Response.json({ ok: true, version: "0.2.0", configHash: null, apps: [] })),
      loadEngine: async () => "export default {}",
      WebSocketImpl: FakeTailSocket as unknown as typeof WebSocket,
    });
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api${path}`, { method, headers: { host: `127.0.0.1:${PORT}`, "x-session-token": "s", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    await call("POST", "/gateway/install", { scriptName: "slack-gateway" });
  });

  afterEach(async () => {
    delete process.env.NOTTODAY_HOME;
    await rm(home, { recursive: true, force: true });
  });

  async function readUntil(res: Response, needle: string): Promise<string> {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    for (let i = 0; i < 50 && !text.includes(needle); i++) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
    }
    await reader.cancel();
    return text;
  }

  const open = () => app.request("/api/live/stream", { headers: { host: `127.0.0.1:${PORT}`, "x-session-token": "s" } });

  it("streams the gateway's decisions as Server-Sent Events, without exposing the tail URL", async () => {
    const res = await open();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => FakeTailSocket.last?.emit(tailMessage({ message: "url_verification", app: "support" })), 20);
    const text = await readUntil(res, "event: decision");
    expect(text).toContain('event: status\ndata: {"state":"live"}');
    expect(text).toContain('"kind":"verified"');
    expect(text).not.toContain("wss://");
    // One session was opened for the viewer, and closed again when the viewer left.
    expect(FakeTailSocket.last!.url).toBe("wss://tail.test/tail1");
    await tick();
    expect(cf.tails.size).toBe(0);
  });

  it("says real time is unavailable when Cloudflare refuses a tail", async () => {
    cf.tailsForbidden = true;
    const text = await readUntil(await open(), '"unavailable"');
    expect(text).toContain('"state":"unavailable"');
  });
});

describe("Slack app manifest", () => {
  it("points Slack at the gateway, with Socket Mode off and the events the routes use", () => {
    const m = buildManifest("Support Alerts", "https://gw.example.workers.dev/slack/support-alerts");
    expect(m.settings.socket_mode_enabled).toBe(false);
    expect(m.settings.event_subscriptions).toEqual({ request_url: "https://gw.example.workers.dev/slack/support-alerts", bot_events: BOT_EVENTS });
    expect(m.features.bot_user.display_name).toBe("support-alerts");
    const url = new URL(createAppUrl(m));
    expect(url.origin + url.pathname).toBe("https://api.slack.com/apps");
    expect(JSON.parse(url.searchParams.get("manifest_json")!)).toEqual(m);
  });

  it("keeps names within Slack's limits", () => {
    expect(buildManifest("x".repeat(50), "https://x.test").display_information.name).toHaveLength(35);
    expect(botHandle("Ops Bot (EU)!")).toBe("ops-bot-eu");
    expect(botHandle("!!!")).toBe("gateway-bot");
  });
});
