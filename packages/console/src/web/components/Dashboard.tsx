/**
 * Home: how many n8n executions the gateway saves, anything that needs a look,
 * and every connected app as a card with its live status.
 */

import { api } from "../api";
import { useBots } from "../bots";
import type { GoTo } from "../App";
import { useConfig } from "../config";
import { RANGES, rangeLabel, useStats } from "../stats";
import type { Status } from "../types";
import { useLive } from "../useLive";
import { describe } from "./LiveCheck";
import { AddBotCard, BotCard } from "./BotCard";
import { Icon } from "./icons";
import { Empty, PageHead, PulseLegend, StatusPill } from "./parts";
import { SetupChecklist } from "./SetupChecklist";
import { ErrorNotice, fmt, timeAgo, useAction } from "./ui";

export function Dashboard({ status, onStatusChange, goTo }: { status: Status; onStatusChange: () => void; goTo: GoTo }) {
  const { config, errors: configErrors } = useConfig();
  const stats = useStats();
  const live = useLive();
  const bots = useBots();
  const gw = status.gateway!;

  const routes = stats.routes ?? [];
  const saved = routes.reduce((n, r) => n + r.dropped, 0);
  const sent = routes.reduce((n, r) => n + r.forwarded, 0);
  const received = routes.reduce((n, r) => n + r.received, 0);
  const wouldSave = bots.reduce((n, b) => n + b.totals.wouldSave, 0);
  const healthy = bots.filter((b) => b.status.tone === "ok").length;
  const needs = bots.filter((b) => b.status.tone !== "ok");

  const problems: { text: string; action?: { label: string; onClick: () => void } }[] = [];
  if (!gw.health.reachable) problems.push({ text: `The gateway at ${gw.url} isn't answering. It can take a minute after installing.` });
  for (const e of configErrors) problems.push({ text: `Stored config problem: ${e}` });

  return (
    <div className="page">
      <PageHead
        title="Dashboard"
        sub="What the gateway has saved you, and whether every app is working."
        actions={
          gw.statsEnabled && (
            <>
              <div className="seg" role="group" aria-label="Time range">
                {RANGES.map((d) => (
                  <button key={d} type="button" aria-pressed={d === stats.days} onClick={() => stats.setDays(d)}>
                    {d === 1 ? "24h" : `${d}d`}
                  </button>
                ))}
              </div>
            </>
          )
        }
      />

      <SetupChecklist status={status} config={config} signals={stats.signals} goTo={goTo} onStatusChange={onStatusChange} />

      {gw.upgradeAvailable && <UpgradeStrip current={gw.health.version ?? "?"} next={gw.bundledVersion} onDone={onStatusChange} />}

      {(problems.length > 0 || needs.some((b) => b.status.tone === "bad")) && (
        <section className="attention" role="status" aria-labelledby="attn">
          <h3 id="attn">
            <Icon name="alert" size={16} /> Needs attention
          </h3>
          <ul>
            {problems.map((p) => (
              <li key={p.text}>{p.text}</li>
            ))}
            {needs
              .filter((b) => b.status.tone === "bad")
              .map((b) => (
                <li key={b.key}>
                  <span>
                    <strong>{b.key}</strong>: {b.status.detail}
                  </span>
                  <button type="button" className="btn sm" onClick={() => goTo(`apps/${b.key}`)}>
                    Fix it
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="kpis">
        {gw.statsEnabled ? (
          <>
            <div className="kpi primary">
              <div className="kpi-label">n8n executions saved · {rangeLabel(stats.days)}</div>
              <div className="kpi-value">{stats.routes ? fmt(saved) : "…"}</div>
              <div className="kpi-note">{wouldSave > 0 ? `+${fmt(wouldSave)} more once shadow routes are enforced` : "Requests dropped before n8n"}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Sent to n8n</div>
              <div className="kpi-value">{stats.routes ? fmt(sent) : "…"}</div>
              <div className="kpi-note">of {fmt(received)} requests matched a route</div>
            </div>
          </>
        ) : (
          <div className="kpi">
            <div className="kpi-label">Executions saved</div>
            <div className="kpi-value">–</div>
            <div className="kpi-note">Turn on stats in Setup to count them</div>
          </div>
        )}
        <div className="kpi">
          <div className="kpi-label">Apps working</div>
          <div className="kpi-value">
            {healthy}
            <span className="faint" style={{ fontSize: 18 }}> / {bots.length}</span>
          </div>
          <div className="kpi-note">{needs.length === 0 ? "All good" : `${needs.length} need a look`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Gateway</div>
          <div className="kpi-value" style={{ fontSize: 20, paddingTop: 6 }}>
            <StatusPill tone={gw.health.reachable ? "ok" : "bad"} label={gw.health.reachable ? "Online" : "Not answering"} live={gw.health.reachable} />
          </div>
          <div className="kpi-note">Engine {gw.health.version ?? "unknown"}</div>
        </div>
      </div>

      <ErrorNotice error={stats.error} />

      <div className="spread" style={{ margin: "6px 0 10px" }}>
        <h3 style={{ margin: 0 }}>Your apps</h3>
        <PulseLegend />
      </div>
      <div className="bot-grid">
        {bots.map((b) => (
          <BotCard key={b.key} bot={b} showCounts={gw.statsEnabled} onOpen={() => goTo(`apps/${b.key}`)} />
        ))}
        <AddBotCard onClick={() => goTo("apps/new")} />
      </div>
      {gw.statsEnabled && (
        <p className="hint" style={{ marginTop: -6 }}>
          Counts are estimates: Cloudflare samples bursts and scales the counts back up. They lag a minute or two; the squares and the activity feed are real time.
        </p>
      )}

      <div className="spread" style={{ margin: "18px 0 10px" }}>
        <h3 style={{ margin: 0 }}>Latest activity</h3>
        <button type="button" className="btn link" onClick={() => goTo("live")}>
          Open full feed
        </button>
      </div>
      {live.events.length === 0 ? (
        <Empty title={live.state === "unavailable" ? "Live activity isn't available" : "Waiting for the next request"}>
          {live.state === "unavailable"
            ? `${live.message ?? ""} The Activity page falls back to stats, which lag a minute or two.`
            : "Send something from a connected app, e.g. a Slack message or a GitHub push. It appears here within a second or two."}
        </Empty>
      ) : (
        <div className="feed">
          {live.events.slice(0, 6).map((e, i) => (
            <div className="feed-row" key={`${e.time}-${i}`}>
              <span className="t">{new Date(e.time).toLocaleTimeString()}</span>
              <span className="who">{e.app ?? "—"}</span>
              <span className="what">{describe(e)}</span>
              <span className="small faint">{timeAgo(e.time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpgradeStrip({ current, next, onDone }: { current: string; next: string; onDone: () => void }) {
  const action = useAction();
  return (
    <div className="notice warn row" style={{ justifyContent: "space-between" }}>
      <span>
        A newer gateway engine is available: {current} → <strong>{next}</strong>. Routing keeps working while it upgrades.
      </span>
      <span className="row">
        <ErrorNotice error={action.error} />
        <button type="button" className="btn sm" disabled={action.busy} onClick={() => void action.run(async () => (await api("POST", "/gateway/upgrade"), onDone()))}>
          {action.busy ? "Upgrading…" : "Upgrade"}
        </button>
      </span>
    </div>
  );
}
