/**
 * Installs the engine into the user's Cloudflare account and manages what it
 * reads: the config in KV (with history for rollback) and one signing-secret
 * Worker secret per Slack app.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CONFIG_HISTORY_PREFIX,
  CONFIG_KEY,
  SOURCE_TYPES,
  configHash,
  parseConfig,
  validateConfig,
  type AppConfig,
  type GatewayConfig,
  type SourceType,
  type WebhookVerify,
} from "@gw/shared";
import { ENGINE_VERSION } from "@gw/engine/version";
import { CloudflareError, type CloudflareApi } from "./cloudflare";
import type { LocalState } from "./store";

export type Install = NonNullable<LocalState["gateway"]>;

export const COMPATIBILITY_DATE = "2026-10-28";
export const BUNDLED_ENGINE_VERSION = ENGINE_VERSION;
const HISTORY_LIMIT = 50;
const EMPTY_CONFIG: GatewayConfig = { lists: {}, apps: {} };

export class ConflictError extends Error {}
/** Something the user can fix (bad name, wrong secret format, …); shown as-is. */
export class InputError extends Error {}
export class InvalidConfigError extends Error {
  constructor(readonly errors: string[]) {
    super(`Config is invalid: ${errors.join("; ")}`);
  }
}

/** The built engine. Next to cli.js in the published package; in the repo, the engine's build output. */
export async function loadEngineBundle(): Promise<string> {
  for (const candidate of ["./engine.js", "../../../engine/dist/engine.js"]) {
    try {
      return await readFile(new URL(candidate, import.meta.url), "utf8");
    } catch {
      // Try the next location.
    }
  }
  throw new Error("Engine bundle not found. Run `npm run build -w @gw/engine` first.");
}

export function validScriptName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

/** Creates or updates everything the engine needs. Safe to run again: it reuses what exists. */
export async function installGateway(cf: CloudflareApi, accountId: string, scriptName: string, engineCode: string): Promise<Install> {
  if (!validScriptName(scriptName)) throw new InputError("Use lowercase letters, digits and dashes for the Worker name.");
  // First, before anything is created: a new account has no workers.dev address until someone opens Workers & Pages once.
  const subdomain = await cf.workersSubdomain(accountId).catch((err: unknown) => {
    if (err instanceof CloudflareError && (err.status === 404 || err.codes.includes(10007))) {
      throw new InputError(
        "This Cloudflare account has no workers.dev address yet. In the Cloudflare dashboard, open Workers & Pages once: it asks you to choose a subdomain (free). Then come back and install again.",
      );
    }
    throw err;
  });
  const kvTitle = `${scriptName}-config`;
  const kvNamespaceId = (await cf.findKvNamespace(accountId, kvTitle)) ?? (await cf.createKvNamespace(accountId, kvTitle));
  const install: Install = {
    scriptName,
    kvNamespaceId,
    dataset: `${scriptName.replaceAll("-", "_")}_decisions`,
    url: `https://${scriptName}.${subdomain}.workers.dev`,
  };
  install.stats = await uploadEngine(cf, accountId, install, engineCode);
  await cf.enableWorkersDev(accountId, scriptName);
  if ((await cf.kvGet(accountId, kvNamespaceId, CONFIG_KEY)) === null) {
    await cf.kvPut(accountId, kvNamespaceId, CONFIG_KEY, JSON.stringify(EMPTY_CONFIG, null, 2));
  }
  return install;
}

/**
 * Uploads the engine. Existing secrets are kept, so an upgrade never loses signing secrets.
 * Analytics Engine must be switched on once per Cloudflare account; until it is,
 * the engine goes up without stats instead of failing. Returns whether stats are on.
 */
export async function uploadEngine(cf: CloudflareApi, accountId: string, install: Install, engineCode: string): Promise<boolean> {
  const upload = (withStats: boolean) =>
    cf.uploadScript(accountId, install.scriptName, {
      mainModule: "engine.js",
      code: engineCode,
      metadata: {
        compatibility_date: COMPATIBILITY_DATE,
        bindings: [
          { type: "kv_namespace", name: "CONFIG", namespace_id: install.kvNamespaceId },
          ...(withStats ? [{ type: "analytics_engine", name: "STATS", dataset: install.dataset }] : []),
        ],
        keep_bindings: ["secret_text"],
        observability: { enabled: true, head_sampling_rate: 1 },
      },
    });
  try {
    await upload(true);
    return true;
  } catch (err) {
    if (!isAnalyticsEngineOff(err)) throw err;
    await upload(false);
    return false;
  }
}

export function isAnalyticsEngineOff(err: unknown): boolean {
  return err instanceof CloudflareError && /enable Analytics Engine/i.test(err.message);
}

/** Where the account owner switches Analytics Engine on (free). */
export function analyticsEngineUrl(accountId: string): string {
  return `https://dash.cloudflare.com/${accountId}/workers/analytics-engine`;
}

let lastHistoryMs = 0;

/**
 * History keys sort by time, so the time must never repeat or go backwards in
 * this process, even for two saves in the same millisecond. The random suffix
 * keeps keys from two machines apart.
 */
function historyStamp(): string {
  lastHistoryMs = Math.max(Date.now(), lastHistoryMs + 1);
  return `${new Date(lastHistoryMs).toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
}

const SECRET_PREFIX: Record<SourceType, string> = {
  slack: "SLACK_SIGNING_SECRET",
  github: "GITHUB_SECRET",
  telegram: "TELEGRAM_SECRET",
  webhook: "WEBHOOK_SECRET",
};

export function secretNameFor(appKey: string, source: SourceType = "slack"): string {
  return `${SECRET_PREFIX[source]}_${appKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** 32 characters of A-Z, a-z, 0-9, - and _: strong, and accepted everywhere a secret is pasted (Telegram allows only these). */
export function generateSecret(): string {
  return randomBytes(24).toString("base64url");
}

export interface NewApp {
  key: string;
  source: SourceType;
  /** The secret the app gave you (Slack's signing secret, a service's webhook secret). */
  secret?: string;
  /** Generate one instead; it's returned once so it can be pasted into the app. */
  generate?: boolean;
  verify?: WebhookVerify;
  eventField?: string;
  description?: string;
}

export interface Health {
  reachable: boolean;
  ok?: boolean;
  version?: string;
  configHash?: string | null;
}

export class Gateway {
  constructor(
    private readonly cf: CloudflareApi,
    private readonly accountId: string,
    readonly install: Install,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async health(): Promise<Health> {
    try {
      const res = await this.fetchImpl(`${this.install.url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { reachable: false };
      const body = (await res.json()) as { ok: boolean; version: string; configHash: string | null };
      return { reachable: true, ok: body.ok, version: body.version, configHash: body.configHash };
    } catch {
      return { reachable: false };
    }
  }

  /** Re-uploads the engine (also how stats get turned on later). Returns whether stats are on. */
  async upgrade(engineCode: string): Promise<boolean> {
    return uploadEngine(this.cf, this.accountId, this.install, engineCode);
  }

  /** The stored config, its hash (send it back when saving), and any problems with it. */
  async readConfig(): Promise<{ config: GatewayConfig; hash: string; errors: string[] }> {
    const raw = await this.kvGet(CONFIG_KEY);
    if (raw === null) return { config: EMPTY_CONFIG, hash: "", errors: [] };
    const parsed = parseConfig(raw);
    const hash = await configHash(raw);
    if (parsed.ok) return { config: parsed.config, hash, errors: [] };
    let config = EMPTY_CONFIG;
    try {
      config = JSON.parse(raw) as GatewayConfig;
    } catch {
      // Unparseable: start from empty so the user can fix it in the UI.
    }
    return { config, hash, errors: parsed.errors };
  }

  /**
   * Validates, keeps the previous version in history, and saves. `baseHash` is
   * the hash the caller read; if the stored config changed since (another
   * machine saved), the save is refused instead of overwriting it.
   */
  async saveConfig(config: GatewayConfig, baseHash: string): Promise<string> {
    const raw = JSON.stringify(config, null, 2);
    const parsed = parseConfig(raw);
    if (!parsed.ok) throw new InvalidConfigError(parsed.errors);

    const current = await this.kvGet(CONFIG_KEY);
    const currentHash = current === null ? "" : await configHash(current);
    if (currentHash !== baseHash) throw new ConflictError("The config was changed somewhere else since you loaded it. Reload and try again.");

    if (current !== null) {
      await this.kvPut(`${CONFIG_HISTORY_PREFIX}${historyStamp()}`, current);
      await this.pruneHistory();
    }
    await this.kvPut(CONFIG_KEY, raw);
    return configHash(raw);
  }

  /** Newest first. Keys are config:history:<ISO time>-<random>. */
  async history(): Promise<string[]> {
    const keys = await this.cf.kvListKeys(this.accountId, this.install.kvNamespaceId, CONFIG_HISTORY_PREFIX);
    return keys.sort().reverse();
  }

  async readHistory(key: string): Promise<GatewayConfig> {
    if (!key.startsWith(CONFIG_HISTORY_PREFIX)) throw new InputError("Not a history entry");
    const raw = await this.kvGet(key);
    if (raw === null) throw new InputError("That version no longer exists");
    return JSON.parse(raw) as GatewayConfig;
  }

  /** Restores an earlier version. The version being replaced goes into history too, so a rollback can be undone. */
  async rollback(key: string): Promise<string> {
    const { hash } = await this.readConfig();
    return this.saveConfig(await this.readHistory(key), hash);
  }

  /** Stores the app's secret as a Worker secret (never in KV) and adds the app with no routes yet. Returns a generated secret once. */
  async addApp(a: NewApp): Promise<{ secret?: string }> {
    const key = a.key.trim();
    if (!/^[a-z0-9_-]+$/.test(key)) throw new InputError("Use lowercase letters, digits, - or _ for the app name; it becomes the URL path.");
    if (!SOURCE_TYPES.includes(a.source)) throw new InputError(`Unknown kind of app "${a.source}".`);
    // Telegram's secret token is ours to choose, so it's always generated.
    const generated = a.generate || a.source === "telegram" ? generateSecret() : undefined;
    const secret = (generated ?? a.secret ?? "").trim();
    if (!secret) throw new InputError("Paste the secret, or let the console generate one.");
    if (a.source === "slack" && !/^[0-9a-f]{32}$/i.test(secret)) {
      throw new InputError("That doesn't look like a Slack Signing Secret (32 hexadecimal characters). Click Show next to Signing Secret in Basic Information → App Credentials, and don't use the Client Secret or Verification Token.");
    }

    const { config, hash } = await this.readConfig();
    if (Object.hasOwn(config.apps, key)) throw new InputError(`An app named "${key}" already exists.`);
    const secretName = secretNameFor(key, a.source);
    const app: AppConfig = { source: a.source, signingSecret: secretName, routes: [] };
    if (a.verify) app.verify = a.verify;
    if (a.eventField?.trim()) app.eventField = a.eventField.trim();
    if (a.description) app.description = a.description;
    const next = { ...config, apps: { ...config.apps, [key]: app } };
    // Check first, so a config the gateway would refuse never leaves a secret behind.
    const problems = validateConfig(next);
    if (problems.length) throw new InvalidConfigError(problems);

    await this.cf.putSecret(this.accountId, this.install.scriptName, secretName, secret);
    await this.saveConfig(next, hash);
    return generated ? { secret: generated } : {};
  }

  /** Kept for callers from before other sources existed. */
  async addSlackApp(appKey: string, signingSecret: string, description?: string): Promise<void> {
    await this.addApp({ key: appKey, source: "slack", secret: signingSecret, description });
  }

  async replaceSigningSecret(appKey: string, signingSecret: string): Promise<void> {
    const { config } = await this.readConfig();
    const app = config.apps[appKey];
    if (!app) throw new InputError(`No app named "${appKey}".`);
    await this.cf.putSecret(this.accountId, this.install.scriptName, app.signingSecret, signingSecret.trim());
  }

  /** Replaces the app's secret with a new generated one and returns it. */
  async rotateSecret(appKey: string): Promise<string> {
    const secret = generateSecret();
    await this.replaceSigningSecret(appKey, secret);
    return secret;
  }

  async removeApp(appKey: string): Promise<void> {
    const { config, hash } = await this.readConfig();
    const app = config.apps[appKey];
    if (!app) return;
    const apps = { ...config.apps };
    delete apps[appKey];
    await this.saveConfig({ ...config, apps }, hash);
    const stillUsed = Object.values(apps).some((a) => a.signingSecret === app.signingSecret);
    if (!stillUsed) await this.cf.deleteSecret(this.accountId, this.install.scriptName, app.signingSecret).catch(() => {});
  }

  /** Apps whose signing secret isn't set on the Worker (e.g. after importing a config). */
  async appsMissingSecret(config: GatewayConfig): Promise<string[]> {
    const names = new Set(await this.cf.listSecretNames(this.accountId, this.install.scriptName));
    return Object.entries(config.apps)
      .filter(([, app]) => !names.has(app.signingSecret))
      .map(([key]) => key);
  }

  private async pruneHistory(): Promise<void> {
    const keys = await this.history();
    for (const key of keys.slice(HISTORY_LIMIT)) await this.cf.kvDelete(this.accountId, this.install.kvNamespaceId, key);
  }

  private kvGet(key: string) {
    return this.cf.kvGet(this.accountId, this.install.kvNamespaceId, key);
  }

  private kvPut(key: string, value: string) {
    return this.cf.kvPut(this.accountId, this.install.kvNamespaceId, key, value);
  }
}
