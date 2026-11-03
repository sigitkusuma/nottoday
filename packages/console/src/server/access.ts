/** Who may talk to the console: which Host headers it answers to, and the session token. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { stateDir } from "./store";

export interface HostPolicy {
  port: number;
  /** Host names allowed with the console's port, e.g. "127.0.0.1". */
  names: string[];
  /** Host names allowed without a port (served on 443 by a proxy such as tailscale serve). */
  bareNames?: string[];
  /** Any IP address with the console's port. Safe from DNS rebinding, which needs a host name. */
  anyIp?: boolean;
}

export const localHosts = (port: number): HostPolicy => ({ port, names: ["127.0.0.1", "localhost"] });

/** Splits a Host header into name and port; handles IPv6 literals like "[::1]:4870". */
export function splitHost(header: string): { name: string; port?: number } {
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(header);
  if (v6) return { name: v6[1].toLowerCase(), port: v6[2] ? Number(v6[2]) : undefined };
  const at = header.lastIndexOf(":");
  if (at < 0) return { name: header.toLowerCase() };
  return { name: header.slice(0, at).toLowerCase(), port: Number(header.slice(at + 1)) };
}

/**
 * Blocks DNS rebinding: a hostile page that points its own host name at this
 * machine still sends that name as Host, so it's refused.
 */
export function hostAllowed(header: string | undefined, policy: HostPolicy): boolean {
  if (!header) return false;
  const { name, port } = splitHost(header);
  if (port === undefined || port === 443) {
    if (policy.bareNames?.includes(name)) return true;
    if (port === undefined) return false;
  }
  if (port !== policy.port) return false;
  return policy.names.includes(name) || (policy.anyIp === true && isIP(name) !== 0);
}

/** Compares without stopping at the first difference, so timing doesn't leak the token. */
export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(given), hash(expected));
}

export const newSessionToken = () => randomBytes(24).toString("base64url");

const tokenFile = () => join(stateDir(), "console-token");

/** The session token for server modes: kept between starts so a saved link keeps working. */
export async function savedSessionToken(replace: boolean): Promise<{ token: string; created: boolean }> {
  if (!replace) {
    try {
      const token = (await readFile(tokenFile(), "utf8")).trim();
      if (token.length >= 32) return { token, created: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const token = newSessionToken();
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await chmod(stateDir(), 0o700);
  await writeFile(tokenFile(), token + "\n", { mode: 0o600 });
  await chmod(tokenFile(), 0o600);
  return { token, created: true };
}
