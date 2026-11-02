/**
 * Loads the gateway config from KV. The console writes it; a save goes live
 * without a redeploy, once each Worker instance's cache (CACHE_MS) expires and
 * KV has spread the change: usually seconds, up to about a minute. A broken or unreadable config never
 * replaces the last good one, so a bad save can't take the gateway down.
 */

import { CONFIG_KEY, configHash, parseConfig, type GatewayConfig } from "@gw/shared";

const CACHE_MS = 30_000;

export interface LoadedConfig {
  config: GatewayConfig;
  /** First 12 hex chars of the SHA-256 of the stored JSON; shown on /health. */
  hash: string;
}

export class ConfigLoader {
  private lastGood: LoadedConfig | null = null;
  private lastRaw: string | null = null;
  private checkedAt = -Infinity;

  constructor(private readonly cacheMs = CACHE_MS) {}

  /** null means the gateway has never been configured. */
  async get(kv: KVNamespace, now = Date.now()): Promise<LoadedConfig | null> {
    if (now - this.checkedAt < this.cacheMs) return this.lastGood;
    this.checkedAt = now;

    let raw: string | null;
    try {
      raw = await kv.get(CONFIG_KEY);
    } catch (err) {
      console.error(JSON.stringify({ message: "config read failed, keeping last good config", error: String(err) }));
      return this.lastGood;
    }

    if (raw === null) {
      this.lastGood = null;
      this.lastRaw = null;
      return null;
    }
    if (raw === this.lastRaw) return this.lastGood;
    this.lastRaw = raw;

    const parsed = parseConfig(raw);
    if (!parsed.ok) {
      console.error(JSON.stringify({ message: "invalid config, keeping last good config", errors: parsed.errors }));
      return this.lastGood;
    }
    this.lastGood = { config: parsed.config, hash: await configHash(raw) };
    return this.lastGood;
  }
}
