import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/index";
import { ENGINE_VERSION } from "../src/version";
import type { GatewayConfig } from "@gw/shared";
import { SECRET, eventBody, slackRequest, testCtx } from "./helpers";

const cfg: GatewayConfig = {
  lists: { oncall: ["UONCALL"] },
  apps: {
    demo: {
      signingSecret: "SLACK_SIGNING_SECRET_DEMO",
      routes: [
        {
          name: "mention",
          on: { type: "event", events: ["message"] },
          filters: { mentionIn: "@oncall", ignoreBots: true },
          forwardTo: "https://n8n.test/webhook/mention",
        },
        { name: "cmd", on: { type: "command", commands: ["/ask"] }, respond: "proxy", forwardTo: "https://n8n.test/webhook/cmd" },
      ],
    },
  },
};
const env = { SLACK_SIGNING_SECRET_DEMO: SECRET, GATEWAY_FORWARD_SECRET: "fwd" } as unknown as Env;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function run(req: Request) {
  const { ctx, settle } = testCtx();
  const res = await handle(req, env, ctx, { config: cfg, hash: "test" });
  await settle();
  return res;
}

describe("handler", () => {
  it("answers Slack's URL verification challenge", async () => {
    const res = await run(await slackRequest("/slack/demo", '{"type":"url_verification","challenge":"c-123"}'));
    expect(await res.json()).toEqual({ challenge: "c-123" });
  });

  it("forwards a matching event unchanged, with Slack's signature and the gateway headers", async () => {
    const body = eventBody({ type: "message", user: "U1", text: "hi <@UONCALL>", channel: "C1" });
    const req = await slackRequest("/slack/demo", body);
    const res = await run(req);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://n8n.test/webhook/mention");
    expect(init.body).toBe(body);
    expect(headers.get("x-slack-signature")).toBe(req.headers.get("x-slack-signature"));
    expect(headers.get("x-slack-request-timestamp")).toBe(req.headers.get("x-slack-request-timestamp"));
    expect(headers.get("x-slack-gateway-route")).toBe("mention");
    expect(headers.get("x-slack-gateway-secret")).toBe("fwd");
  });

  it("drops events that fail the filters, without calling n8n", async () => {
    const res = await run(await slackRequest("/slack/demo", eventBody({ type: "message", user: "U1", text: "lunch?" })));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad signature", async () => {
    const res = await run(await slackRequest("/slack/demo", eventBody({ type: "message" }), { secret: "wrong" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown apps and paths", async () => {
    expect((await run(await slackRequest("/slack/nope", "{}"))).status).toBe(404);
    expect((await run(await slackRequest("/elsewhere", "{}"))).status).toBe(404);
  });

  it("returns 500 when the app's signing secret is not set", async () => {
    const { ctx } = testCtx();
    const res = await handle(await slackRequest("/slack/demo", "{}"), {} as Env, ctx, { config: cfg, hash: "test" });
    expect(res.status).toBe(500);
  });

  it.each(["http_timeout", "timeout", "http_error", "connection_failed"])(
    "processes a Slack retry (reason %s) like a first delivery, so an event that never arrived is not lost",
    async (reason) => {
      const body = eventBody({ type: "message", user: "U1", text: "<@UONCALL>" });
      await run(await slackRequest("/slack/demo", body, { headers: { "x-slack-retry-num": "1", "x-slack-retry-reason": reason } }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain(`"retry":"1","retryReason":"${reason}"`);
    },
  );

  it("returns n8n's reply to Slack for proxy routes", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ text: "answer from n8n" }));
    const res = await run(
      await slackRequest("/slack/demo", "command=%2Fask&text=hi", { contentType: "application/x-www-form-urlencoded" }),
    );
    expect(await res.json()).toEqual({ text: "answer from n8n" });
  });

  it("retries background forwards when n8n is unavailable", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const { ctx, settle } = testCtx();
    await handle(await slackRequest("/slack/demo", eventBody({ type: "message", user: "U1", text: "<@UONCALL>" })), env, ctx, { config: cfg, hash: "test" });
    await vi.runAllTimersAsync();
    await settle();
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs Slack's URL check and unknown app names, for the console's live check", async () => {
    await run(await slackRequest("/slack/demo", JSON.stringify({ type: "url_verification", challenge: "c" })));
    await run(await slackRequest("/slack/nope", "{}"));
    const lines = [...(console.log as ReturnType<typeof vi.fn>).mock.calls, ...(console.warn as ReturnType<typeof vi.fn>).mock.calls].map((c) => String(c[0]));
    expect(lines).toContain(JSON.stringify({ message: "url_verification", app: "demo" }));
    expect(lines).toContain(JSON.stringify({ message: "unknown app", app: "nope" }));
  });

  it("serves a health check", async () => {
    const { ctx } = testCtx();
    const res = await handle(new Request("https://gateway.test/health"), env, ctx, { config: cfg, hash: "test" });
    expect(await res.json()).toEqual({ ok: true, version: ENGINE_VERSION, configHash: "test", apps: ["demo"] });
  });
});

describe("before any config is saved", () => {
  it("reports not ok on /health and refuses Slack requests with 503", async () => {
    const { ctx } = testCtx();
    const health = await handle(new Request("https://gateway.test/health"), env, ctx, null);
    expect(await health.json()).toEqual({ ok: false, version: ENGINE_VERSION, configHash: null, apps: [] });
    const res = await handle(await slackRequest("/slack/demo", "{}"), env, ctx, null);
    expect(res.status).toBe(503);
  });
});

describe("stats", () => {
  function statsEnv() {
    const points: { blobs: string[]; doubles: number[] }[] = [];
    const STATS = { writeDataPoint: (p: { blobs: string[]; doubles: number[] }) => void points.push(p) };
    return { env: { ...env, STATS } as unknown as Env, points };
  }
  const outcome = (p: { blobs: string[] }) => p.blobs[8];

  it("records one point per route decision, without message text", async () => {
    const { env: e, points } = statsEnv();
    const { ctx, settle } = testCtx();
    const forwarded = eventBody({ type: "message", user: "U1", channel: "C1", text: "<@UONCALL> secret words" });
    await handle(await slackRequest("/slack/demo", forwarded), e, ctx, { config: cfg, hash: "test" });
    await handle(await slackRequest("/slack/demo", eventBody({ type: "message", user: "U1", text: "lunch?" })), e, ctx, { config: cfg, hash: "test" });
    await settle();

    expect(points.map(outcome)).toEqual(["forwarded", "dropped"]);
    expect(points[0].blobs.slice(0, 5)).toEqual(["demo", "mention", "event", "message", "C1"]);
    expect(points[0].doubles).toEqual([200, 1]);
    expect(points[1].blobs[7]).toBe("requireMention");
    expect(JSON.stringify(points)).not.toContain("secret words");
  });

  it("records Slack's URL check, bad signatures and requests no route handles", async () => {
    const { env: e, points } = statsEnv();
    const { ctx, settle } = testCtx();
    const run = async (req: Request) => handle(req, e, ctx, { config: cfg, hash: "test" });
    await run(await slackRequest("/slack/demo", JSON.stringify({ type: "url_verification", challenge: "c" })));
    await run(await slackRequest("/slack/demo", "{}", { secret: "wrong" }));
    await run(await slackRequest("/slack/demo", eventBody({ type: "reaction_added", user: "U1" })));
    await settle();
    expect(points.map(outcome)).toEqual(["url_verification", "bad_signature", "unrouted"]);
  });
});

describe("FORWARD_DRY_RUN", () => {
  it("decides and logs but never calls n8n", async () => {
    const { ctx, settle } = testCtx();
    const dryEnv = { ...env, FORWARD_DRY_RUN: "true" } as Env;
    const res = await handle(await slackRequest("/slack/demo", eventBody({ type: "message", user: "U1", text: "<@UONCALL>" })), dryEnv, ctx, { config: cfg, hash: "test" });
    await settle();
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
