import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_KEY, type GatewayConfig } from "@gw/shared";
import { createApp } from "../src/server/app";
import { BUNDLED_ENGINE_VERSION } from "../src/server/gateway";
import { parseTailMessage } from "../src/server/tail";
import { fakeCloudflare, fakeFetch, type FakeCloudflare } from "./fakes";

const PORT = 4870;
const TOKEN = "session";
const BOT_TOKEN = "123456:AAH-real-looking-bot-token-xyz";

let cf: FakeCloudflare;
let home: string;
let app: ReturnType<typeof createApp>;
let telegramCalls: { method: string; params: Record<string, unknown> }[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "gw-apps-"));
  process.env.NOTTODAY_HOME = home;
  cf = fakeCloudflare();
  telegramCalls = [];
  const base = fakeFetch(cf, undefined, () => Response.json({ ok: true, version: BUNDLED_ENGINE_VERSION, configHash: null, apps: [] }));
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "api.telegram.org") {
      const [, bot, method] = url.pathname.split("/");
      if (bot !== `bot${BOT_TOKEN}`) return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
      telegramCalls.push({ method, params: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return Response.json({ ok: true, result: method === "getMe" ? { id: 1, username: "deploy_bot" } : true });
    }
    return base(input, init);
  }) as typeof fetch;
  app = createApp({ sessionToken: TOKEN, port: PORT, fetchImpl, loadEngine: async () => "export default {}" });
  await call("POST", "/cloudflare/token", { token: "cf-token" });
  await call("POST", "/gateway/install", { scriptName: "nottoday" });
});

afterEach(async () => {
  delete process.env.NOTTODAY_HOME;
  await rm(home, { recursive: true, force: true });
});

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { host: `127.0.0.1:${PORT}`, "x-session-token": TOKEN, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const storedConfig = (): GatewayConfig => JSON.parse([...cf.kv.values()][0].values.get(CONFIG_KEY)!) as GatewayConfig;
const secrets = () => cf.scripts.get("nottoday")!.secrets;

describe("connecting other apps", () => {
  it("adds a GitHub app with a generated secret, returned once and stored only on the Worker", async () => {
    const res = await call<{ secret: string }>("POST", "/apps", { key: "api-repo", source: "github", generate: true });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[\w-]{32}$/);
    expect(secrets().get("GITHUB_SECRET_API_REPO")).toBe(res.body.secret);
    expect(storedConfig().apps["api-repo"]).toEqual({ source: "github", signingSecret: "GITHUB_SECRET_API_REPO", routes: [] });
    expect(await readFile(join(home, "state.json"), "utf8")).not.toContain(res.body.secret);
  });

  it("adds a webhook with the secret the service gave, and its verify settings", async () => {
    const verify = { type: "hmac", header: "x-shopify-hmac-sha256", encoding: "base64" };
    const res = await call<{ secret?: string }>("POST", "/apps", { key: "shop", source: "webhook", signingSecret: "shpss_abc", verify, eventField: "header:x-shopify-topic" });
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeUndefined();
    expect(secrets().get("WEBHOOK_SECRET_SHOP")).toBe("shpss_abc");
    expect(storedConfig().apps.shop).toMatchObject({ source: "webhook", verify, eventField: "header:x-shopify-topic" });
  });

  it("refuses a webhook without a way to verify requests, and leaves no secret behind", async () => {
    const res = await call<{ errors: string[] }>("POST", "/apps", { key: "shop", source: "webhook", signingSecret: "s" });
    expect(res.status).toBe(422);
    expect(res.body.errors.join()).toContain("verify is required");
    expect(secrets().has("WEBHOOK_SECRET_SHOP")).toBe(false);
  });

  it("still checks a Slack signing secret's format", async () => {
    expect((await call("POST", "/apps", { key: "s", source: "slack", signingSecret: "xoxb-nope" })).status).toBe(400);
    expect((await call("POST", "/apps", { key: "s", signingSecret: "0123456789abcdef0123456789abcdef" })).status).toBe(200);
    expect(secrets().has("SLACK_SIGNING_SECRET_S")).toBe(true);
  });

  it("connects a Telegram bot: new secret token on the Worker, webhook pointed at the gateway, token not kept", async () => {
    await call("POST", "/apps", { key: "deploy", source: "telegram" });
    const res = await call<{ username: string; url: string }>("POST", "/apps/deploy/telegram/connect", { botToken: BOT_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("deploy_bot");
    const set = telegramCalls.find((c) => c.method === "setWebhook")!;
    expect(set.params.url).toBe("https://nottoday.acme.workers.dev/telegram/deploy");
    expect(set.params.secret_token).toBe(secrets().get("TELEGRAM_SECRET_DEPLOY"));
    expect(await readFile(join(home, "state.json"), "utf8")).not.toContain(BOT_TOKEN);
  });

  it("says plainly when Telegram rejects the bot token", async () => {
    await call("POST", "/apps", { key: "deploy", source: "telegram" });
    const res = await call<{ error: string }>("POST", "/apps/deploy/telegram/connect", { botToken: "123456:AAH-wrong-token-but-right-shape" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("didn't accept that bot token");
    expect(res.body.error).not.toContain("123456");
  });
});

describe("live feed from engine 0.3.0", () => {
  const tail = (line: object) => JSON.stringify({ eventTimestamp: 1_800_000_000_000, logs: [{ message: [JSON.stringify(line)] }] });

  it("reads requests and bad signatures from every source", () => {
    expect(parseTailMessage(tail({ message: "request", source: "github", app: "repo", type: "push", channel: "acme/api", routes: [] }))[0]).toMatchObject({
      kind: "event",
      source: "github",
      app: "repo",
      type: "push",
      channel: "acme/api",
    });
    expect(parseTailMessage(tail({ message: "bad signature", source: "telegram", app: "bot" }))[0]).toMatchObject({ kind: "bad_signature", source: "telegram" });
    expect(parseTailMessage(tail({ message: "url_verification", source: "github", app: "repo" }))[0]).toMatchObject({ kind: "verified", source: "github" });
  });
});
