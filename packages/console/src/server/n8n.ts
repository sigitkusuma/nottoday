/**
 * n8n public API (v1): find which workflows use the most executions, build the
 * production URL of their trigger nodes, and read data tables for list sync.
 * Auth: an API key from n8n Settings → n8n API (paid Cloud plans and self-hosted).
 */

export class N8nError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface N8nNode {
  name: string;
  type: string;
  disabled?: boolean;
  webhookId?: string;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes?: N8nNode[];
}

export interface TriggerNode {
  workflowId: string;
  workflowName: string;
  nodeName: string;
  kind: "slack" | "webhook";
  /** Production URL; the route's forwardTo. */
  url: string;
  /** Slack event types the Slack Trigger listens to, to prefill the route. */
  suggestedEvents?: string[];
}

export interface WorkflowUsage {
  workflowId: string;
  workflowName: string;
  active: boolean;
  executions: number;
  triggers: TriggerNode[];
}

/** Slack Trigger "trigger" options → Slack event types. */
const SLACK_TRIGGER_EVENTS: Record<string, string> = {
  any_event: "*",
  app_mention: "app_mention",
  file_share: "message",
  file_public: "file_public",
  message: "message",
  channel_created: "channel_created",
  team_join: "team_join",
  reaction_added: "reaction_added",
};

const PAGE = 250;
/** Stops runaway paging on very busy instances: 200 pages = 50,000 executions. */
const MAX_PAGES = 200;

export function normalizeBaseUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Use the https:// address of your n8n instance.");
  }
  return url.origin + url.pathname.replace(/\/(api\/v1\/?)?$/, "").replace(/\/+$/, "");
}

export class N8nApi {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
    const res = await this.fetchImpl(url, { headers: { "x-n8n-api-key": this.apiKey, accept: "application/json" } });
    if (!res.ok) {
      const hint = res.status === 401 ? " Check the API key." : res.status === 404 ? " Is this the right n8n address, and is its public API enabled?" : "";
      throw new N8nError(`n8n API returned HTTP ${res.status} for ${path}.${hint}`, res.status);
    }
    return (await res.json()) as T;
  }

  private async *pages<T>(path: string, params: Record<string, string> = {}): AsyncGenerator<T[]> {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.get<{ data: T[]; nextCursor?: string | null }>(path, { ...params, limit: String(PAGE), ...(cursor ? { cursor } : {}) });
      yield body.data;
      if (!body.nextCursor) return;
      cursor = body.nextCursor;
    }
  }

  async verify(): Promise<void> {
    await this.get("/workflows", { limit: "1" });
  }

  async workflows(): Promise<N8nWorkflow[]> {
    const all: N8nWorkflow[] = [];
    for await (const page of this.pages<N8nWorkflow>("/workflows")) all.push(...page);
    return all;
  }

  /** Slack Trigger and Webhook nodes, with the production URL the gateway should forward to. */
  triggersOf(workflow: N8nWorkflow): TriggerNode[] {
    const out: TriggerNode[] = [];
    for (const node of workflow.nodes ?? []) {
      if (node.disabled) continue;
      const base = { workflowId: workflow.id, workflowName: workflow.name, nodeName: node.name };
      if (node.type === "n8n-nodes-base.slackTrigger" && node.webhookId) {
        const triggers = node.parameters?.trigger;
        const events = Array.isArray(triggers) ? [...new Set(triggers.map((t) => SLACK_TRIGGER_EVENTS[String(t)]).filter(Boolean))] : [];
        out.push({ ...base, kind: "slack", url: `${this.baseUrl}/webhook/${node.webhookId}/webhook`, suggestedEvents: events.length ? events : undefined });
      } else if (node.type === "n8n-nodes-base.webhook") {
        const path = String(node.parameters?.path ?? node.webhookId ?? "").replace(/^\/+/, "");
        if (path) out.push({ ...base, kind: "webhook", url: `${this.baseUrl}/webhook/${path}` });
      }
    }
    return out;
  }

  /** Executions per workflow since `since`, busiest first. Only executions n8n kept are counted. */
  async usage(since: Date): Promise<{ workflows: WorkflowUsage[]; total: number; truncated: boolean }> {
    const counts = new Map<string, number>();
    let total = 0;
    let pagesRead = 0;
    for await (const page of this.pages<{ workflowId: string }>("/executions", { startedAfter: since.toISOString(), includeData: "false" })) {
      pagesRead++;
      for (const e of page) {
        counts.set(e.workflowId, (counts.get(e.workflowId) ?? 0) + 1);
        total++;
      }
    }
    const workflows = await this.workflows();
    const usage = workflows.map((w) => ({
      workflowId: w.id,
      workflowName: w.name,
      active: w.active,
      executions: counts.get(w.id) ?? 0,
      triggers: this.triggersOf(w),
    }));
    return { workflows: usage.sort((a, b) => b.executions - a.executions), total, truncated: pagesRead >= MAX_PAGES };
  }

  async dataTables(): Promise<{ id: string; name: string; columns: string[] }[]> {
    const tables: { id: string; name: string; columns?: { name: string }[] }[] = [];
    for await (const page of this.pages<{ id: string; name: string; columns?: { name: string }[] }>("/data-tables")) tables.push(...page);
    return tables.map((t) => ({ id: t.id, name: t.name, columns: (t.columns ?? []).map((c) => c.name) }));
  }

  /** Distinct non-empty values of one column, e.g. the user IDs in an "On call" table. */
  async columnValues(tableId: string, column: string): Promise<string[]> {
    const values = new Set<string>();
    for await (const page of this.pages<Record<string, unknown>>(`/data-tables/${encodeURIComponent(tableId)}/rows`)) {
      for (const row of page) {
        const v = row[column];
        if (typeof v === "string" && v.trim() !== "") values.add(v.trim());
        else if (typeof v === "number") values.add(String(v));
      }
    }
    return [...values];
  }
}
