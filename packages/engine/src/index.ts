import { SOURCE_PREFIX, sourceOf } from "@gw/shared";
import { ConfigLoader, type LoadedConfig } from "./config";
import { forward, type ForwardRequest, type ForwardResult } from "./forward";
import { parseGithubRequest, verifyGithubSignature } from "./github";
import { decide, type Decision } from "./router";
import { parseSlackRequest, verifySlackSignature, type SlackInbound } from "./slack";
import { parseTelegramRequest, verifyTelegramToken } from "./telegram";
import { parseWebhookRequest, verifyWebhook } from "./webhook";
import { record } from "./stats";
import { ENGINE_VERSION } from "./version";

const MAX_BODY_BYTES = 1_000_000;
const PROXY_TIMEOUT_MS = 2_500;
const BACKGROUND_RETRIES = 2;

const configLoader = new ConfigLoader();

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return handle(request, env, ctx, await configLoader.get(env.CONFIG));
  },
} satisfies ExportedHandler<Env>;

export async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  loaded: LoadedConfig | null,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return Response.json({
      ok: loaded !== null,
      version: ENGINE_VERSION,
      configHash: loaded?.hash ?? null,
      apps: loaded ? Object.keys(loaded.config.apps) : [],
    });
  }

  const pathMatch = /^\/(slack|github|telegram|hook)\/([a-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!pathMatch) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!loaded) return new Response("Gateway not configured", { status: 503 });
  const cfg = loaded.config;

  const [, prefix, appName] = pathMatch;
  const found = Object.hasOwn(cfg.apps, appName) ? cfg.apps[appName] : undefined;
  // An app is only reachable under its own source's prefix: /github/x never reaches a Slack app.
  const app = found && SOURCE_PREFIX[sourceOf(found)] === prefix ? found : undefined;
  if (!app) {
    // Logged so the console's live check can say "the app is calling an app name the gateway doesn't know".
    console.warn(JSON.stringify({ message: "unknown app", app: appName }));
    return new Response("Unknown app", { status: 404 });
  }

  const signingSecret = readSecret(env, app.signingSecret);
  if (!signingSecret) {
    console.error(JSON.stringify({ message: "missing signing secret", app: appName, secret: app.signingSecret }));
    return new Response("Gateway misconfigured", { status: 500 });
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const contentType = request.headers.get("content-type") ?? "application/json";
  const source = sourceOf(app);

  if (source !== "slack") {
    const ok =
      source === "github"
        ? await verifyGithubSignature(signingSecret, request.headers.get("x-hub-signature-256"), body)
        : source === "telegram"
          ? verifyTelegramToken(signingSecret, request.headers.get("x-telegram-bot-api-secret-token"))
          : app.verify
            ? await verifyWebhook(app.verify, signingSecret, request, body)
            : false;
    if (!ok) {
      console.warn(JSON.stringify({ message: "bad signature", source, app: appName }));
      record(env.STATS, { app: appName, kind: "unknown", outcome: "bad_signature" });
      return new Response("Invalid signature", { status: 401 });
    }
    const inbound =
      source === "github"
        ? parseGithubRequest(request.headers, body)
        : source === "telegram"
          ? parseTelegramRequest(request.headers, body)
          : parseWebhookRequest(app, request.headers, body);
    if (inbound.handshake) {
      console.log(JSON.stringify({ message: "url_verification", source, app: appName }));
      record(env.STATS, { app: appName, kind: "url_verification", outcome: "url_verification" });
      return new Response("ok", { status: 200 });
    }
    return route(env, ctx, {
      appName,
      decisions: decide(app, inbound, cfg.lists),
      logBase: { message: "request", source, app: appName, kind: "event", type: inbound.type, channel: inbound.channel, id: inbound.id },
      stats: { app: appName, kind: "event", type: inbound.type, channel: inbound.channel },
      forwarding: { body, contentType, passthrough: request.headers },
    });
  }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!(await verifySlackSignature(signingSecret, timestamp, signature, body))) {
    console.warn(JSON.stringify({ message: "bad slack signature", app: appName }));
    record(env.STATS, { app: appName, kind: "unknown", outcome: "bad_signature" });
    return new Response("Invalid signature", { status: 401 });
  }

  const inbound = parseSlackRequest(contentType, body);
  if (inbound.kind === "url_verification") {
    console.log(JSON.stringify({ message: "url_verification", app: appName }));
    record(env.STATS, { app: appName, kind: "url_verification", outcome: "url_verification" });
    return Response.json({ challenge: inbound.challenge });
  }

  const described = describe(inbound);

  // Slack retries an event when it didn't get a 2xx, and a retry can mean two things:
  // we processed the original but our reply was lost, or the original never reached us
  // (network, cold start, an outage, Socket Mode). We can't tell them apart without
  // shared state, and dropping the second kind loses the event silently. So every
  // retry is processed like a first delivery: at-least-once, with the retry number
  // and reason in the log. A rare duplicate beats a lost event.

  return route(env, ctx, {
    appName,
    decisions: decide(app, inbound, cfg.lists),
    logBase: {
      message: "slack_request",
      app: appName,
      ...described,
      retry: request.headers.get("x-slack-retry-num") ?? undefined,
      retryReason: request.headers.get("x-slack-retry-reason") ?? undefined,
    },
    stats: { app: appName, kind: described.kind, type: described.type, channel: described.channel },
    forwarding: { body, contentType, slackSignature: signature ?? "", slackTimestamp: timestamp ?? "" },
  });
}

interface Routing {
  appName: string;
  decisions: Decision[];
  /** Fields of the log line the console's Activity page reads. */
  logBase: Record<string, unknown>;
  stats: { app: string; kind?: string; type?: string; channel?: string };
  forwarding: Pick<ForwardRequest, "body" | "contentType" | "slackSignature" | "slackTimestamp" | "passthrough">;
}

/** Forwards what the routes let through, replies to the sender, then logs and records every decision. */
async function route(env: Env, ctx: ExecutionContext, r: Routing): Promise<Response> {
  const { decisions, appName } = r;
  const forwardSecret = readSecret(env, "GATEWAY_FORWARD_SECRET");
  // Set FORWARD_DRY_RUN=true in .dev.vars so local testing never reaches the real n8n.
  const dryRun = readSecret(env, "FORWARD_DRY_RUN") === "true";
  const send = (d: Decision, extra: { timeoutMs?: number; retries?: number }): Promise<ForwardResult> =>
    dryRun
      ? Promise.resolve({ ok: true, status: 0, attempts: 0, error: "dry run: not sent" })
      : forward({ ...r.forwarding, url: d.route.forwardTo, appName, routeName: d.route.name, forwardSecret, ...extra });

  const forwarded = decisions.filter((d) => d.forward);
  const proxy = forwarded.find((d) => d.route.respond === "proxy");
  const background = forwarded
    .filter((d) => d !== proxy)
    .map((d) => send(d, { retries: BACKGROUND_RETRIES }).then((res) => [d, res] as const));

  let reply = new Response(null, { status: 200 });
  let proxyResult: ForwardResult | undefined;
  if (proxy) {
    proxyResult = await send(proxy, { timeoutMs: PROXY_TIMEOUT_MS });
    if (proxyResult.ok && proxyResult.response) {
      const res = proxyResult.response;
      reply = new Response(res.body, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "text/plain" },
      });
    }
  }

  ctx.waitUntil(
    Promise.all(background).then((results) => {
      const byRoute = new Map<Decision, ForwardResult>(results);
      if (proxy && proxyResult) byRoute.set(proxy, proxyResult);
      const routes = decisions.map((d) => {
        const res = byRoute.get(d);
        return {
          route: d.route.name,
          mode: d.route.mode ?? "enforce",
          filter: d.filter,
          reason: d.reason,
          forwarded: d.forward,
          status: res?.status,
          attempts: res?.attempts,
          error: res?.error,
        };
      });
      const failed = !dryRun && routes.some((x) => x.forwarded && !(x.status && x.status < 400));
      const line = JSON.stringify({ ...r.logBase, dryRun: dryRun || undefined, routes, forwardedCount: forwarded.length });
      if (failed) console.error(line);
      else console.log(line);

      if (routes.length === 0) record(env.STATS, { ...r.stats, outcome: "unrouted" });
      for (const x of routes) {
        record(env.STATS, {
          ...r.stats,
          route: x.route,
          mode: x.mode,
          filter: x.filter,
          reason: x.reason,
          outcome: x.forwarded ? "forwarded" : "dropped",
          status: x.status,
          attempts: x.attempts,
        });
      }
    }),
  );

  return reply;
}

/** Fields worth logging. Message text is never logged. */
function describe(inbound: SlackInbound): Record<string, string | undefined> {
  switch (inbound.kind) {
    case "event":
      return {
        kind: "event",
        type: inbound.event.type,
        subtype: inbound.event.subtype,
        channel: typeof inbound.event.channel === "string" ? inbound.event.channel : inbound.event.channel?.id,
        eventId: inbound.eventId,
      };
    case "interactivity":
      return { kind: "interactivity", type: inbound.payload.type };
    case "command":
      return { kind: "command", type: inbound.command };
    case "unknown":
      return { kind: "unknown", type: inbound.detail };
    case "url_verification":
      return { kind: "url_verification" };
  }
}

/** Secrets are named in the config, so they are looked up by name. */
function readSecret(env: Env, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
