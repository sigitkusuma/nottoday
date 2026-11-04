/**
 * Local state: tokens and the IDs of what was installed. Lives in the user's
 * home directory, readable only by them. The gateway's config itself is not
 * here; it lives in Cloudflare KV, so any machine with the token can manage it.
 *
 * Several Cloudflare accounts can be saved ("connections"); one is active at a
 * time. The rest of the console sees only the active one, through LocalState,
 * so it doesn't need to know connections exist. The n8n connection is shared.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const TOOL_NAME = "nottoday";
/** The name before the rename. Its state folder is still used if it exists, so saved accounts carry over. */
const LEGACY_NAME = "slack-gateway";

export interface CloudflareConnection {
  token: string;
  /** Unset while the token can see several accounts and none is chosen yet. */
  accountId?: string;
  accountName?: string;
}

export interface InstalledGateway {
  scriptName: string;
  kvNamespaceId: string;
  dataset: string;
  url: string;
  /** False when the account hasn't switched Analytics Engine on yet; undefined counts as on. */
  stats?: boolean;
}

export interface Connection {
  id: string;
  cloudflare: CloudflareConnection;
  gateway?: InstalledGateway;
}

/** What the console works with: the active connection, plus the shared n8n connection. */
export interface LocalState {
  cloudflare?: CloudflareConnection;
  gateway?: InstalledGateway;
  n8n?: { baseUrl: string; apiKey: string };
}

interface StateFile {
  version: 2;
  activeId?: string;
  connections: Connection[];
  n8n?: { baseUrl: string; apiKey: string };
}

export function stateDir(): string {
  const override = process.env.NOTTODAY_HOME ?? process.env.SLACK_GATEWAY_HOME;
  if (override) return override;
  const dir = join(homedir(), ".config", TOOL_NAME);
  const legacy = join(homedir(), ".config", LEGACY_NAME);
  return !existsSync(dir) && existsSync(legacy) ? legacy : dir;
}

const file = () => join(stateDir(), "state.json");

/** Reads either format. The first version kept a single account at the top level. */
async function readFileState(): Promise<StateFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, connections: [] };
    throw err;
  }
  const data = raw as Partial<StateFile> & { cloudflare?: CloudflareConnection; gateway?: InstalledGateway };
  if (data.version === 2 && Array.isArray(data.connections)) return data as StateFile;
  const state: StateFile = { version: 2, connections: [], n8n: data.n8n };
  if (data.cloudflare?.token) {
    const id = newId();
    state.connections.push({ id, cloudflare: data.cloudflare, gateway: data.gateway });
    state.activeId = id;
  }
  return state;
}

/** Writes atomically with mode 0600 in a 0700 directory: the file holds API tokens. */
async function writeFileState(state: StateFile): Promise<void> {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await chmod(stateDir(), 0o700);
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file());
}

const newId = () => randomBytes(4).toString("hex");

const active = (s: StateFile) => s.connections.find((c) => c.id === s.activeId);

function view(s: StateFile): LocalState {
  const a = active(s);
  return { cloudflare: a?.cloudflare, gateway: a?.gateway, n8n: s.n8n };
}

export async function loadState(): Promise<LocalState> {
  return view(await readFileState());
}

/** Applies a change to the active connection (and the shared n8n settings). Throws when nothing is connected yet. */
export async function updateState(change: (state: LocalState) => void): Promise<LocalState> {
  const s = await readFileState();
  const a = active(s);
  if (!a) throw new Error("Connect a Cloudflare account first.");
  const v = view(s);
  change(v);
  if (v.cloudflare) a.cloudflare = v.cloudflare;
  if (v.gateway) a.gateway = v.gateway;
  else delete a.gateway;
  if (v.n8n) s.n8n = v.n8n;
  else delete s.n8n;
  await writeFileState(s);
  return view(s);
}

export interface ConnectionSummary {
  id: string;
  accountId: string | null;
  accountName: string | null;
  scriptName: string | null;
  gatewayUrl: string | null;
  active: boolean;
  /** Token saved but no account chosen yet. */
  pending: boolean;
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const s = await readFileState();
  return s.connections.map((c) => ({
    id: c.id,
    accountId: c.cloudflare.accountId ?? null,
    accountName: c.cloudflare.accountName ?? null,
    scriptName: c.gateway?.scriptName ?? null,
    gatewayUrl: c.gateway?.url ?? null,
    active: c.id === s.activeId,
    pending: !c.cloudflare.accountId,
  }));
}

/**
 * Saves a token and makes it the active connection. With an account, a saved
 * connection for the same account is refreshed (new token, same gateway)
 * instead of duplicated. Without one (the token sees several accounts), any
 * earlier unfinished connection is replaced.
 */
export async function connectToken(cloudflare: CloudflareConnection): Promise<"added" | "refreshed"> {
  const s = await readFileState();
  s.connections = s.connections.filter((c) => c.cloudflare.accountId); // drop abandoned, unfinished ones
  const existing = cloudflare.accountId ? s.connections.find((c) => c.cloudflare.accountId === cloudflare.accountId) : undefined;
  if (existing) {
    existing.cloudflare = cloudflare;
    s.activeId = existing.id;
  } else {
    const id = newId();
    s.connections.push({ id, cloudflare });
    s.activeId = id;
  }
  await writeFileState(s);
  return existing ? "refreshed" : "added";
}

/** Chooses the account for the active (unfinished) connection. If that account is already saved, the saved one takes over the new token. */
export async function assignAccount(account: { id: string; name: string }): Promise<void> {
  const s = await readFileState();
  const a = active(s);
  if (!a) throw new Error("Connect a Cloudflare account first.");
  const existing = s.connections.find((c) => c.id !== a.id && c.cloudflare.accountId === account.id);
  if (existing) {
    existing.cloudflare = { token: a.cloudflare.token, accountId: account.id, accountName: account.name };
    s.connections = s.connections.filter((c) => c.id !== a.id);
    s.activeId = existing.id;
  } else {
    if (a.cloudflare.accountId !== account.id) delete a.gateway;
    a.cloudflare = { token: a.cloudflare.token, accountId: account.id, accountName: account.name };
  }
  await writeFileState(s);
}

export async function activateConnection(id: string): Promise<boolean> {
  const s = await readFileState();
  if (!s.connections.some((c) => c.id === id)) return false;
  s.activeId = id;
  await writeFileState(s);
  return true;
}

/** Forgets a saved connection on this computer. Nothing in Cloudflare is touched. */
export async function removeConnection(id: string): Promise<void> {
  const s = await readFileState();
  s.connections = s.connections.filter((c) => c.id !== id);
  if (s.activeId === id) s.activeId = s.connections[0]?.id;
  await writeFileState(s);
}

/** Every saved connection as the console would see it if it were active, for reading other accounts without switching. */
export async function connectionStates(): Promise<{ id: string; active: boolean; state: LocalState }[]> {
  const s = await readFileState();
  return s.connections.map((c) => ({ id: c.id, active: c.id === s.activeId, state: { cloudflare: c.cloudflare, gateway: c.gateway, n8n: s.n8n } }));
}

export async function activeConnectionId(): Promise<string | undefined> {
  return (await readFileState()).activeId;
}
