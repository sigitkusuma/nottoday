/** In-memory stand-ins for the Cloudflare and n8n APIs, served through one fetch function. */

export interface FakeCloudflare {
  token: string;
  accounts: { id: string; name: string }[];
  /** More tokens, each seeing its own accounts, like tokens from other Cloudflare accounts. */
  otherTokens: Record<string, { id: string; name: string }[]>;
  subdomain: string;
  scripts: Map<string, { metadata: Record<string, unknown>; code: string; workersDev: boolean; secrets: Map<string, string> }>;
  kv: Map<string, { title: string; values: Map<string, string> }>;
  sqlRows: unknown[];
  sqlQueries: string[];
  /** Like a real account that hasn't switched Analytics Engine on. */
  analyticsOff?: boolean;
  /** Tail sessions currently open, by id. */
  tails: Map<string, string>;
  /** Refuse tail sessions, like a token without the permission. */
  tailsForbidden?: boolean;
  /** Like a new account that never opened Workers & Pages. */
  noSubdomain?: boolean;
}

export interface FakeN8n {
  apiKey: string;
  workflows: { id: string; name: string; active: boolean; nodes: unknown[] }[];
  executions: { workflowId: string }[];
  tables: { id: string; name: string; columns: { name: string }[]; rows: Record<string, unknown>[] }[];
}

export function fakeCloudflare(): FakeCloudflare {
  return {
    token: "cf-token",
    accounts: [{ id: "acc1", name: "Acme" }],
    otherTokens: {},
    subdomain: "acme",
    scripts: new Map(),
    kv: new Map(),
    sqlRows: [],
    sqlQueries: [],
    tails: new Map(),
  };
}

export function fakeN8n(): FakeN8n {
  return { apiKey: "n8n-key", workflows: [], executions: [], tables: [] };
}

const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
const fail = (status: number, message: string) => Response.json({ success: false, errors: [{ code: status, message }], result: null }, { status });

export function fakeFetch(cf: FakeCloudflare, n8n?: FakeN8n, healthFor?: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);

    if (url.hostname === "api.cloudflare.com") {
      const bearer = (headers.get("authorization") ?? "").replace("Bearer ", "");
      if (bearer !== cf.token && !cf.otherTokens[bearer]) return fail(401, "Invalid API Token");
      return cloudflareRoute(cf, method, url, init?.body ?? null, cf.otherTokens[bearer]);
    }
    if (n8n && url.hostname === "n8n.test") {
      if (headers.get("x-n8n-api-key") !== n8n.apiKey) return new Response("unauthorized", { status: 401 });
      return n8nRoute(n8n, url);
    }
    if (url.pathname === "/health" && healthFor) return healthFor(url.href);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function cloudflareRoute(cf: FakeCloudflare, method: string, url: URL, body: BodyInit | null, accounts?: { id: string; name: string }[]): Promise<Response> {
  const p = url.pathname.replace("/client/v4", "");
  let m: RegExpExecArray | null;

  if (p === "/user/tokens/verify") return ok({ status: "active" });
  if (p === "/accounts") return ok(accounts ?? cf.accounts);
  if ((m = /^\/accounts\/([^/]+)\/workers\/subdomain$/.exec(p))) return cf.noSubdomain ? fail(404, "This account has not enabled a workers.dev subdomain") : ok({ subdomain: cf.subdomain });
  if ((m = /^\/accounts\/([^/]+)\/workers\/scripts$/.exec(p))) return ok([...cf.scripts.keys()].map((id) => ({ id })));

  if ((m = /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)$/.exec(p)) && method === "PUT") {
    const form = body as FormData;
    const metadata = JSON.parse(await (form.get("metadata") as Blob).text()) as Record<string, unknown>;
    const bindings = metadata.bindings as { type: string }[];
    if (cf.analyticsOff && bindings.some((b) => b.type === "analytics_engine")) {
      return fail(403, "You need to enable Analytics Engine. Head to the Cloudflare Dashboard to enable: https://dash.cloudflare.com/acc1/workers/analytics-engine");
    }
    const code = await (form.get(metadata.main_module as string) as Blob).text();
    const existing = cf.scripts.get(m[1]);
    const keep = (metadata.keep_bindings as string[] | undefined)?.includes("secret_text");
    cf.scripts.set(m[1], { metadata, code, workersDev: existing?.workersDev ?? false, secrets: keep && existing ? existing.secrets : new Map() });
    return ok({ id: m[1] });
  }
  if ((m = /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/subdomain$/.exec(p))) {
    const script = cf.scripts.get(m[1]);
    if (!script) return fail(404, "script not found");
    script.workersDev = true;
    return ok({ enabled: true });
  }
  if ((m = /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/secrets(?:\/([^/]+))?$/.exec(p))) {
    const script = cf.scripts.get(m[1]);
    if (!script) return fail(404, "script not found");
    if (method === "PUT") {
      const { name, text } = JSON.parse(body as string) as { name: string; text: string };
      script.secrets.set(name, text);
      return ok({ name, type: "secret_text" });
    }
    if (method === "DELETE") {
      script.secrets.delete(decodeURIComponent(m[2]));
      return ok(null);
    }
    return ok([...script.secrets.keys()].map((name) => ({ name, type: "secret_text" })));
  }

  if ((m = /^\/accounts\/[^/]+\/storage\/kv\/namespaces$/.exec(p))) {
    if (method === "POST") {
      const { title } = JSON.parse(body as string) as { title: string };
      const id = `ns${cf.kv.size + 1}`;
      cf.kv.set(id, { title, values: new Map() });
      return ok({ id, title });
    }
    return ok([...cf.kv.entries()].map(([id, ns]) => ({ id, title: ns.title })));
  }
  if ((m = /^\/accounts\/[^/]+\/storage\/kv\/namespaces\/([^/]+)\/keys$/.exec(p))) {
    const prefix = url.searchParams.get("prefix") ?? "";
    return ok([...(cf.kv.get(m[1])?.values.keys() ?? [])].filter((k) => k.startsWith(prefix)).map((name) => ({ name })));
  }
  if ((m = /^\/accounts\/[^/]+\/storage\/kv\/namespaces\/([^/]+)\/values\/(.+)$/.exec(p))) {
    const ns = cf.kv.get(m[1]);
    const key = decodeURIComponent(m[2]);
    if (!ns) return fail(404, "namespace not found");
    if (method === "PUT") {
      ns.values.set(key, body as string);
      return ok(null);
    }
    if (method === "DELETE") {
      ns.values.delete(key);
      return ok(null);
    }
    const value = ns.values.get(key);
    return value === undefined ? fail(404, "key not found") : new Response(value);
  }
  if ((m = /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/tails(?:\/([^/]+))?$/.exec(p))) {
    if (cf.tailsForbidden) return fail(403, "Authentication error");
    if (method === "POST") {
      const id = `tail${cf.tails.size + 1}`;
      cf.tails.set(id, m[1]);
      return ok({ id, url: `wss://tail.test/${id}`, expires_at: new Date(Date.now() + 6 * 3600_000).toISOString() });
    }
    if (method === "DELETE") {
      cf.tails.delete(m[2]);
      return ok(null);
    }
  }
  if (/^\/accounts\/[^/]+\/analytics_engine\/sql$/.test(p)) {
    cf.sqlQueries.push(body as string);
    return Response.json({ meta: [], data: cf.sqlRows, rows: cf.sqlRows.length });
  }
  return fail(404, `no fake for ${method} ${p}`);
}

function n8nRoute(n8n: FakeN8n, url: URL): Response {
  const p = url.pathname.replace("/api/v1", "");
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const start = Number(url.searchParams.get("cursor") ?? 0);
  const page = <T>(items: T[]) =>
    Response.json({ data: items.slice(start, start + limit), nextCursor: start + limit < items.length ? String(start + limit) : null });

  if (p === "/workflows") return page(n8n.workflows);
  if (p === "/executions") return page(n8n.executions);
  if (p === "/data-tables") return page(n8n.tables.map(({ id, name, columns }) => ({ id, name, columns })));
  const m = /^\/data-tables\/([^/]+)\/rows$/.exec(p);
  if (m) return page(n8n.tables.find((t) => t.id === m[1])?.rows ?? []);
  return new Response("not found", { status: 404 });
}

/** A stand-in for the tail WebSocket: opens at once and lets the test push messages. */
export class FakeTailSocket extends EventTarget {
  static last: FakeTailSocket | null = null;
  binaryType = "blob";
  sent: string[] = [];
  closed = false;
  constructor(
    readonly url: string,
    readonly protocol?: string,
  ) {
    super();
    FakeTailSocket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  /** Delivers one tail message, as Cloudflare would. */
  emit(message: unknown) {
    const e = new Event("message") as Event & { data: string };
    e.data = JSON.stringify(message);
    this.dispatchEvent(e);
  }
}

/** A tail message carrying the engine's JSON log lines. */
export function tailMessage(...lines: Record<string, unknown>[]) {
  return { outcome: "ok", eventTimestamp: Date.parse("2026-11-02T08:00:00Z"), logs: lines.map((l) => ({ level: "log", message: [JSON.stringify(l)] })), exceptions: [] };
}
