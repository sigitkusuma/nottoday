/**
 * The few Cloudflare API calls the console needs, over plain fetch.
 * API reference: https://developers.cloudflare.com/api/
 */

import { CLOUDFLARE_TOKEN_PERMISSIONS } from "@gw/shared";

const API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[] = [],
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

export interface Account {
  id: string;
  name: string;
}

export interface ScriptUpload {
  mainModule: string;
  code: string;
  metadata: Record<string, unknown>;
}

/** Permissions the console asks for when the user creates a token. */
export const TOKEN_PERMISSIONS = CLOUDFLARE_TOKEN_PERMISSIONS.map(({ key, type }) => ({ key, type }));

/** Cloudflare's "create token" page with the permissions above filled in. */
export function createTokenUrl(name: string): string {
  const params = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(TOKEN_PERMISSIONS),
    accountId: "*",
    zoneId: "all",
    name,
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${params}`;
}

export class CloudflareApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async raw(method: string, path: string, init: { body?: BodyInit; contentType?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (init.contentType) headers["content-type"] = init.contentType;
    return this.fetchImpl(`${API}${path}`, { method, headers, body: init.body });
  }

  private async call<T>(method: string, path: string, json?: unknown): Promise<T> {
    const res = await this.raw(method, path, json === undefined ? {} : { body: JSON.stringify(json), contentType: "application/json" });
    return unwrap<T>(res);
  }

  async verifyToken(): Promise<{ status: string }> {
    return this.call("GET", "/user/tokens/verify");
  }

  async listAccounts(): Promise<Account[]> {
    const accounts = await this.call<Account[]>("GET", "/accounts?per_page=50");
    return accounts.map(({ id, name }) => ({ id, name }));
  }

  /** The account's workers.dev subdomain, e.g. "acme" in acme.workers.dev. */
  async workersSubdomain(accountId: string): Promise<string> {
    const { subdomain } = await this.call<{ subdomain: string }>("GET", `/accounts/${accountId}/workers/subdomain`);
    return subdomain;
  }

  async scriptExists(accountId: string, name: string): Promise<boolean> {
    const scripts = await this.call<{ id: string }[]>("GET", `/accounts/${accountId}/workers/scripts`);
    return scripts.some((s) => s.id === name);
  }

  async uploadScript(accountId: string, name: string, upload: ScriptUpload): Promise<void> {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ main_module: upload.mainModule, ...upload.metadata })], { type: "application/json" }));
    form.append(upload.mainModule, new Blob([upload.code], { type: "application/javascript+module" }), upload.mainModule);
    await unwrap(await this.raw("PUT", `/accounts/${accountId}/workers/scripts/${name}`, { body: form }));
  }

  async enableWorkersDev(accountId: string, name: string): Promise<void> {
    await this.call("POST", `/accounts/${accountId}/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false });
  }

  async putSecret(accountId: string, script: string, name: string, text: string): Promise<void> {
    await this.call("PUT", `/accounts/${accountId}/workers/scripts/${script}/secrets`, { name, text, type: "secret_text" });
  }

  async deleteSecret(accountId: string, script: string, name: string): Promise<void> {
    await this.call("DELETE", `/accounts/${accountId}/workers/scripts/${script}/secrets/${encodeURIComponent(name)}`);
  }

  async listSecretNames(accountId: string, script: string): Promise<string[]> {
    const secrets = await this.call<{ name: string }[]>("GET", `/accounts/${accountId}/workers/scripts/${script}/secrets`);
    return secrets.map((s) => s.name);
  }

  async findKvNamespace(accountId: string, title: string): Promise<string | undefined> {
    const namespaces = await this.call<{ id: string; title: string }[]>("GET", `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
    return namespaces.find((n) => n.title === title)?.id;
  }

  async createKvNamespace(accountId: string, title: string): Promise<string> {
    const { id } = await this.call<{ id: string }>("POST", `/accounts/${accountId}/storage/kv/namespaces`, { title });
    return id;
  }

  /** null when the key doesn't exist. */
  async kvGet(accountId: string, namespaceId: string, key: string): Promise<string | null> {
    const res = await this.raw("GET", kvValuePath(accountId, namespaceId, key));
    if (res.status === 404) return null;
    if (!res.ok) await unwrap(res);
    return res.text();
  }

  async kvPut(accountId: string, namespaceId: string, key: string, value: string): Promise<void> {
    await unwrap(await this.raw("PUT", kvValuePath(accountId, namespaceId, key), { body: value, contentType: "text/plain" }));
  }

  async kvDelete(accountId: string, namespaceId: string, key: string): Promise<void> {
    await unwrap(await this.raw("DELETE", kvValuePath(accountId, namespaceId, key)));
  }

  async kvListKeys(accountId: string, namespaceId: string, prefix: string): Promise<string[]> {
    const params = new URLSearchParams({ prefix, limit: "1000" });
    const keys = await this.call<{ name: string }[]>("GET", `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${params}`);
    return keys.map((k) => k.name);
  }

  /**
   * Opens a real-time log session, the same one `wrangler tail` uses. The
   * returned URL is a WebSocket address that works without further auth, so
   * it must stay on this machine. Needs Workers Scripts Edit or Workers Tail Read.
   */
  async createTail(accountId: string, script: string): Promise<{ id: string; url: string; expiresAt: string }> {
    const t = await this.call<{ id: string; url: string; expires_at: string }>("POST", `/accounts/${accountId}/workers/scripts/${script}/tails`, { filters: [] });
    return { id: t.id, url: t.url, expiresAt: t.expires_at };
  }

  async deleteTail(accountId: string, script: string, id: string): Promise<void> {
    await this.call("DELETE", `/accounts/${accountId}/workers/scripts/${script}/tails/${id}`);
  }

  /** Analytics Engine SQL. The response isn't the usual API envelope. */
  async sql<Row>(accountId: string, query: string): Promise<Row[]> {
    const res = await this.raw("POST", `/accounts/${accountId}/analytics_engine/sql`, { body: `${query} FORMAT JSON`, contentType: "text/plain" });
    const text = await res.text();
    if (!res.ok) throw new CloudflareError(`Analytics query failed: ${text.slice(0, 300)}`, res.status);
    return (JSON.parse(text) as { data: Row[] }).data;
  }
}

function kvValuePath(accountId: string, namespaceId: string, key: string): string {
  return `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // Non-JSON error page; handled below.
  }
  if (!res.ok || !body?.success) {
    const errors = body?.errors ?? [];
    const message = errors.map((e) => e.message).join("; ") || `Cloudflare API returned HTTP ${res.status}`;
    throw new CloudflareError(message, res.status, errors.map((e) => e.code));
  }
  return body.result;
}
