/**
 * Activity: every request your apps send to the gateway and what happened to it,
 * as it happens. Real time comes from a Cloudflare tail session; if that isn't
 * available, the page falls back to stats, which lag a minute or two.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { eventTone, type PulseTone } from "../botHealth";
import { useConfig } from "../config";
import type { RecentDecision } from "../types";
import { useLive, type LiveEvent } from "../useLive";
import { Icon } from "./icons";
import { describe } from "./LiveCheck";
import { Empty, PageHead, PulseLegend, StatusPill } from "./parts";
import { ErrorNotice, timeAgo, useAction } from "./ui";

const SHORT: Record<PulseTone, string> = { sent: "Sent to n8n", saved: "Dropped", shadow: "Shadow", bad: "Rejected", info: "URL check" };

type Filter = "all" | PulseTone;
const FILTERS: [Filter, string][] = [
  ["all", "Everything"],
  ["sent", "Sent to n8n"],
  ["saved", "Dropped"],
  ["shadow", "Shadow"],
  ["bad", "Rejected"],
];

export function Live() {
  const live = useLive();
  const { config } = useConfig();
  const [bot, setBot] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [paused, setPaused] = useState(false);
  const frozen = useRef<LiveEvent[]>([]);
  if (!paused) frozen.current = live.events;
  const source = paused ? frozen.current : live.events;

  const rows = useMemo(
    () => source.filter((e) => (!bot || e.app === bot) && (filter === "all" || eventTone(e).tone === filter)),
    [source, bot, filter],
  );
  const behind = paused ? live.events.length - frozen.current.length : 0;

  // Rows that arrived after the page opened get a brief highlight.
  const [openedAt] = useState(() => Date.now());

  return (
    <div className="page">
      <PageHead
        title="Activity"
        sub="Every request your apps send to the gateway and what happened to it. Message text is never shown or recorded."
        actions={
          <StatusPill
            tone={live.state === "live" ? "ok" : live.state === "connecting" ? "idle" : "warn"}
            live={live.state === "live"}
            label={live.state === "live" ? "Live" : live.state === "connecting" ? "Connecting…" : "Real time unavailable"}
          />
        }
      />

      {live.state === "unavailable" ? (
        <>
          <div className="notice warn small">{live.message} Showing stats instead: they appear a minute or two after each request.</div>
          <FromStats />
        </>
      ) : (
        <>
          <div className="feed-bar">
            <select aria-label="Show one app" value={bot} onChange={(e) => setBot(e.target.value)}>
              <option value="">All apps</option>
              {Object.keys(config?.apps ?? {}).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <div className="seg" role="group" aria-label="Show">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn sm" onClick={() => setPaused(!paused)} aria-pressed={paused}>
              <Icon name={paused ? "play" : "pause"} size={14} /> {paused ? (behind > 0 ? `Resume (${behind} new)` : "Resume") : "Pause"}
            </button>
            <PulseLegend />
          </div>

          {rows.length === 0 ? (
            <Empty title={source.length === 0 ? (live.state === "connecting" ? "Connecting to the gateway…" : "Waiting for the next request") : "Nothing matches this filter"}>
              {source.length === 0 ? "Send something from a connected app, e.g. a Slack message. It shows up here within a second or two." : "Change the app or the filter above to see more."}
            </Empty>
          ) : (
            <div className="feed" aria-live={paused ? "off" : "polite"}>
              {rows.map((e, i) => {
                const t = eventTone(e);
                return (
                  <div className={`feed-row${!paused && Date.parse(e.time) > openedAt ? " new" : ""}`} key={`${e.time}-${i}`}>
                    <span className="t">{new Date(e.time).toLocaleTimeString()}</span>
                    <span className="who">{e.app ?? "—"}</span>
                    <span className="what">
                      {describe(e)}
                      {e.channel && <small className="mono">{e.channel}</small>}
                    </span>
                    <span className={`pill ${t.tone === "bad" ? "bad" : t.tone === "shadow" ? "warn" : t.tone === "info" ? "" : "ok"}`}>{SHORT[t.tone]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FromStats() {
  const [rows, setRows] = useState<RecentDecision[] | null>(null);
  const action = useAction();
  const load = () => action.run(async () => setRows((await api<{ decisions: RecentDecision[] }>("GET", "/stats/recent")).decisions));

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <ErrorNotice error={action.error} />
      {rows && rows.length === 0 && <Empty title="Nothing in the last 24 hours">Is the app's webhook URL pointing at the gateway?</Empty>}
      {rows && rows.length > 0 && (
        <div className="feed">
          {rows.map((r, i) => (
            <div className="feed-row" key={`${r.time}-${i}`}>
              <span className="t">{timeAgo(r.time)}</span>
              <span className="who">{r.app}</span>
              <span className="what">
                {r.outcome === "dropped" ? `Dropped (${r.reason})` : r.mode === "shadow" && r.filter === "fail" ? `Forwarded, would drop (${r.reason})` : r.outcome}
                <small>
                  {[r.route, [r.kind, r.type].filter(Boolean).join(": ")].filter(Boolean).join(" · ")}
                </small>
              </span>
              <span className="small faint">{r.status ? `n8n ${r.status}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
