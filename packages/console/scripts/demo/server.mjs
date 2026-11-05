#!/usr/bin/env node
/**
 * Demo API for screenshots: answers every /api route the console UI calls with
 * made-up data for a fictional company, Acme. No Cloudflare, n8n or Slack is
 * contacted. Writes are kept in memory until the process stops.
 *
 *   node scripts/demo/server.mjs          # listens on 127.0.0.1:4870
 *   PORT=4999 node scripts/demo/server.mjs
 *
 * Run `npm run dev:web` next to it; Vite proxies /api here. See README.md.
 * Response shapes follow src/server/api.ts and src/web/types.ts.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4870);
/** DEMO_ACCOUNTS=1 shows only "Acme": no account strip on the dashboard, no account labels. */
const ACCOUNT_COUNT = process.env.DEMO_ACCOUNTS === "1" ? 1 : 2;
const ENGINE_VERSION = "0.3.0";
const N8N = "https://n8n.acme.example";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Demo content

const REAL_MESSAGES = ["", "thread_broadcast", "file_share"];

const URLS = {
  pager: `${N8N}/webhook/6f1d2c3a-8b4e-4f7a-9c21-0d5e7a1b9c44/webhook`,
  triage: `${N8N}/webhook/2b7e91d0-3c5a-4e6f-8a1b-7c9d0e2f4a63/webhook`,
  mentions: `${N8N}/webhook/support-mentions`,
  standupCmd: `${N8N}/webhook/standup-command`,
  standupDm: `${N8N}/webhook/9a3c5e7f-1b2d-4c6e-8f0a-3b5d7f9e1c28/webhook`,
  releaseNotes: `${N8N}/webhook/c4e6a8b0-2d4f-4a6c-9e1b-5d7f9b1d3e57/webhook`,
  deploys: `${N8N}/webhook/deploys`,
  opsAlerts: `${N8N}/webhook/labs-ops-alerts`,
};

const CH = { helpDesk: "C07HLPD3SK2", engOps: "C07ENG0PS4Q", incidents: "C07INC1D3NT", general: "C07GNRL8XQ1", standup: "C07STNDUP9K", random: "C07RNDM5ZW3", dm: "D07STNDP2MB" };

const acmeConfig = () => ({
  lists: {
    "on-call": ["U07K2M4PQ8A", "U07L9X3RB2C", "U07N5T7WD4E", "U07P1V8YF6G"],
    leads: ["U07Q3H6JK1M", "U07R8C2LN5P", "U07S4D9MP7R"],
    "quiet-channels": [CH.random, CH.general],
  },
  listSources: {
    "on-call": { type: "n8n-data-table", tableId: "dt_oncall", tableName: "On-call rotation", column: "slack_id", syncedAt: new Date(Date.now() - 3 * HOUR).toISOString() },
  },
  apps: {
    "oncall-alerts": {
      source: "slack",
      description: "Pages whoever is on call when they're mentioned in an engineering channel.",
      signingSecret: "SLACK_SIGNING_SECRET_ONCALL_ALERTS",
      routes: [
        {
          name: "pages",
          mode: "enforce",
          on: { type: "event", events: ["message"] },
          filters: { subtypes: REAL_MESSAGES, ignoreBots: true, mentionIn: "@on-call", ignoreSelfMention: true },
          forwardTo: URLS.pager,
        },
      ],
    },
    "support-bot": {
      source: "slack",
      description: "Opens a ticket for each new post in #help-desk and answers when mentioned.",
      signingSecret: "SLACK_SIGNING_SECRET_SUPPORT_BOT",
      routes: [
        {
          name: "triage",
          mode: "shadow",
          on: { type: "event", events: ["message"] },
          filters: { subtypes: ["", "file_share"], ignoreBots: true, channels: [CH.helpDesk] },
          forwardTo: URLS.triage,
        },
        { name: "mentions", mode: "enforce", on: { type: "event", events: ["app_mention"] }, filters: { ignoreBots: true }, forwardTo: URLS.mentions },
      ],
    },
    "standup-bot": {
      source: "slack",
      description: "Collects daily standups from /standup and from DMs to the bot.",
      signingSecret: "SLACK_SIGNING_SECRET_STANDUP_BOT",
      routes: [
        { name: "standup", mode: "enforce", on: { type: "command", commands: ["/standup"] }, respond: "proxy", forwardTo: URLS.standupCmd },
        { name: "replies", mode: "enforce", on: { type: "event", events: ["message"] }, filters: { channelTypes: ["im"], subtypes: [""], ignoreBots: true }, forwardTo: URLS.standupDm },
      ],
    },
  },
});

const labsConfig = () => ({
  lists: { maintainers: ["U07T6F1QS3T", "U07V2G5RU8V"] },
  apps: {
    "web-deploys": {
      source: "github",
      description: "Deploys the marketing site when main changes.",
      signingSecret: "GITHUB_SECRET_WEB_DEPLOYS",
      routes: [
        {
          name: "deploy-main",
          mode: "enforce",
          on: { type: "event", events: ["push"] },
          match: [{ field: "ref", op: "is", value: "refs/heads/main" }],
          forwardTo: URLS.deploys,
        },
      ],
    },
    "ops-alerts": {
      source: "slack",
      description: "Forwards mentions of the ops bot to the alert router.",
      signingSecret: "SLACK_SIGNING_SECRET_OPS_ALERTS",
      routes: [{ name: "mentions", mode: "enforce", on: { type: "event", events: ["app_mention"] }, filters: { ignoreBots: true }, forwardTo: URLS.opsAlerts }],
    },
  },
});

/** 7-day per-route counts; other ranges are scaled from these. dropped ≈ 10k, forwarded ≈ 2.6k for Acme. */
const ACME_SUMMARY_7D = [
  { app: "standup-bot", route: "replies", mode: "enforce", received: 5180, forwarded: 104, dropped: 5076, wouldDrop: 0, reasons: { channelTypes: 4890, subtypes: 186 } },
  { app: "oncall-alerts", route: "pages", mode: "enforce", received: 5208, forwarded: 88, dropped: 5120, wouldDrop: 0, reasons: { mentionIn: 4630, ignoreBots: 310, subtypes: 180 } },
  { app: "support-bot", route: "triage", mode: "shadow", received: 1940, forwarded: 1940, dropped: 0, wouldDrop: 1420, reasons: { channels: 1100, ignoreBots: 320 } },
  { app: "support-bot", route: "mentions", mode: "enforce", received: 412, forwarded: 398, dropped: 14, wouldDrop: 0, reasons: { ignoreBots: 14 } },
  { app: "standup-bot", route: "standup", mode: "enforce", received: 140, forwarded: 140, dropped: 0, wouldDrop: 0, reasons: {} },
];
const LABS_SUMMARY_7D = [
  { app: "web-deploys", route: "deploy-main", mode: "enforce", received: 486, forwarded: 61, dropped: 425, wouldDrop: 0, reasons: { "match:ref": 425 } },
  { app: "ops-alerts", route: "mentions", mode: "enforce", received: 233, forwarded: 219, dropped: 14, wouldDrop: 0, reasons: { ignoreBots: 14 } },
];

/** Kinds of request each app gets, with a weight. `routes` is what the gateway decided. */
const ok = (route, mode = "enforce") => ({ route, mode, filter: "pass", forwarded: true, status: 200, attempts: 1 });
const drop = (route, reason) => ({ route, mode: "enforce", filter: "fail", reason, forwarded: false });
const shadow = (route, reason) => ({ route, mode: "shadow", filter: "fail", reason, forwarded: true, status: 200, attempts: 1 });

const ACME_MIX = [
  { app: "oncall-alerts", type: "message", channel: CH.engOps, w: 5, routes: [drop("pages", "mentionIn")] },
  { app: "oncall-alerts", type: "message", channel: CH.incidents, w: 2, routes: [drop("pages", "mentionIn")] },
  { app: "oncall-alerts", type: "message", subtype: "bot_message", channel: CH.incidents, w: 1, routes: [drop("pages", "subtypes")] },
  { app: "oncall-alerts", type: "message", subtype: "message_changed", channel: CH.engOps, w: 1, routes: [drop("pages", "subtypes")] },
  { app: "oncall-alerts", type: "message", channel: CH.incidents, w: 0.6, routes: [ok("pages")] },
  { app: "support-bot", type: "message", channel: CH.helpDesk, w: 1.6, routes: [ok("triage", "shadow")] },
  { app: "support-bot", type: "message", channel: CH.general, w: 2.2, routes: [shadow("triage", "channels")] },
  { app: "support-bot", type: "message", subtype: "bot_message", channel: CH.helpDesk, w: 0.6, routes: [shadow("triage", "subtypes")] },
  { app: "support-bot", type: "app_mention", channel: CH.helpDesk, w: 0.7, routes: [ok("mentions")] },
  { app: "support-bot", type: "reaction_added", channel: CH.helpDesk, w: 1.6, routes: [] },
  { app: "standup-bot", type: "message", channel: CH.standup, w: 4.5, routes: [drop("replies", "channelTypes")] },
  { app: "standup-bot", type: "message", subtype: "message_changed", channel: CH.dm, w: 0.5, routes: [drop("replies", "subtypes")] },
  { app: "standup-bot", type: "message", channel: CH.dm, w: 0.6, routes: [ok("replies")] },
  { app: "standup-bot", kind: "command", type: "/standup", channel: CH.standup, w: 0.5, routes: [ok("standup")] },
  { app: "standup-bot", type: "reaction_added", channel: CH.standup, w: 0.8, routes: [] },
];
const LABS_MIX = [
  { app: "web-deploys", source: "github", type: "push", channel: "acme/website", w: 3, routes: [drop("deploy-main", "match:ref")] },
  { app: "web-deploys", source: "github", type: "push", channel: "acme/website", w: 0.6, routes: [ok("deploy-main")] },
  { app: "ops-alerts", type: "app_mention", channel: "C07LBSOPS6D", w: 1, routes: [ok("mentions")] },
];

/** Events Slack sends that no route lists, last day: drives the "remove these bot events in Slack" hint. */
const ACME_UNROUTED = [
  { app: "support-bot", type: "reaction_added", count: 642, lastAgo: 3 * MIN },
  { app: "standup-bot", type: "reaction_added", count: 214, lastAgo: 6 * MIN },
  { app: "support-bot", type: "member_joined_channel", count: 9, lastAgo: 50 * MIN },
];

const ALL_ACCOUNTS = [
  {
    id: "a1c3e5f7",
    accountId: "4b8f2e6a1c9d3f7e5a2b8c4d6e0f1a3b",
    accountName: "Acme",
    scriptName: "nottoday",
    url: "https://nottoday.acme.workers.dev",
    config: acmeConfig(),
    summary: ACME_SUMMARY_7D,
    mix: ACME_MIX,
    unrouted: ACME_UNROUTED,
    history: [],
  },
  {
    id: "b2d4f6a8",
    accountId: "7e1a9c3f5b2d8e4a6c0f2b4d9a1e3c5f",
    accountName: "Acme Labs",
    scriptName: "nottoday-labs",
    url: "https://nottoday-labs.acme.workers.dev",
    config: labsConfig(),
    summary: LABS_SUMMARY_7D,
    mix: LABS_MIX,
    unrouted: [],
    history: [],
  },
];
const ACCOUNTS = ALL_ACCOUNTS.slice(0, ACCOUNT_COUNT);
let activeId = ACCOUNTS[0].id;
let n8nConnected = true;

/** Earlier config versions for the Versions page: a few saves over the last week. */
function seedHistory(account) {
  const now = Date.now();
  const cfg = account.config;
  const without = (mutate) => {
    const c = structuredClone(cfg);
    mutate(c);
    return c;
  };
  const versions = [
    [2 * HOUR + 14 * MIN, without((c) => (c.apps["support-bot"] ? (c.apps["support-bot"].routes[0].filters.ignoreBots = false) : null))],
    [26 * HOUR, without((c) => c.apps["support-bot"]?.routes.splice(1, 1))],
    [3 * DAY + 4 * HOUR, without((c) => delete c.apps["standup-bot"])],
    [6 * DAY + 2 * HOUR, without((c) => (delete c.apps["standup-bot"], delete c.apps["support-bot"], delete c.listSources))],
  ];
  account.history = versions.map(([ago, config], i) => ({ key: `config:history:${new Date(now - ago).toISOString()}-${(0xa1b2 + i * 4099).toString(16)}`, config }));
}
ACCOUNTS.forEach(seedHistory);

const active = () => ACCOUNTS.find((a) => a.id === activeId);
const hash = (config) => createHash("sha256").update(JSON.stringify(config, null, 2)).digest("hex").slice(0, 12);

// ---------------------------------------------------------------------------
// Generated activity

/** Small seeded PRNG so every run shows the same feed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(mix, r) {
  const total = mix.reduce((n, m) => n + m.w, 0);
  let x = r() * total;
  for (const m of mix) {
    x -= m.w;
    if (x <= 0) return m;
  }
  return mix[mix.length - 1];
}

/**
 * The account's requests, newest first, as ms-ago offsets. The first `liveCount`
 * are sent on the live stream (with subtypes and tries); the rest are history
 * from the stats table. Base time is "now" at the call, so it always looks current.
 */
function timeline(account, count, seed) {
  const r = rng(seed);
  const out = [];
  let ago = 4_000;
  for (let i = 0; i < count; i++) {
    const m = pick(account.mix, r);
    out.push({ ago, ...m });
    // Busy for the first minutes, then spread out over the day.
    ago += i < 14 ? 8_000 + r() * 30_000 : 40_000 + r() * 140_000;
  }
  return out;
}

const LIVE_COUNT = 14;
/** One rare failure deep in the history so the feed shows every outcome. */
const withError = (rows) => {
  const at = rows.findIndex((x, n) => n > 40 && x.app === "support-bot" && x.type === "app_mention");
  if (at > 0) rows[at] = { ...rows[at], routes: [{ route: "mentions", mode: "enforce", filter: "pass", forwarded: true, status: 502, attempts: 3, error: "n8n answered 502" }] };
  return rows;
};

function eventsFor(account) {
  const rows = withError(timeline(account, 190, account.id === ALL_ACCOUNTS[0].id ? 7 : 11));
  // The Request URLs were re-saved in Slack earlier today, so Slack verified them again.
  const slackApps = Object.keys(account.config.apps).filter((k) => (account.config.apps[k].source ?? "slack") === "slack");
  slackApps.forEach((app, i) => rows.push({ ago: rows[rows.length - 1].ago + (4 + i) * MIN, app, kind: "url_verification", type: "", channel: "", routes: [] }));
  return rows;
}

/** Stats timestamps are UTC "YYYY-MM-DD HH:MM:SS". */
const statsTime = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

function liveEvent(e, now) {
  if (e.kind === "url_verification") return { time: new Date(now - e.ago).toISOString(), kind: "verified", app: e.app, source: "slack" };
  return {
    time: new Date(now - e.ago).toISOString(),
    kind: "event",
    app: e.app,
    source: e.source ?? "slack",
    type: e.type,
    ...(e.subtype ? { subtype: e.subtype } : {}),
    channel: e.channel,
    routes: e.routes.map(({ error, ...rest }) => (error ? { ...rest, error } : rest)),
  };
}

function decisionRows(e, now) {
  const base = { time: statsTime(now - e.ago), app: e.app, kind: e.kind ?? "event", type: e.type, channel: e.channel };
  if (e.kind === "url_verification") return [{ ...base, route: "", mode: "", filter: "none", reason: "", outcome: "url_verification", status: 0 }];
  if (e.routes.length === 0) return [{ ...base, route: "", mode: "", filter: "none", reason: "", outcome: "unrouted", status: 0 }];
  return e.routes.map((r) => ({ ...base, route: r.route, mode: r.mode, filter: r.filter, reason: r.reason ?? "", outcome: r.forwarded ? "forwarded" : "dropped", status: r.forwarded ? r.status : 0 }));
}

function summary(account, days) {
  const f = days / 7;
  return account.summary.map((s) => {
    const sc = (n) => Math.round(n * f);
    return { ...s, received: sc(s.received), forwarded: sc(s.forwarded), dropped: sc(s.dropped), wouldDrop: sc(s.wouldDrop), reasons: Object.fromEntries(Object.entries(s.reasons).map(([k, v]) => [k, sc(v)])), n8nErrors: 0, errorStatuses: {} };
  });
}

function signals(account) {
  const now = Date.now();
  return Object.keys(account.config.apps).map((app, i) => ({
    app,
    lastVerified: statsTime(now - (9 + i * 5) * DAY),
    lastRequest: statsTime(now - (20 + i * 9) * 1000),
  }));
}

function triggers() {
  return usage(30).workflows.flatMap((w) => w.triggers);
}

/** Executions per workflow over the range, as n8n's API would count them. */
function usage(days) {
  const f = days / 30;
  const slack = (workflowId, workflowName, nodeName, url, suggestedEvents) => ({ workflowId, workflowName, nodeName, kind: "slack", url, ...(suggestedEvents ? { suggestedEvents } : {}) });
  const hook = (workflowId, workflowName, nodeName, url) => ({ workflowId, workflowName, nodeName, kind: "webhook", url });
  const rows = [
    { workflowId: "wf1", workflowName: "Support triage", active: true, executions: 8320, triggers: [slack("wf1", "Support triage", "Slack Trigger", URLS.triage, ["message"])] },
    { workflowId: "wf2", workflowName: "Release notes digest", active: true, executions: 4410, triggers: [slack("wf2", "Release notes digest", "Slack Trigger", URLS.releaseNotes, ["message"])] },
    { workflowId: "wf3", workflowName: "Nightly CRM sync", active: true, executions: 930, triggers: [] },
    { workflowId: "wf4", workflowName: "Support mentions", active: true, executions: 1702, triggers: [hook("wf4", "Support mentions", "Webhook", URLS.mentions)] },
    {
      workflowId: "wf5",
      workflowName: "Standup collector",
      active: true,
      executions: 1046,
      triggers: [hook("wf5", "Standup collector", "Slash command", URLS.standupCmd), slack("wf5", "Standup collector", "DM trigger", URLS.standupDm, ["message"])],
    },
    { workflowId: "wf6", workflowName: "On-call pager", active: true, executions: 377, triggers: [slack("wf6", "On-call pager", "Slack Trigger", URLS.pager, ["message"])] },
    { workflowId: "wf7", workflowName: "Invoice reminders", active: false, executions: 0, triggers: [hook("wf7", "Invoice reminders", "Webhook", `${N8N}/webhook/invoice-reminders`)] },
  ].map((w) => ({ ...w, executions: Math.round(w.executions * f) }));
  rows.sort((a, b) => b.executions - a.executions);
  return { workflows: rows, total: rows.reduce((n, w) => n + w.executions, 0) + Math.round(310 * f), truncated: false };
}

const DATA_TABLES = [
  { id: "dt_oncall", name: "On-call rotation", columns: ["name", "slack_id", "week"], rows: { slack_id: ["U07K2M4PQ8A", "U07L9X3RB2C", "U07N5T7WD4E", "U07P1V8YF6G"] } },
  { id: "dt_leads", name: "Team leads", columns: ["team", "slack_id"], rows: { slack_id: ["U07Q3H6JK1M", "U07R8C2LN5P", "U07S4D9MP7R", "U07W7J4TV2X"] } },
];

// ---------------------------------------------------------------------------
// Routes

function connections() {
  return ACCOUNTS.map((a) => ({ id: a.id, accountId: a.accountId, accountName: a.accountName, scriptName: a.scriptName, gatewayUrl: a.url, active: a.id === activeId, pending: false }));
}

function status() {
  const a = active();
  return {
    cloudflare: { accountId: a.accountId, accountName: a.accountName },
    gateway: {
      scriptName: a.scriptName,
      kvNamespaceId: createHash("md5").update(a.id).digest("hex"),
      dataset: `${a.scriptName.replaceAll("-", "_")}_decisions`,
      url: a.url,
      health: { reachable: true, ok: true, version: ENGINE_VERSION, configHash: hash(a.config) },
      bundledVersion: ENGINE_VERSION,
      statsEnabled: true,
      analyticsEngineUrl: `https://dash.cloudflare.com/${a.accountId}/workers/analytics-engine`,
      upgradeAvailable: false,
    },
    n8n: n8nConnected ? { baseUrl: N8N } : null,
    connections: connections(),
    tokenUrl: "https://dash.cloudflare.com/profile/api-tokens?name=nottoday",
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const days = (q, fallback) => {
  const n = Number(q.get("days") ?? fallback);
  if (![1, 7, 30, 90].includes(n)) throw new HttpError(400, "days must be 1, 7, 30 or 90");
  return n;
};

/** [method, pattern, handler(params, query, body)] */
const ROUTES = [
  ["GET", "/status", () => status()],

  ["POST", "/cloudflare/token", () => ({ accounts: ACCOUNTS.map((a) => ({ id: a.accountId, name: a.accountName })), refreshed: true })],
  ["GET", "/cloudflare/accounts", () => ({ accounts: ACCOUNTS.map((a) => ({ id: a.accountId, name: a.accountName })) })],
  ["POST", "/cloudflare/account", () => ({ ok: true })],
  ["DELETE", "/cloudflare", () => ({ ok: true })],

  ["GET", "/connections", () => ({ connections: connections() })],
  [
    "POST",
    "/connections/:id/activate",
    ({ id }) => {
      if (!ACCOUNTS.some((a) => a.id === id)) throw new HttpError(404, "That connection no longer exists.");
      activeId = id;
      return { ok: true };
    },
  ],
  ["DELETE", "/connections/:id", () => ({ ok: true })],
  [
    "GET",
    "/overview",
    (_, q) => {
      const d = days(q, 7);
      const skipActive = q.get("others") === "1";
      return {
        accounts: ACCOUNTS.filter((a) => !(skipActive && a.id === activeId)).map((a) => ({
          id: a.id,
          active: a.id === activeId,
          accountId: a.accountId,
          accountName: a.accountName,
          scriptName: a.scriptName,
          url: a.url,
          statsEnabled: true,
          health: { reachable: true, ok: true, version: ENGINE_VERSION },
          apps: a.config.apps,
          missingSecrets: [],
          routes: summary(a, d),
          signals: signals(a),
        })),
      };
    },
  ],

  ["GET", "/gateway/existing", () => ({ gateways: [{ scriptName: active().scriptName, apps: Object.keys(active().config.apps).length, routes: Object.values(active().config.apps).reduce((n, x) => n + x.routes.length, 0), url: active().url }] })],
  ["POST", "/gateway/install", () => ({ gateway: status().gateway })],
  ["POST", "/gateway/upgrade", () => ({ ok: true, version: ENGINE_VERSION, statsEnabled: true })],

  ["GET", "/config", () => ({ config: active().config, hash: hash(active().config), errors: [], missingSecrets: [] })],
  [
    "PUT",
    "/config",
    (_, __, body) => {
      if (typeof body?.baseHash !== "string") throw new HttpError(400, "baseHash is required");
      const a = active();
      a.history.unshift({ key: `config:history:${new Date().toISOString()}-${randomBytes(2).toString("hex")}`, config: a.config });
      a.config = body.config;
      return { hash: hash(a.config) };
    },
  ],
  ["GET", "/config/history", () => ({ versions: active().history.map((v) => ({ key: v.key, savedAt: v.key.slice("config:history:".length, "config:history:".length + 24) })) })],
  [
    "GET",
    "/config/history/:key",
    ({ key }) => {
      const v = active().history.find((x) => x.key === key);
      if (!v) throw new HttpError(400, "That version no longer exists");
      return { config: v.config };
    },
  ],
  [
    "POST",
    "/config/rollback",
    (_, __, body) => {
      const a = active();
      const v = a.history.find((x) => x.key === body?.key);
      if (!v) throw new HttpError(400, "That version no longer exists");
      a.history.unshift({ key: `config:history:${new Date().toISOString()}-${randomBytes(2).toString("hex")}`, config: a.config });
      a.config = structuredClone(v.config);
      return { hash: hash(a.config) };
    },
  ],

  [
    "POST",
    "/apps",
    (_, __, body) => {
      if (!body?.key) throw new HttpError(400, "Give the app a name.");
      const a = active();
      if (a.config.apps[body.key]) throw new HttpError(409, `An app called "${body.key}" already exists.`);
      const source = body.source ?? "slack";
      const prefix = { slack: "SLACK_SIGNING_SECRET", github: "GITHUB_SECRET", telegram: "TELEGRAM_SECRET", webhook: "WEBHOOK_SECRET" }[source];
      a.config = {
        ...a.config,
        apps: {
          ...a.config.apps,
          [body.key]: {
            source,
            ...(body.description?.trim() ? { description: body.description.trim() } : {}),
            signingSecret: `${prefix}_${body.key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
            ...(body.verify ? { verify: body.verify } : {}),
            ...(body.eventField ? { eventField: body.eventField } : {}),
            routes: [],
          },
        },
      };
      return { ok: true, ...(body.generate ? { secret: randomBytes(24).toString("hex") } : {}) };
    },
  ],
  ["POST", "/apps/:key/telegram/connect", ({ key }) => ({ ok: true, username: "acme_demo_bot", url: `${active().url}/telegram/${key}` })],
  ["PUT", "/apps/:key/secret", () => ({ ok: true })],
  [
    "DELETE",
    "/apps/:key",
    ({ key }) => {
      const a = active();
      const apps = { ...a.config.apps };
      delete apps[key];
      a.config = { ...a.config, apps };
      return { ok: true };
    },
  ],

  ["GET", "/stats/summary", (_, q) => ({ routes: summary(active(), days(q, 1)) })],
  [
    "GET",
    "/stats/daily",
    (_, q) => {
      const d = days(q, 30);
      const s = summary(active(), 7);
      const fwd = s.reduce((n, r) => n + r.forwarded, 0) / 7;
      const drp = s.reduce((n, r) => n + r.dropped, 0) / 7;
      const now = Date.now();
      return {
        days: Array.from({ length: d }, (_, i) => {
          const wobble = 0.8 + ((i * 37) % 11) / 25;
          return { day: statsTime(now - (d - 1 - i) * DAY).slice(0, 10) + " 00:00:00", forwarded: Math.round(fwd * wobble), dropped: Math.round(drp * wobble) };
        }),
      };
    },
  ],
  [
    "GET",
    "/stats/recent",
    (_, q) => {
      const limit = Number(q.get("limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(400, "limit must be between 1 and 500");
      const now = Date.now();
      return { decisions: eventsFor(active()).slice(LIVE_COUNT).flatMap((e) => decisionRows(e, now)).slice(0, limit) };
    },
  ],
  [
    "GET",
    "/stats/unrouted",
    () => {
      const now = Date.now();
      return { rows: active().unrouted.map((u) => ({ app: u.app, type: u.type, count: u.count, last: statsTime(now - u.lastAgo) })) };
    },
  ],
  ["GET", "/stats/apps", () => ({ apps: signals(active()) })],

  [
    "POST",
    "/n8n",
    (_, __, body) => {
      if (!body?.baseUrl || !body?.apiKey) throw new HttpError(400, "n8n address and API key are required.");
      n8nConnected = true;
      return { baseUrl: N8N };
    },
  ],
  [
    "DELETE",
    "/n8n",
    () => {
      n8nConnected = false;
      return { ok: true };
    },
  ],
  ["GET", "/n8n/usage", (_, q) => usage(days(q, 30))],
  ["GET", "/n8n/triggers", () => ({ triggers: triggers() })],
  ["GET", "/n8n/data-tables", () => ({ tables: DATA_TABLES.map(({ rows, ...t }) => t) })],
  [
    "POST",
    "/lists/:name/sync",
    ({ name }, __, body) => {
      const table = DATA_TABLES.find((t) => t.id === body?.tableId);
      if (!table || !body?.column) throw new HttpError(400, "Choose a data table and column.");
      const values = table.rows[body.column] ?? [];
      const a = active();
      const before = new Set(a.config.lists[name] ?? []);
      a.config = {
        ...a.config,
        lists: { ...a.config.lists, [name]: values },
        listSources: { ...a.config.listSources, [name]: { type: "n8n-data-table", tableId: table.id, tableName: body.tableName ?? table.name, column: body.column, syncedAt: new Date().toISOString() } },
      };
      return { hash: hash(a.config), values, added: values.filter((v) => !before.has(v)), removed: [...before].filter((v) => !values.includes(v)) };
    },
  ],
];

/** The live stream: "status", then the latest requests as "decision" events, then keep-alives. */
function liveStream(req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("status", { state: "live" });
  const now = Date.now();
  // Oldest first, the way they would have arrived.
  for (const e of eventsFor(active()).slice(0, LIVE_COUNT).reverse()) send("decision", liveEvent(e, now));
  const timer = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.on("close", () => clearInterval(timer));
}

function match(pattern, path) {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://demo");
  const json = (code, data) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (!url.pathname.startsWith("/api/")) return json(404, { error: "The demo server only answers /api. Open the console through Vite (npm run dev:web)." });
  const path = url.pathname.slice(4);
  if (req.method === "GET" && path === "/live/stream") return liveStream(req, res);

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  for (const [method, pattern, handler] of ROUTES) {
    if (method !== req.method) continue;
    const params = match(pattern, path);
    if (!params) continue;
    try {
      return json(200, await handler(params, url.searchParams, body));
    } catch (err) {
      return json(err instanceof HttpError ? err.status : 500, { error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }
  json(404, { error: `No demo route for ${req.method} ${path}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Demo API on http://127.0.0.1:${PORT}/api (fictional data for "Acme").`);
  console.log("Start the UI with `npm run dev:web -w nottoday` and open http://localhost:5173/");
});
