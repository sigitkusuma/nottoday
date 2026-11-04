import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLOUDFLARE_TOKEN_PERMISSIONS, CONFIG_KEY, type GatewayConfig } from "@gw/shared";
import { createApp } from "../src/server/app";
import { createTokenUrl } from "../src/server/cloudflare";
import { BUNDLED_ENGINE_VERSION } from "../src/server/gateway";
import { stateDir } from "../src/server/store";
import { fakeCloudflare, fakeFetch, fakeN8n, type FakeCloudflare, type FakeN8n } from "./fakes";

const PORT = 4870;
const TOKEN = "session";
const SECRET = "0123456789abcdef0123456789abcdef";

let cf: FakeCloudflare;
let n8n: FakeN8n;
let home: string;
let engineVersion: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "gw-console-"));
  process.env.NOTTODAY_HOME = home;
  cf = fakeCloudflare();
  n8n = fakeN8n();
  engineVersion = BUNDLED_ENGINE_VERSION;
  const health = () => Response.json({ ok: true, version: engineVersion, configHash: null, apps: [] });
  app = createApp({ sessionToken: TOKEN, port: PORT, fetchImpl: fakeFetch(cf, n8n, health), loadEngine: async () => "export default {}" });
});

afterEach(async () => {
  delete process.env.NOTTODAY_HOME;
  await rm(home, { recursive: true, force: true });
});

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, opts: { host?: string; token?: string } = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      host: opts.host ?? `127.0.0.1:${PORT}`,
      "x-session-token": opts.token ?? TOKEN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function connectAndInstall() {
  await call("POST", "/cloudflare/token", { token: "cf-token" });
  return call<{ gateway: { url: string; kvNamespaceId: string } }>("POST", "/gateway/install", { scriptName: "slack-gateway" });
}

const storedConfig = (): GatewayConfig => {
  const ns = [...cf.kv.values()][0];
  return JSON.parse(ns.values.get(CONFIG_KEY)!) as GatewayConfig;
};

describe("access control", () => {
  it("refuses API calls without the session token", async () => {
    expect((await call("GET", "/status", undefined, { token: "wrong" })).status).toBe(401);
  });

  it("refuses requests for another host name (DNS rebinding)", async () => {
    expect((await call("GET", "/status", undefined, { host: "evil.example:4870" })).status).toBe(403);
  });
});

describe("connecting Cloudflare", () => {
  it("offers a token link with exactly the permissions the guide lists", () => {
    const url = new URL(createTokenUrl("slack-gateway"));
    const keys = JSON.parse(url.searchParams.get("permissionGroupKeys")!);
    expect(keys).toContainEqual({ key: "workers_scripts", type: "edit" });
    expect(keys).toEqual(CLOUDFLARE_TOKEN_PERMISSIONS.map(({ key, type }) => ({ key, type })));
  });

  it("rejects a token Cloudflare doesn't accept", async () => {
    const res = await call("POST", "/cloudflare/token", { token: "nope" });
    expect(res.status).toBe(400);
  });

  it("stores the token only readable by the user, and picks the only account", async () => {
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    expect((await stat(join(stateDir(), "state.json"))).mode & 0o777).toBe(0o600);
    expect((await call<{ cloudflare: { accountName: string } }>("GET", "/status")).body.cloudflare.accountName).toBe("Acme");
  });
});

describe("installing the gateway", () => {
  it("creates KV, uploads the engine with bindings, enables workers.dev and seeds an empty config", async () => {
    const res = await connectAndInstall();
    expect(res.body.gateway.url).toBe("https://slack-gateway.acme.workers.dev");

    const script = cf.scripts.get("slack-gateway")!;
    expect(script.workersDev).toBe(true);
    expect(script.metadata.bindings).toEqual([
      { type: "kv_namespace", name: "CONFIG", namespace_id: res.body.gateway.kvNamespaceId },
      { type: "analytics_engine", name: "STATS", dataset: "slack_gateway_decisions" },
    ]);
    expect(storedConfig()).toEqual({ lists: {}, apps: {} });
  });

  it("explains a missing workers.dev address and creates nothing until it exists", async () => {
    cf.noSubdomain = true;
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    const res = await call<{ error: string }>("POST", "/gateway/install", { scriptName: "slack-gateway" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Workers & Pages");
    expect(cf.kv.size).toBe(0);
    expect(cf.scripts.size).toBe(0);
    cf.noSubdomain = false;
    expect((await call("POST", "/gateway/install", { scriptName: "slack-gateway" })).status).toBe(200);
  });

  it("keeps signing secrets and config when installed again or upgraded", async () => {
    await connectAndInstall();
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    await connectAndInstall();
    await call("POST", "/gateway/upgrade");
    expect(cf.scripts.get("slack-gateway")!.secrets.get("SLACK_SIGNING_SECRET_SUPPORT")).toBe(SECRET);
    expect(Object.keys(storedConfig().apps)).toEqual(["support"]);
    expect(cf.kv.size).toBe(1);
  });

  it("installs without stats when Analytics Engine is off, and turns them on later", async () => {
    cf.analyticsOff = true;
    const res = await connectAndInstall();
    expect(res.status).toBe(200);
    expect(cf.scripts.get("slack-gateway")!.metadata.bindings).toEqual([{ type: "kv_namespace", name: "CONFIG", namespace_id: res.body.gateway.kvNamespaceId }]);
    const status = await call<{ gateway: { statsEnabled: boolean; analyticsEngineUrl: string } }>("GET", "/status");
    expect(status.body.gateway).toMatchObject({ statsEnabled: false, analyticsEngineUrl: "https://dash.cloudflare.com/acc1/workers/analytics-engine" });
    expect((await call("GET", "/stats/summary?days=1")).status).toBe(409);

    cf.analyticsOff = false;
    expect((await call<{ statsEnabled: boolean }>("POST", "/gateway/upgrade")).body.statsEnabled).toBe(true);
    expect((await call<{ gateway: { statsEnabled: boolean } }>("GET", "/status")).body.gateway.statsEnabled).toBe(true);
  });

  it("offers an upgrade when the running engine is older", async () => {
    await connectAndInstall();
    engineVersion = "0.0.1";
    const status = await call<{ gateway: { upgradeAvailable: boolean } }>("GET", "/status");
    expect(status.body.gateway.upgradeAvailable).toBe(true);
  });
});

describe("Slack apps", () => {
  beforeEach(connectAndInstall);

  it("stores the signing secret as a Worker secret, never in KV", async () => {
    expect((await call("POST", "/apps", { key: "support", signingSecret: SECRET })).status).toBe(200);
    expect(cf.scripts.get("slack-gateway")!.secrets.get("SLACK_SIGNING_SECRET_SUPPORT")).toBe(SECRET);
    expect(storedConfig().apps.support).toEqual({ source: "slack", signingSecret: "SLACK_SIGNING_SECRET_SUPPORT", routes: [] });
    expect(JSON.stringify([...[...cf.kv.values()][0].values.values()])).not.toContain(SECRET);
  });

  it("rejects something that isn't a signing secret, with a hint", async () => {
    const res = await call<{ error: string }>("POST", "/apps", { key: "support", signingSecret: "xoxb-123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Client Secret");
  });

  it("removes the app and its secret", async () => {
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    await call("DELETE", "/apps/support");
    expect(storedConfig().apps).toEqual({});
    expect(cf.scripts.get("slack-gateway")!.secrets.size).toBe(0);
  });
});

describe("saving config", () => {
  beforeEach(connectAndInstall);

  const route = { name: "mention", mode: "shadow", on: { type: "event", events: ["message"] }, forwardTo: "https://n8n.test/webhook/x" };

  it("saves a valid config and keeps the previous one for rollback", async () => {
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    const { body } = await call<{ config: GatewayConfig; hash: string }>("GET", "/config");
    const next = structuredClone(body.config);
    next.apps.support.routes.push(route as never);
    expect((await call("PUT", "/config", { config: next, baseHash: body.hash })).status).toBe(200);
    expect(storedConfig().apps.support.routes).toHaveLength(1);

    const history = await call<{ versions: { key: string }[] }>("GET", "/config/history");
    expect(history.body.versions.length).toBe(2);
    await call("POST", "/config/rollback", { key: history.body.versions[0].key });
    expect(storedConfig().apps.support.routes).toHaveLength(0);
  });

  it("refuses an invalid config with the reasons", async () => {
    const { body } = await call<{ config: GatewayConfig; hash: string }>("GET", "/config");
    const bad = { ...body.config, apps: { support: { signingSecret: "S", routes: [{ ...route, forwardTo: "http://insecure" }] } } };
    const res = await call<{ errors: string[] }>("PUT", "/config", { config: bad, baseHash: body.hash });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([expect.stringContaining("forwardTo must be https")]);
  });

  it("refuses to overwrite a change made elsewhere", async () => {
    const { body } = await call<{ config: GatewayConfig; hash: string }>("GET", "/config");
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    const res = await call("PUT", "/config", { config: body.config, baseHash: body.hash });
    expect(res.status).toBe(409);
    expect(Object.keys(storedConfig().apps)).toEqual(["support"]);
  });
});

describe("stats", () => {
  beforeEach(connectAndInstall);

  it("summarises forwarded, dropped and would-drop per route", async () => {
    cf.sqlRows = [
      { app: "support", route: "mention", mode: "shadow", filter: "pass", reason: "", outcome: "forwarded", status: 200, n: 3 },
      { app: "support", route: "mention", mode: "shadow", filter: "fail", reason: "requireMention", outcome: "forwarded", status: 200, n: 40 },
      { app: "support", route: "mention", mode: "shadow", filter: "fail", reason: "mentionIn", outcome: "forwarded", status: 500, n: 7 },
    ];
    const res = await call<{ routes: { received: number; wouldDrop: number; reasons: Record<string, number>; n8nErrors: number }[] }>("GET", "/stats/summary?days=1");
    expect(res.body.routes[0]).toMatchObject({ received: 50, wouldDrop: 47, reasons: { requireMention: 40, mentionIn: 7 }, n8nErrors: 7 });
    expect(Object.values((res.body.routes[0] as unknown as { errorStatuses: Record<string, number> }).errorStatuses).reduce((a, b) => a + b, 0)).toBe(7);
    expect(cf.sqlQueries[0]).toContain("FROM slack_gateway_decisions");
  });

  it("orders recent decisions by the time alias (Cloudflare rejects ORDER BY timestamp there)", async () => {
    cf.sqlRows = [{ time: "2026-11-02 06:57:25", app: "support", route: "mention", kind: "event", type: "message", channel: "C1", mode: "enforce", filter: "pass", reason: "", outcome: "forwarded", status: 200 }];
    await call("GET", "/stats/recent");
    expect(cf.sqlQueries.at(-1)).toContain("ORDER BY time DESC");
    expect(cf.sqlQueries.at(-1)).not.toContain("ORDER BY timestamp");
  });

  it("rejects unexpected ranges", async () => {
    expect((await call("GET", "/stats/summary?days=1;DROP")).status).toBe(400);
  });
});

describe("n8n", () => {
  beforeEach(async () => {
    await connectAndInstall();
    n8n.workflows = [
      {
        id: "w1",
        name: "Support triage",
        active: true,
        nodes: [
          { name: "Slack Trigger", type: "n8n-nodes-base.slackTrigger", webhookId: "abc", parameters: { trigger: ["message", "app_mention"] } },
          { name: "Approve button", type: "n8n-nodes-base.webhook", parameters: { path: "approve" } },
          { name: "Old", type: "n8n-nodes-base.slackTrigger", webhookId: "old", disabled: true },
        ],
      },
      { id: "w2", name: "Report", active: true, nodes: [{ name: "Every day", type: "n8n-nodes-base.scheduleTrigger" }] },
    ];
    n8n.executions = [...Array(300).fill({ workflowId: "w1" }), ...Array(20).fill({ workflowId: "w2" })];
    n8n.tables = [{ id: "t1", name: "On call", columns: [{ name: "userId" }], rows: [{ userId: "U1" }, { userId: "U2" }, { userId: "" }] }];
  });

  it("rejects a wrong API key", async () => {
    expect((await call("POST", "/n8n", { baseUrl: "https://n8n.test", apiKey: "bad" })).status).toBe(502);
  });

  it("ranks workflows by executions and lists their trigger URLs", async () => {
    await call("POST", "/n8n", { baseUrl: "https://n8n.test/api/v1/", apiKey: "n8n-key" });
    const res = await call<{ total: number; workflows: { workflowId: string; executions: number; triggers: { url: string; suggestedEvents?: string[] }[] }[] }>("GET", "/n8n/usage?days=30");
    expect(res.body.total).toBe(320);
    expect(res.body.workflows[0]).toMatchObject({ workflowId: "w1", executions: 300 });
    expect(res.body.workflows[0].triggers.map((t) => t.url)).toEqual(["https://n8n.test/webhook/abc/webhook", "https://n8n.test/webhook/approve"]);
    expect(res.body.workflows[0].triggers[0].suggestedEvents).toEqual(["message", "app_mention"]);
  });

  it("syncs a list from a data table column and remembers the source", async () => {
    await call("POST", "/n8n", { baseUrl: "https://n8n.test", apiKey: "n8n-key" });
    const res = await call<{ values: string[]; added: string[] }>("POST", "/lists/oncall/sync", { tableId: "t1", tableName: "On call", column: "userId" });
    expect(res.body.values).toEqual(["U1", "U2"]);
    expect(storedConfig().lists.oncall).toEqual(["U1", "U2"]);
    expect(storedConfig().listSources?.oncall).toMatchObject({ tableId: "t1", column: "userId" });
  });
});

describe("events no route uses", () => {
  it("counts unrouted events per app and type from the gateway's own stats", async () => {
    await connectAndInstall();
    cf.sqlRows = [{ app: "support", type: "message", n: "4210.5", last: "2026-11-04 07:55:00" }];
    const res = await call<{ rows: { app: string; type: string; count: number; last: string }[] }>("GET", "/stats/unrouted?days=1");
    expect(res.body.rows).toEqual([{ app: "support", type: "message", count: 4210.5, last: "2026-11-04 07:55:00" }]);
    const q = cf.sqlQueries.at(-1)!;
    expect(q).toContain("FROM slack_gateway_decisions");
    expect(q).toContain("'unrouted'");
    expect(q).toContain("INTERVAL '1' DAY");
    expect((await call("GET", "/stats/unrouted?days=3")).status).toBe(400);
  });

  it("recent decisions take a row limit, for filling the activity feed after a reload", async () => {
    await connectAndInstall();
    cf.sqlRows = [];
    await call("GET", "/stats/recent?limit=300");
    expect(cf.sqlQueries.at(-1)).toContain("LIMIT 300");
    await call("GET", "/stats/recent");
    expect(cf.sqlQueries.at(-1)).toContain("LIMIT 50");
    expect((await call("GET", "/stats/recent?limit=9999")).status).toBe(400);
  });
});

describe("reconnecting to a gateway that's already in the account", () => {
  type Existing = { gateways: { scriptName: string; apps: number; routes: number; url?: string }[] };
  const existing = async () => (await call<Existing>("GET", "/gateway/existing")).body.gateways;

  it("finds nothing in a fresh account", async () => {
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    expect(await existing()).toEqual([]);
  });

  it("a new machine finds the gateway, and installing again under its name keeps the apps and secrets", async () => {
    await connectAndInstall();
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    const config = storedConfig();
    config.apps.support.routes = [{ name: "r", on: { type: "event", events: ["message"] }, forwardTo: "https://n8n.test/webhook/x", mode: "enforce" }];
    cf.kv.get([...cf.kv.keys()][0])!.values.set(CONFIG_KEY, JSON.stringify(config));

    // The machine is lost: its saved token and gateway link are gone. Cloudflare still has everything.
    await call("DELETE", "/connections/" + (await call<{ connections: { id: string }[] }>("GET", "/connections")).body.connections[0].id);
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    expect((await call<{ gateway: unknown }>("GET", "/status")).body.gateway).toBeNull();

    expect(await existing()).toEqual([{ scriptName: "slack-gateway", apps: 1, routes: 1, url: "https://slack-gateway.acme.workers.dev" }]);

    await call("POST", "/gateway/install", { scriptName: "slack-gateway" });
    expect(cf.kv.size).toBe(1); // reused, not a second namespace
    expect(Object.keys(storedConfig().apps)).toEqual(["support"]);
    expect([...cf.scripts.get("slack-gateway")!.secrets.keys()]).toEqual(["SLACK_SIGNING_SECRET_SUPPORT"]);
    const status = await call<{ gateway: { url: string } }>("GET", "/status");
    expect(status.body.gateway.url).toBe("https://slack-gateway.acme.workers.dev");
  });

  it("ignores stores that aren't a gateway's: no Worker next to it, or no config in it", async () => {
    await connectAndInstall();
    cf.kv.set("ns-orphan", { title: "orphan-config", values: new Map([[CONFIG_KEY, JSON.stringify({ apps: {} })]]) }); // no Worker named "orphan"
    cf.scripts.set("other", { metadata: {}, code: "", workersDev: true, secrets: new Map() });
    cf.kv.set("ns-other", { title: "other-config", values: new Map([["something-else", "{}"]]) }); // a Worker, but not ours
    expect((await existing()).map((g) => g.scriptName)).toEqual(["slack-gateway"]);
  });
});

describe("saved Cloudflare accounts", () => {
  type Summary = { id: string; accountId: string | null; accountName: string | null; gatewayUrl: string | null; active: boolean; pending: boolean };
  const connections = async () => (await call<{ connections: Summary[] }>("GET", "/connections")).body.connections;

  beforeEach(() => {
    cf.otherTokens = { "cf-token-b": [{ id: "acc2", name: "Beta" }], "cf-token-multi": [{ id: "acc3", name: "Three" }, { id: "acc4", name: "Four" }], "cf-token-a2": [{ id: "acc1", name: "Acme" }] };
  });

  it("adds a second account without losing the first or its gateway", async () => {
    await connectAndInstall();
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });

    const list = await connections();
    expect(list.map((c) => [c.accountName, c.active, Boolean(c.gatewayUrl)])).toEqual([
      ["Acme", false, true],
      ["Beta", true, false],
    ]);
    // The active connection has no gateway yet, so the console shows setup for it.
    const status = await call<{ cloudflare: { accountName: string }; gateway: unknown; connections: Summary[] }>("GET", "/status");
    expect(status.body.cloudflare.accountName).toBe("Beta");
    expect(status.body.gateway).toBeNull();
    expect(status.body.connections).toHaveLength(2);
  });

  it("overview reads the other accounts' gateways without switching to them", async () => {
    await connectAndInstall();
    const [acme] = await connections();
    await call("POST", "/apps", { key: "support", signingSecret: SECRET });
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    await call("POST", "/gateway/install", { scriptName: "beta-gateway" });

    type Overview = { accounts: { accountName: string; active: boolean; url: string; apps?: Record<string, unknown>; missingSecrets?: string[]; health?: { reachable: boolean }; error?: string }[] };
    const all = (await call<Overview>("GET", "/overview")).body.accounts;
    expect(all.map((a) => [a.accountName, a.active])).toEqual([["Acme", false], ["Beta", true]]);

    const others = (await call<Overview>("GET", "/overview?others=1")).body.accounts;
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({ accountName: "Acme", url: "https://slack-gateway.acme.workers.dev", missingSecrets: [], health: { reachable: true } });
    expect(Object.keys(others[0].apps!)).toEqual(["support"]);
    // Reading Acme didn't make it the active account.
    expect((await connections()).find((c) => c.id === acme.id)!.active).toBe(false);
  });

  it("overview reports an account it can't read instead of failing the whole request", async () => {
    await connectAndInstall();
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    await call("POST", "/gateway/install", { scriptName: "beta-gateway" });
    cf.token = "revoked-in-cloudflare"; // Acme's saved token no longer works; Beta's still does.
    const res = await call<{ accounts: { accountName: string; error?: string; apps?: unknown }[] }>("GET", "/overview?others=1");
    expect(res.status).toBe(200);
    expect(res.body.accounts[0]).toMatchObject({ accountName: "Acme" });
    expect(res.body.accounts[0].error).toMatch(/Invalid API Token/);
    expect(res.body.accounts[0].apps).toBeUndefined();
  });

  it("switches between accounts and each keeps its own gateway", async () => {
    await connectAndInstall();
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    const [acme] = await connections();
    await call("POST", `/connections/${acme.id}/activate`);
    const status = await call<{ cloudflare: { accountName: string }; gateway: { url: string } }>("GET", "/status");
    expect(status.body.cloudflare.accountName).toBe("Acme");
    expect(status.body.gateway.url).toBe("https://slack-gateway.acme.workers.dev");
    expect((await call("POST", "/connections/nope/activate")).status).toBe(404);
  });

  it("refreshes a saved account when its token is pasted again, instead of duplicating it", async () => {
    await connectAndInstall();
    const again = await call<{ refreshed: boolean }>("POST", "/cloudflare/token", { token: "cf-token-a2" });
    expect(again.body.refreshed).toBe(true);
    const list = await connections();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ accountName: "Acme", active: true });
    expect(list[0].gatewayUrl).toBe("https://slack-gateway.acme.workers.dev");
  });

  it("asks which account when a token sees several, and drops an abandoned attempt", async () => {
    await call("POST", "/cloudflare/token", { token: "cf-token-multi" });
    expect((await connections())[0]).toMatchObject({ pending: true, accountName: null });
    await call("POST", "/cloudflare/token", { token: "cf-token-multi" });
    expect(await connections()).toHaveLength(1);
    await call("POST", "/cloudflare/account", { accountId: "acc4" });
    expect((await connections())[0]).toMatchObject({ pending: false, accountName: "Four" });
  });

  it("forgets one account and falls back to another", async () => {
    await connectAndInstall();
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    const [acme, beta] = await connections();
    await call("DELETE", `/connections/${beta.id}`);
    expect((await connections()).map((c) => [c.id, c.active])).toEqual([[acme.id, true]]);
    await call("DELETE", `/connections/${acme.id}`);
    expect(await connections()).toEqual([]);
    expect((await call<{ cloudflare: unknown }>("GET", "/status")).body.cloudflare).toBeNull();
  });

  it("keeps the n8n connection when switching accounts", async () => {
    await connectAndInstall();
    await call("POST", "/n8n", { baseUrl: "https://n8n.test", apiKey: "n8n-key" });
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    expect((await call<{ n8n: { baseUrl: string } }>("GET", "/status")).body.n8n.baseUrl).toBe("https://n8n.test");
  });

  it("reads the single-account state file of earlier versions", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "state.json"),
      JSON.stringify({ cloudflare: { token: "cf-token", accountId: "acc1", accountName: "Acme" }, gateway: { scriptName: "old", kvNamespaceId: "ns9", dataset: "old_decisions", url: "https://old.acme.workers.dev" }, n8n: { baseUrl: "https://n8n.test", apiKey: "n8n-key" } }),
    );
    const status = await call<{ cloudflare: { accountName: string }; gateway: { url: string }; n8n: unknown; connections: Summary[] }>("GET", "/status");
    expect(status.body.cloudflare.accountName).toBe("Acme");
    expect(status.body.gateway.url).toBe("https://old.acme.workers.dev");
    expect(status.body.n8n).not.toBeNull();
    expect(status.body.connections).toHaveLength(1);
  });

  it("keeps every saved token in the one private file", async () => {
    await call("POST", "/cloudflare/token", { token: "cf-token" });
    await call("POST", "/cloudflare/token", { token: "cf-token-b" });
    expect((await stat(join(stateDir(), "state.json"))).mode & 0o777).toBe(0o600);
  });
});
