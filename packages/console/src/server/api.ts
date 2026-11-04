/** The console's JSON API, used by the web UI. Only reachable with the session token. */

import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { CONFIG_HISTORY_PREFIX, requestPath, sourceOf, type GatewayConfig, type SourceType, type WebhookVerify } from "@gw/shared";
import { CloudflareApi, CloudflareError, createTokenUrl } from "./cloudflare";
import { TelegramApi, TelegramError } from "./telegram";
import { BUNDLED_ENGINE_VERSION, ConflictError, Gateway, InputError, InvalidConfigError, analyticsEngineUrl, findExistingGateways, installGateway, isAnalyticsEngineOff, loadEngineBundle } from "./gateway";
import { N8nApi, N8nError } from "./n8n";
import { Stats } from "./stats";
import { TailHub } from "./tail";
import { TOOL_NAME, activateConnection, assignAccount, connectToken, connectionStates, listConnections, loadState, removeConnection, updateState, type LocalState } from "./store";

export interface ApiDeps {
  fetchImpl?: typeof fetch;
  loadEngine?: () => Promise<string>;
  /** For tests: the WebSocket client the live stream uses. */
  WebSocketImpl?: typeof WebSocket;
}

class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export function createApi(deps: ApiDeps = {}): Hono {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const loadEngine = deps.loadEngine ?? loadEngineBundle;
  const api = new Hono();
  // One real-time log session per installed gateway, shared by every open browser tab.
  const hubs = new Map<string, TailHub>();

  const cloudflare = (state: LocalState) => {
    if (!state.cloudflare?.token) throw new UserError("Connect your Cloudflare account first.");
    if (!state.cloudflare.accountId) throw new UserError("Choose a Cloudflare account first.");
    return { cf: new CloudflareApi(state.cloudflare.token, fetchImpl), accountId: state.cloudflare.accountId };
  };
  const gateway = (state: LocalState) => {
    const { cf, accountId } = cloudflare(state);
    if (!state.gateway) throw new UserError("Install the gateway first.");
    return new Gateway(cf, accountId, state.gateway, fetchImpl);
  };
  const stats = (state: LocalState) => {
    const { cf, accountId } = cloudflare(state);
    if (!state.gateway) throw new UserError("Install the gateway first.");
    if (state.gateway.stats === false) throw new UserError("Stats are off until Analytics Engine is switched on for this Cloudflare account.", 409);
    return new Stats(cf, accountId, state.gateway.dataset);
  };
  const n8n = (state: LocalState) => {
    if (!state.n8n) throw new UserError("Connect n8n first.");
    return new N8nApi(state.n8n.baseUrl, state.n8n.apiKey, fetchImpl);
  };
  const days = (c: Context, fallback: number) => {
    const n = Number(c.req.query("days") ?? fallback);
    if (![1, 7, 30, 90].includes(n)) throw new UserError("days must be 1, 7, 30 or 90");
    return n;
  };

  api.onError((err, c) => {
    if (err instanceof InvalidConfigError) return c.json({ error: "The config has problems.", errors: err.errors }, 422);
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
    if (err instanceof UserError) return c.json({ error: err.message }, err.status);
    if (err instanceof InputError) return c.json({ error: err.message }, 400);
    if (err instanceof CloudflareError) {
      if (isAnalyticsEngineOff(err)) return c.json({ error: "Analytics Engine isn't switched on in this Cloudflare account yet, so stats aren't available." }, 409);
      const hint = err.status === 403 || err.status === 401 ? " The token may be missing a permission. The token guide on the Cloudflare step lists the four it needs; add the missing one to the token in Cloudflare, or create a new token." : "";
      return c.json({ error: `Cloudflare: ${err.message}.${hint}` }, 502);
    }
    if (err instanceof N8nError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  });

  api.get("/status", async (c) => {
    const state = await loadState();
    let gatewayStatus = null;
    if (state.gateway && state.cloudflare?.accountId) {
      const health = await gateway(state).health();
      gatewayStatus = {
        ...state.gateway,
        health,
        bundledVersion: BUNDLED_ENGINE_VERSION,
        statsEnabled: state.gateway.stats !== false,
        analyticsEngineUrl: analyticsEngineUrl(state.cloudflare.accountId),
        upgradeAvailable: health.reachable && health.version !== undefined && health.version !== BUNDLED_ENGINE_VERSION,
      };
    }
    return c.json({
      cloudflare: state.cloudflare ? { accountId: state.cloudflare.accountId ?? null, accountName: state.cloudflare.accountName ?? null } : null,
      gateway: gatewayStatus,
      n8n: state.n8n ? { baseUrl: state.n8n.baseUrl } : null,
      connections: await listConnections(),
      tokenUrl: createTokenUrl(TOOL_NAME),
    });
  });

  // Cloudflare connection

  api.post("/cloudflare/token", async (c) => {
    const { token } = await c.req.json<{ token?: string }>();
    if (!token?.trim()) throw new UserError("Paste the API token.");
    const cf = new CloudflareApi(token.trim(), fetchImpl);
    const verified = await cf.verifyToken().catch(() => null);
    if (verified?.status !== "active") throw new UserError("Cloudflare didn't accept that token. Copy it again from the token's summary page.");
    const accounts = await cf.listAccounts();
    if (accounts.length === 0) throw new UserError("The token can't see any account. Set Account Resources to include your account.");
    const only = accounts.length === 1 ? accounts[0] : undefined;
    // Adds a connection and makes it the active one. A token for an account that's already saved refreshes that connection.
    const result = await connectToken({ token: token.trim(), accountId: only?.id, accountName: only?.name });
    return c.json({ accounts, refreshed: result === "refreshed" });
  });

  api.get("/cloudflare/accounts", async (c) => {
    const state = await loadState();
    if (!state.cloudflare?.token) throw new UserError("Connect your Cloudflare account first.");
    return c.json({ accounts: await new CloudflareApi(state.cloudflare.token, fetchImpl).listAccounts() });
  });

  api.post("/cloudflare/account", async (c) => {
    const { accountId } = await c.req.json<{ accountId?: string }>();
    const state = await loadState();
    if (!state.cloudflare?.token) throw new UserError("Connect your Cloudflare account first.");
    const account = (await new CloudflareApi(state.cloudflare.token, fetchImpl).listAccounts()).find((a) => a.id === accountId);
    if (!account) throw new UserError("That account isn't available to this token.");
    await assignAccount(account);
    return c.json({ ok: true });
  });

  /** Forgets the active connection on this machine and falls back to another saved one. Nothing in Cloudflare is touched. */
  api.delete("/cloudflare", async (c) => {
    const active = (await listConnections()).find((x) => x.active);
    if (active) await removeConnection(active.id);
    return c.json({ ok: true });
  });

  // Saved Cloudflare accounts

  api.get("/connections", async (c) => c.json({ connections: await listConnections() }));

  api.post("/connections/:id/activate", async (c) => {
    if (!(await activateConnection(c.req.param("id")))) throw new UserError("That connection no longer exists.", 404);
    return c.json({ ok: true });
  });

  /**
   * What each saved account's gateway holds, read without switching to it: its apps, secrets check, health
   * and stats. One account failing doesn't hide the others. `?others=1` leaves out the active account,
   * which the console already has.
   */
  api.get("/overview", async (c) => {
    const d = days(c, 7);
    const skipActive = c.req.query("others") === "1";
    const saved = (await connectionStates()).filter((x) => x.state.cloudflare?.accountId && x.state.gateway && !(skipActive && x.active));
    const accounts = await Promise.all(
      saved.map(async ({ id, active, state }) => {
        const head = {
          id,
          active,
          accountId: state.cloudflare!.accountId!,
          accountName: state.cloudflare!.accountName ?? null,
          scriptName: state.gateway!.scriptName,
          url: state.gateway!.url,
          statsEnabled: state.gateway!.stats !== false,
        };
        try {
          const gw = gateway(state);
          const [health, current] = await Promise.all([gw.health(), gw.readConfig()]);
          const st = head.statsEnabled ? stats(state) : null;
          // Stats being slow or off must not hide the apps, so a failure there only leaves the counts empty.
          const [missingSecrets, routes, signals] = await Promise.all([
            gw.appsMissingSecret(current.config),
            st ? st.summary(d).catch(() => []) : [],
            st ? st.appSignals().catch(() => []) : [],
          ]);
          return { ...head, health, apps: current.config.apps, missingSecrets, routes, signals };
        } catch (err) {
          return { ...head, error: err instanceof CloudflareError ? `Cloudflare: ${err.message}` : err instanceof Error ? err.message : "Couldn't read this account." };
        }
      }),
    );
    return c.json({ accounts });
  });

  api.delete("/connections/:id", async (c) => {
    await removeConnection(c.req.param("id"));
    return c.json({ ok: true });
  });

  // Gateway install

  /** Gateways already in the active account, so a new machine can reconnect to one instead of making another. */
  api.get("/gateway/existing", async (c) => {
    const { cf, accountId } = cloudflare(await loadState());
    // A token that can't list them will fail the install with a clearer message, so this only offers help.
    const gateways = await findExistingGateways(cf, accountId).catch(() => []);
    return c.json({ gateways });
  });

  api.post("/gateway/install", async (c) => {
    const { scriptName } = await c.req.json<{ scriptName?: string }>();
    const state = await loadState();
    const { cf, accountId } = cloudflare(state);
    const install = await installGateway(cf, accountId, (scriptName ?? "").trim(), await loadEngine());
    await updateState((s) => {
      s.gateway = install;
    });
    return c.json({ gateway: install });
  });

  api.post("/gateway/upgrade", async (c) => {
    const stats = await gateway(await loadState()).upgrade(await loadEngine());
    await updateState((s) => {
      if (s.gateway) s.gateway.stats = stats;
    });
    return c.json({ ok: true, version: BUNDLED_ENGINE_VERSION, statsEnabled: stats });
  });

  // Config

  api.get("/config", async (c) => {
    const gw = gateway(await loadState());
    const current = await gw.readConfig();
    return c.json({ ...current, missingSecrets: await gw.appsMissingSecret(current.config) });
  });

  api.put("/config", async (c) => {
    const { config, baseHash } = await c.req.json<{ config: GatewayConfig; baseHash: string }>();
    if (typeof baseHash !== "string") throw new UserError("baseHash is required");
    const hash = await gateway(await loadState()).saveConfig(config, baseHash);
    return c.json({ hash });
  });

  api.get("/config/history", async (c) => {
    const keys = await gateway(await loadState()).history();
    return c.json({ versions: keys.map((key) => ({ key, savedAt: key.slice(CONFIG_HISTORY_PREFIX.length, CONFIG_HISTORY_PREFIX.length + 24) })) });
  });

  api.get("/config/history/:key", async (c) => c.json({ config: await gateway(await loadState()).readHistory(c.req.param("key")) }));

  api.post("/config/rollback", async (c) => {
    const { key } = await c.req.json<{ key: string }>();
    return c.json({ hash: await gateway(await loadState()).rollback(key) });
  });

  // Apps (Slack, GitHub, Telegram, any webhook)

  api.post("/apps", async (c) => {
    const body = await c.req.json<{ key?: string; source?: SourceType; signingSecret?: string; generate?: boolean; verify?: WebhookVerify; eventField?: string; description?: string }>();
    if (!body.key) throw new UserError("Give the app a name.");
    const result = await gateway(await loadState()).addApp({
      key: body.key,
      source: body.source ?? "slack",
      secret: body.signingSecret,
      generate: body.generate,
      verify: body.verify,
      eventField: body.eventField,
      description: body.description?.trim() || undefined,
    });
    return c.json({ ok: true, ...result });
  });

  /** Registers the gateway as the bot's webhook, with a fresh secret token. The bot token is used for this call only. */
  api.post("/apps/:key/telegram/connect", async (c) => {
    const { botToken } = await c.req.json<{ botToken?: string }>();
    if (!botToken?.trim()) throw new UserError("Paste the bot token from BotFather.");
    const key = c.req.param("key");
    const state = await loadState();
    const gw = gateway(state);
    const { config } = await gw.readConfig();
    const app = config.apps[key];
    if (!app || sourceOf(app) !== "telegram") throw new UserError(`No Telegram app named "${key}".`);
    try {
      const tg = new TelegramApi(botToken.trim(), fetchImpl);
      const me = await tg.getMe();
      const secret = await gw.rotateSecret(key);
      const url = `${state.gateway!.url}${requestPath("telegram", key)}`;
      await tg.setWebhook(url, secret);
      return c.json({ ok: true, username: me.username ?? me.first_name ?? "", url });
    } catch (err) {
      if (err instanceof TelegramError) throw new UserError(err.message);
      throw err;
    }
  });

  api.put("/apps/:key/secret", async (c) => {
    const { signingSecret } = await c.req.json<{ signingSecret?: string }>();
    if (!signingSecret) throw new UserError("Paste the signing secret.");
    await gateway(await loadState()).replaceSigningSecret(c.req.param("key"), signingSecret);
    return c.json({ ok: true });
  });

  api.delete("/apps/:key", async (c) => {
    await gateway(await loadState()).removeApp(c.req.param("key"));
    return c.json({ ok: true });
  });

  // Stats

  api.get("/stats/summary", async (c) => c.json({ routes: await stats(await loadState()).summary(days(c, 1)) }));
  api.get("/stats/daily", async (c) => c.json({ days: await stats(await loadState()).daily(days(c, 30)) }));
  api.get("/stats/recent", async (c) => c.json({ decisions: await stats(await loadState()).recent() }));
  api.get("/stats/apps", async (c) => c.json({ apps: await stats(await loadState()).appSignals() }));

  /** Server-Sent Events: "status" (connecting / live / unavailable) and "decision" (one per request the gateway handled). */
  api.get("/live/stream", async (c) => {
    const state = await loadState();
    const { cf, accountId } = cloudflare(state);
    if (!state.gateway) throw new UserError("Install the gateway first.");
    const script = state.gateway.scriptName;
    const key = `${accountId}/${script}`;
    let hub = hubs.get(key);
    if (!hub) {
      hub = new TailHub(
        { open: () => cf.createTail(accountId, script), close: (id) => cf.deleteTail(accountId, script, id) },
        deps.WebSocketImpl ?? globalThis.WebSocket,
      );
      hubs.set(key, hub);
    }
    const liveHub = hub;
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = liveHub.subscribe(
        (e) => void stream.writeSSE({ event: "decision", data: JSON.stringify(e) }),
        (st) => void stream.writeSSE({ event: "status", data: JSON.stringify(st) }),
      );
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      // Comments keep proxies and the browser from timing out an idle stream.
      while (open) {
        await stream.write(": keep-alive\n\n");
        await stream.sleep(15_000);
      }
    });
  });

  // n8n

  api.post("/n8n", async (c) => {
    const { baseUrl, apiKey } = await c.req.json<{ baseUrl?: string; apiKey?: string }>();
    if (!baseUrl || !apiKey) throw new UserError("n8n address and API key are required.");
    let client: N8nApi;
    try {
      client = new N8nApi(baseUrl, apiKey.trim(), fetchImpl);
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : "Invalid n8n address");
    }
    await client.verify();
    await updateState((s) => {
      s.n8n = { baseUrl: client.baseUrl, apiKey: apiKey.trim() };
    });
    return c.json({ baseUrl: client.baseUrl });
  });

  api.delete("/n8n", async (c) => {
    await updateState((s) => {
      delete s.n8n;
    });
    return c.json({ ok: true });
  });

  api.get("/n8n/usage", async (c) => {
    const d = days(c, 30);
    return c.json(await n8n(await loadState()).usage(new Date(Date.now() - d * 86_400_000)));
  });

  api.get("/n8n/triggers", async (c) => {
    const client = n8n(await loadState());
    const workflows = await client.workflows();
    return c.json({ triggers: workflows.flatMap((w) => client.triggersOf(w)) });
  });

  api.get("/n8n/data-tables", async (c) => c.json({ tables: await n8n(await loadState()).dataTables() }));

  /** Replaces a list's values with a column of an n8n data table and remembers the source. */
  api.post("/lists/:name/sync", async (c) => {
    const name = c.req.param("name");
    const { tableId, tableName, column } = await c.req.json<{ tableId?: string; tableName?: string; column?: string }>();
    if (!tableId || !column) throw new UserError("Choose a data table and column.");
    const state = await loadState();
    const values = await n8n(state).columnValues(tableId, column);
    const gw = gateway(state);
    const { config, hash } = await gw.readConfig();
    const before = new Set(config.lists[name] ?? []);
    const after = new Set(values);
    const next: GatewayConfig = {
      ...config,
      lists: { ...config.lists, [name]: values },
      listSources: {
        ...config.listSources,
        [name]: { type: "n8n-data-table", tableId, tableName: tableName ?? tableId, column, syncedAt: new Date().toISOString() },
      },
    };
    const newHash = await gw.saveConfig(next, hash);
    return c.json({
      hash: newHash,
      values,
      added: values.filter((v) => !before.has(v)),
      removed: [...before].filter((v) => !after.has(v)),
    });
  });

  return api;
}
