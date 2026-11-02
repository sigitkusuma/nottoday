import { ConfigLoader, type LoadedConfig } from "./config";
import { forward, type ForwardResult } from "./forward";
import { decide, type Decision } from "./router";
import { parseSlackRequest, verifySlackSignature, type SlackInbound } from "./slack";
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

  const pathMatch = /^\/slack\/([a-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!pathMatch) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!loaded) return new Response("Gateway not configured", { status: 503 });
  const cfg = loaded.config;

  const appName = pathMatch[1];
  const app = Object.hasOwn(cfg.apps, appName) ? cfg.apps[appName] : undefined;
  if (!app) {
    // Logged so the console's live check can say "Slack is calling an app name the gateway doesn't know".
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

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!(await verifySlackSignature(signingSecret, timestamp, signature, body))) {
    console.warn(JSON.stringify({ message: "bad slack signature", app: appName }));
    record(env.STATS, { app: appName, kind: "unknown", outcome: "bad_signature" });
    return new Response("Invalid signature", { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "application/json";
  const inbound = parseSlackRequest(contentType, body);
  if (inbound.kind === "url_verification") {
    console.log(JSON.stringify({ message: "url_verification", app: appName }));
    record(env.STATS, { app: appName, kind: "url_verification", outcome: "url_verification" });
    return Response.json({ challenge: inbound.challenge });
  }

  const described = describe(inbound);
  const logBase = {
    message: "slack_request",
    app: appName,
    ...described,
    retry: request.headers.get("x-slack-retry-num") ?? undefined,
    retryReason: request.headers.get("x-slack-retry-reason") ?? undefined,
  };

  // Slack retries an event when it didn't get a 2xx, and a retry can mean two things:
  // we processed the original but our reply was lost, or the original never reached us
  // (network, cold start, an outage, Socket Mode). We can't tell them apart without
  // shared state, and dropping the second kind loses the event silently. So every
  // retry is processed like a first delivery: at-least-once, with the retry number
  // and reason in the log. A rare duplicate beats a lost event.

  const decisions = decide(app, inbound, cfg.lists);
  const forwardSecret = readSecret(env, "GATEWAY_FORWARD_SECRET");
  // Set FORWARD_DRY_RUN=true in .dev.vars so local testing never reaches the real n8n.
  const dryRun = readSecret(env, "FORWARD_DRY_RUN") === "true";
  const send = (d: Decision, extra: { timeoutMs?: number; retries?: number }): Promise<ForwardResult> =>
    dryRun
      ? Promise.resolve({ ok: true, status: 0, attempts: 0, error: "dry run: not sent" })
      : forward({
          url: d.route.forwardTo,
          body,
          contentType,
          slackSignature: signature ?? "",
          slackTimestamp: timestamp ?? "",
          appName,
          routeName: d.route.name,
          forwardSecret,
          ...extra,
        });

  const forwarded = decisions.filter((d) => d.forward);
  const proxy = forwarded.find((d) => d.route.respond === "proxy");
  const background = forwarded
    .filter((d) => d !== proxy)
    .map((d) => send(d, { retries: BACKGROUND_RETRIES }).then((r) => [d, r] as const));

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
        const r = byRoute.get(d);
        return {
          route: d.route.name,
          mode: d.route.mode ?? "enforce",
          filter: d.filter,
          reason: d.reason,
          forwarded: d.forward,
          status: r?.status,
          attempts: r?.attempts,
          error: r?.error,
        };
      });
      const failed = !dryRun && routes.some((r) => r.forwarded && !(r.status && r.status < 400));
      const line = JSON.stringify({ ...logBase, dryRun: dryRun || undefined, routes, forwardedCount: forwarded.length });
      if (failed) console.error(line);
      else console.log(line);

      const common = { app: appName, kind: described.kind, type: described.type, channel: described.channel };
      if (routes.length === 0) record(env.STATS, { ...common, outcome: "unrouted" });
      for (const r of routes) {
        record(env.STATS, {
          ...common,
          route: r.route,
          mode: r.mode,
          filter: r.filter,
          reason: r.reason,
          outcome: r.forwarded ? "forwarded" : "dropped",
          status: r.status,
          attempts: r.attempts,
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
