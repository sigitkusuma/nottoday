/**
 * The setup spine: six steps from "connected" to "first route enforced", each
 * with its status from real data and the one action that completes it. Shown
 * until everything is done or skipped, then folded into one line.
 */

import { useState } from "react";
import { api } from "../api";
import type { GoTo } from "../App";
import type { AppSignal, GatewayConfig, Status } from "../types";
import { Icon } from "./icons";
import { CopyField, ErrorNotice, useAction } from "./ui";

type StepState = "done" | "todo" | "skipped";

interface Step {
  id: string;
  title: string;
  state: StepState;
  optional?: boolean;
  /** One line saying what's true now or what to do. */
  detail: string;
  action?: { label: string; onClick: () => void };
  body?: React.ReactNode;
}

const SKIP_KEY = "gw-setup-skipped";
const HIDE_KEY = "gw-setup-hidden";

// Per-viewer convenience only; the page works without storage.
function readList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function writeList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: skipping just won't be remembered.
  }
}

export function SetupChecklist({
  status,
  config,
  signals,
  goTo,
  onStatusChange,
}: {
  status: Status;
  config: GatewayConfig | null;
  signals: AppSignal[];
  goTo: GoTo;
  onStatusChange: () => void;
}) {
  const [skipped, setSkipped] = useState<string[]>(() => readList(SKIP_KEY));
  const [hidden, setHidden] = useState<boolean>(() => readList(HIDE_KEY).includes("all"));
  // When every step is done the card folds away by itself; this lets people open it again.
  const [reopened, setReopened] = useState(false);
  const gw = status.gateway!;
  const apps = Object.entries(config?.apps ?? {});
  const routes = apps.flatMap(([, a]) => a.routes);
  // Only apps that still exist: stats keep history for apps that were removed.
  const liveSignals = signals.filter((s) => config && Object.hasOwn(config.apps, s.app));
  const receiving = liveSignals.some((s) => s.lastRequest && s.lastRequest !== s.lastVerified);

  const skip = (id: string) => {
    const next = [...new Set([...skipped, id])];
    setSkipped(next);
    writeList(SKIP_KEY, next);
  };
  const state = (done: boolean, id: string): StepState => (done ? "done" : skipped.includes(id) ? "skipped" : "todo");

  const steps: Step[] = [
    {
      id: "cloudflare",
      title: "Connect Cloudflare",
      state: "done",
      detail: `Account ${status.cloudflare?.accountName ?? ""}`.trim(),
    },
    {
      id: "install",
      title: "Install the gateway",
      state: gw.health.reachable ? "done" : "todo",
      detail: gw.health.reachable ? `Running at ${gw.url}` : `Not answering at ${gw.url} yet. It can take a minute after installing.`,
    },
    {
      id: "stats",
      title: "Turn on stats",
      optional: true,
      state: state(gw.statsEnabled, "stats"),
      detail: gw.statsEnabled ? "Counting forwarded and dropped requests." : "Optional, free. Shows how many executions the gateway saves. Routing works without it.",
      body: gw.statsEnabled ? undefined : <StatsSteps url={gw.analyticsEngineUrl} dataset={gw.dataset} onDone={onStatusChange} />,
    },
    {
      id: "n8n",
      title: "Connect n8n",
      optional: true,
      state: state(Boolean(status.n8n), "n8n"),
      detail: status.n8n ? `Connected to ${status.n8n.baseUrl}` : "Optional. Lets you pick workflows from a list and see which ones use the most executions.",
      action: status.n8n ? undefined : { label: "Connect n8n", onClick: () => goTo("n8n") },
    },
    {
      id: "slack",
      title: "Connect a Slack app",
      state: receiving ? "done" : "todo",
      detail: receiving
        ? `Receiving events from ${liveSignals.filter((s) => s.lastRequest && s.lastRequest !== s.lastVerified).map((s) => s.app).join(", ")}.`
        : apps.length
          ? "Added, but no Slack event has arrived yet. Open the app to run the live check."
          : "Add the Slack app whose events start your n8n workflow.",
      action: { label: apps.length ? "Open Bots" : "Connect a Slack app", onClick: () => goTo(apps.length ? "apps" : "apps/new") },
    },
    {
      id: "route",
      title: "Add a route, test it, then enforce",
      state: routes.some((r) => (r.mode ?? "enforce") === "enforce" && r.enabled !== false) ? "done" : "todo",
      detail: routes.length === 0
        ? "Tell the gateway which messages your workflow needs. New routes start in shadow mode."
        : routes.some((r) => (r.mode ?? "enforce") === "enforce")
          ? "At least one route is enforcing: executions are being saved."
          : "Your route is in shadow mode: post a few test messages, check Activity, then switch it to enforce on the bot page.",
      action: routes.length === 0 ? { label: "Add a route", onClick: () => goTo("apps") } : { label: "Open Activity", onClick: () => goTo("live") },
    },
  ];

  const remaining = steps.filter((s) => s.state === "todo");
  const doneCount = steps.filter((s) => s.state === "done").length;
  const current = remaining[0];

  if ((hidden || remaining.length === 0) && !reopened) {
    return (
      <div className="setup-done row">
        <span className={remaining.length ? "muted" : "status-ok"}>
          {remaining.length ? `Setup: ${doneCount} of ${steps.length} steps done.` : "Setup complete."}
        </span>
        <button
          type="button"
          className="btn link"
          onClick={() => {
            setHidden(false);
            setReopened(true);
            writeList(HIDE_KEY, []);
          }}
        >
          Show setup steps
        </button>
      </div>
    );
  }

  return (
    <section className="panel setup-card" aria-labelledby="setup-title">
      <div className="spread">
        <h3 id="setup-title">Finish setting up</h3>
        <span className="muted small num">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="checklist">
        {steps.map((s, i) => (
          <li key={s.id} className={`check-item ${s.state}${s === current ? " current" : ""}`} aria-current={s === current ? "step" : undefined}>
            <span className="check-mark" aria-hidden="true">
              {s.state === "done" ? <Icon name="check" size={14} /> : s.state === "skipped" ? "–" : i + 1}
            </span>
            <div className="check-body">
              <div className="check-title">
                {s.title}
                {s.optional && <span className="muted small"> · optional</span>}
                <span className="visually-hidden">{s.state === "done" ? " (done)" : s.state === "skipped" ? " (skipped)" : " (to do)"}</span>
              </div>
              <div className="muted small">{s.detail}</div>
              {s === current && s.body}
              {s === current && (s.action || s.optional) && (
                <div className="row" style={{ marginTop: 8 }}>
                  {s.action && (
                    <button type="button" className="btn primary" onClick={s.action.onClick}>
                      {s.action.label}
                    </button>
                  )}
                  {s.optional && (
                    <button type="button" className="btn" onClick={() => skip(s.id)}>
                      Skip for now
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn link small"
        onClick={() => {
          setHidden(true);
          setReopened(false);
          writeList(HIDE_KEY, ["all"]);
        }}
      >
        Hide setup steps
      </button>
    </section>
  );
}

function StatsSteps({ url, dataset, onDone }: { url: string; dataset: string; onDone: () => void }) {
  const action = useAction();
  return (
    <div style={{ marginTop: 8 }}>
      <ol className="steps">
        <li>
          <a href={url} target="_blank" rel="noreferrer">
            Open Analytics Engine in Cloudflare
          </a>{" "}
          and choose to create a dataset. Creating one is what switches Analytics Engine on for your account.
        </li>
        <li>
          Use these values. Cloudflare says the dataset appears only after the Worker sends data; that's expected.
          <div className="copy-pair">
            <span className="small">Dataset name</span>
            <CopyField value={dataset} label="Dataset name" />
            <span className="small">Dataset binding</span>
            <CopyField value="STATS" label="Dataset binding" />
          </div>
        </li>
        <li>Come back and turn stats on. This re-uploads the gateway with the binding; routing keeps working throughout.</li>
      </ol>
      <ErrorNotice error={action.error} />
      <button
        type="button"
        className="btn primary"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const r = await api<{ statsEnabled: boolean }>("POST", "/gateway/upgrade");
            if (!r.statsEnabled) throw new Error("Cloudflare still reports Analytics Engine as off. Create the dataset at the link above, then try again.");
            onDone();
          })
        }
      >
        {action.busy ? "Turning on…" : "Turn on stats"}
      </button>
    </div>
  );
}
