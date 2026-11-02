/** Connect n8n, then see which workflows use the most executions and put Slack-triggered ones behind the gateway. */

import { useState } from "react";
import { api } from "../api";
import { useConfig } from "../config";
import type { Status, TriggerNode, WorkflowUsage } from "../types";
import { Icon, type IconName } from "./icons";
import { PageHead, SecretField, StatusPill } from "./parts";
import type { RouteDraft } from "./RouteEditor";
import { ErrorNotice, Field, fmt, useAction } from "./ui";

export function N8n({ status, onStatusChange, onStartRoute }: { status: Status; onStatusChange: () => void; onStartRoute: (d: RouteDraft) => void }) {
  if (!status.n8n) return <Connect onDone={onStatusChange} />;
  return <Usage baseUrl={status.n8n.baseUrl} onDisconnect={onStatusChange} onStartRoute={onStartRoute} />;
}

const PERKS: [IconName, string, string][] = [
  ["activity", "See what costs the most", "Executions per workflow over the last 7 or 30 days, busiest first."],
  ["workflow", "Pick a workflow instead of pasting a URL", "Routes can choose a Slack Trigger or Webhook from a list."],
  ["list", "Copy data tables into lists", "A list of who's on call can match the n8n table your workflow checks."],
];

function Connect({ onDone }: { onDone: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const action = useAction();
  return (
    <>
      <PageHead title="Connect n8n" sub="Optional, but it's how you find what to fix. Routing works without it." />
      <div className="split">
        <form
          className="block"
          aria-labelledby="n8n-connect"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => (await api("POST", "/n8n", { baseUrl, apiKey }), onDone()));
          }}
        >
          <h3 id="n8n-connect">Your n8n instance</h3>
          <Field label="n8n address" hint="For n8n Cloud: https://<name>.app.n8n.cloud">
            <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-name.app.n8n.cloud" required />
          </Field>
          <SecretField label="API key" value={apiKey} onChange={setApiKey} required hint="In n8n: Settings → n8n API → Create an API key. Paid Cloud plans and self-hosted only. Stored only on this computer." />
          <ErrorNotice error={action.error} />
          <button type="submit" className="btn primary" disabled={action.busy}>
            {action.busy ? "Checking…" : "Connect"}
          </button>
        </form>
        <aside className="block perks" aria-label="What connecting gives you">
          <h3>What you get</h3>
          <ul>
            {PERKS.map(([icon, title, text]) => (
              <li key={title}>
                <span className="tile-icon" aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <span>
                  <b>{title}</b>
                  <span className="muted small">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}

function Usage({ baseUrl, onDisconnect, onStartRoute }: { baseUrl: string; onDisconnect: () => void; onStartRoute: (d: RouteDraft) => void }) {
  const { config } = useConfig();
  const [days, setDays] = useState<7 | 30>(30);
  const [usage, setUsage] = useState<{ workflows: WorkflowUsage[]; total: number; truncated: boolean } | null>(null);
  const action = useAction();

  const routed = new Set(Object.values(config?.apps ?? {}).flatMap((a) => a.routes.map((r) => r.forwardTo)));
  const routable = (t: TriggerNode) => t.kind === "slack" || t.kind === "webhook";

  const load = (d: 7 | 30) => {
    setDays(d);
    void action.run(async () => setUsage(await api("GET", `/n8n/usage?days=${d}`)));
  };

  const rows = usage?.workflows.filter((w) => w.executions > 0 || w.triggers.some((t) => t.kind === "slack")) ?? [];
  const top = Math.max(1, ...rows.map((w) => w.executions));

  return (
    <>
      <PageHead
        title="n8n executions"
        sub="Workflows started by a Slack Trigger often run on every message in every channel the bot is in. Those are the ones the gateway can cut down."
        actions={
          <>
            <StatusPill tone="ok" label={`Connected · ${hostOf(baseUrl)}`} />
            <button type="button" className="btn sm" onClick={() => void api("DELETE", "/n8n").then(onDisconnect)}>
              Disconnect
            </button>
          </>
        }
      />

      <div className="feed-bar">
        <div className="seg" role="group" aria-label="Period">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" aria-pressed={d === days} onClick={() => load(d)} disabled={action.busy}>
              Last {d} days
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" disabled={action.busy} onClick={() => load(days)}>
          {action.busy ? "Counting executions…" : usage ? "Count again" : "Count executions"}
        </button>
      </div>
      <ErrorNotice error={action.error} />
      {action.busy && !usage && <p className="muted">Reading the execution list from n8n. Busy instances take a minute.</p>}

      {!usage && !action.busy && (
        <div className="card empty">
          <h3>Nothing counted yet</h3>
          <p style={{ maxWidth: "52ch", margin: "0 auto" }}>Count executions to see which workflows use the most, and which of them you can put behind the gateway.</p>
        </div>
      )}

      {usage && (
        <>
          <div className="kpis">
            <div className="kpi primary">
              <div className="kpi-label">Executions · last {days} days</div>
              <div className="kpi-value">{fmt(usage.total)}</div>
              <div className="kpi-note">
                Counted from the executions n8n kept; if your instance deletes old or successful ones, the real number is higher.
                {usage.truncated && " Stopped counting at 50,000."}
              </div>
            </div>
          </div>

          <ol className="rank" aria-label="Workflows by executions">
            {rows.map((w) => {
              const triggers = w.triggers.filter(routable);
              return (
                <li key={w.workflowId} className="rank-row">
                  <div className="rank-main">
                    <span className="rank-name">
                      {w.workflowName}
                      {!w.active && <span className="badge off">inactive</span>}
                    </span>
                    <span className="rank-count num">
                      {fmt(w.executions)}
                      <span className="muted small"> · {usage.total ? `${Math.round((w.executions / usage.total) * 100)}%` : "—"}</span>
                    </span>
                  </div>
                  <div className="share-bar" aria-hidden="true">
                    <i style={{ width: `${(w.executions / top) * 100}%` }} />
                  </div>
                  <div className="rank-triggers small">
                    {triggers.length === 0 && <span className="muted">Not a Slack or webhook trigger</span>}
                    {triggers.map((t) => (
                      <span key={t.url} className="rank-trigger">
                        {t.nodeName} <span className="muted">({t.kind === "slack" ? "Slack Trigger" : "Webhook"})</span>
                        {routed.has(t.url) ? (
                          <span className="pill ok">Behind the gateway</span>
                        ) : (
                          <button type="button" className="btn sm" onClick={() => onStartRoute({ forwardTo: t.url, events: t.suggestedEvents, name: slug(w.workflowName) })}>
                            Add a route
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          {Object.keys(config?.apps ?? {}).length === 0 && <p className="hint">To add a route you first need a Slack app: add the one whose events start the workflow under Bots.</p>}
        </>
      )}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
