import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/index";
import type { GatewayConfig } from "@gw/shared";
import { SECRET, eventBody, slackRequest, testCtx } from "./helpers";

const GH_SECRET = "gh-secret";
const TG_SECRET = "tg-secret";
const HOOK_TOKEN = "hook-token";

const cfg: GatewayConfig = {
  lists: { maintainers: ["ana"] },
  apps: {
    demo: { signingSecret: "SLACK_SIGNING_SECRET_DEMO", routes: [{ name: "all", on: { type: "event", events: ["*"] }, forwardTo: "https://n8n.test/webhook/slack" }] },
    repo: {
      source: "github",
      signingSecret: "GITHUB_SECRET_REPO",
      routes: [
        {
          name: "main-pushes",
          on: { type: "event", events: ["push"] },
          match: [{ field: "branch", op: "is", value: "main" }, { field: "sender.type", op: "isNot", value: "Bot" }],
          forwardTo: "https://n8n.test/webhook/push",
        },
      ],
    },
    bot: {
      source: "telegram",
      signingSecret: "TELEGRAM_SECRET_BOT",
      routes: [{ name: "deploy", on: { type: "event", events: ["message"] }, match: [{ field: "command", op: "is", value: "/deploy" }], forwardTo: "https://n8n.test/webhook/tg" }],
    },
    shop: {
      source: "webhook",
      signingSecret: "WEBHOOK_SECRET_SHOP",
      verify: { type: "url-token", param: "token" },
      eventField: "event",
      routes: [{ name: "paid", on: { type: "event", events: ["order.paid"] }, forwardTo: "https://n8n.test/webhook/shop" }],
    },
  },
};
const env = { SLACK_SIGNING_SECRET_DEMO: SECRET, GITHUB_SECRET_REPO: GH_SECRET, TELEGRAM_SECRET_BOT: TG_SECRET, WEBHOOK_SECRET_SHOP: HOOK_TOKEN } as unknown as Env;

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

async function githubRequest(event: string, payload: unknown, secret = GH_SECRET): Promise<Request> {
  const body = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://gateway.test/github/repo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": event, "x-github-delivery": "d-1", "x-hub-signature-256": `sha256=${mac}`, "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "1.2.3.4" },
    body,
  });
}

const logged = () => [...(console.log as ReturnType<typeof vi.fn>).mock.calls, ...(console.warn as ReturnType<typeof vi.fn>).mock.calls].map((c) => String(c[0]));

describe("GitHub app", () => {
  it("answers the ping, logs it as verified, and forwards nothing", async () => {
    const res = await run(await githubRequest("ping", { zen: "Keep it simple." }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toContain(JSON.stringify({ message: "url_verification", source: "github", app: "repo" }));
  });

  it("forwards a matching push with GitHub's headers, minus the hop headers, plus the gateway's", async () => {
    const req = await githubRequest("push", { ref: "refs/heads/main", sender: { type: "User" } });
    await run(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://n8n.test/webhook/push");
    expect(headers.get("x-github-event")).toBe("push");
    expect(headers.get("x-hub-signature-256")).toBe(req.headers.get("x-hub-signature-256"));
    expect(headers.get("x-nottoday-route")).toBe("main-pushes");
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("drops pushes to other branches and pushes by bots", async () => {
    await run(await githubRequest("push", { ref: "refs/heads/feature", sender: { type: "User" } }));
    await run(await githubRequest("push", { ref: "refs/heads/main", sender: { type: "Bot" } }));
    expect(fetchMock).not.toHaveBeenCalled();
    const lines = logged().filter((l) => l.includes('"message":"request"'));
    expect(lines[0]).toContain('"reason":"match:branch"');
    expect(lines[1]).toContain('"reason":"match:sender.type"');
  });

  it("rejects a bad signature with 401 and logs it", async () => {
    const res = await run(await githubRequest("push", { ref: "refs/heads/main" }, "wrong"));
    expect(res.status).toBe(401);
    expect(logged()).toContain(JSON.stringify({ message: "bad signature", source: "github", app: "repo" }));
  });
});

describe("URL prefixes", () => {
  it("only reaches an app under its own source's prefix", async () => {
    const body = eventBody({ type: "message", text: "hi" });
    expect((await run(await slackRequest("/github/demo", body))).status).toBe(404);
    expect((await run(await slackRequest("/slack/repo", body))).status).toBe(404);
    expect((await run(await slackRequest("/slack/demo", body))).status).toBe(200);
  });
});

describe("Telegram app", () => {
  const update = (text: string) => JSON.stringify({ update_id: 1, message: { chat: { id: 5 }, from: { id: 9 }, text } });
  const tg = (body: string, token = TG_SECRET) =>
    new Request("https://gateway.test/telegram/bot", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": token }, body });

  it("forwards the command it routes and drops other messages", async () => {
    await run(tg(update("/deploy@my_bot prod")));
    await run(tg(update("hello")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://n8n.test/webhook/tg");
  });

  it("rejects a wrong secret token", async () => {
    expect((await run(tg(update("/deploy"), "nope"))).status).toBe(401);
  });
});

describe("any webhook app", () => {
  const hook = (token: string, event: string) =>
    new Request(`https://gateway.test/hook/shop?token=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) });

  it("checks the URL token and routes on the event field", async () => {
    expect((await run(hook("nope", "order.paid"))).status).toBe(401);
    await run(hook(HOOK_TOKEN, "order.paid"));
    await run(hook(HOOK_TOKEN, "order.created"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://n8n.test/webhook/shop");
  });
});

describe("Slack forwarding", () => {
  it("keeps the old headers and adds the x-nottoday-* names", async () => {
    await run(await slackRequest("/slack/demo", eventBody({ type: "message", text: "hi" })));
    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get("x-slack-gateway-route")).toBe("all");
    expect(headers.get("x-nottoday-route")).toBe("all");
  });
});
