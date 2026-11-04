/**
 * Activity: every request your apps send to the gateway and what happened to it,
 * as it happens. Real time comes from a Cloudflare tail session; if that isn't
 * available, the page falls back to stats, which lag a minute or two.
 */

import { useMemo, useRef, useState } from "react";
import { eventTone, type PulseTone } from "../botHealth";
import { useConfig } from "../config";
import { useLive, type LiveEvent } from "../useLive";
import type { GoTo } from "../App";
import { ActivityDetail } from "./ActivityDetail";
import { Icon } from "./icons";
import { describe } from "./LiveCheck";
import { Empty, PageHead, PulseLegend, StatusPill } from "./parts";

const SHORT: Record<PulseTone, string> = { sent: "Sent to n8n", saved: "Dropped", shadow: "Shadow", unrouted: "Not routed", error: "n8n error", bad: "Rejected", info: "URL check" };

type Filter = "all" | PulseTone;
const FILTERS: [Filter, string][] = [
  ["all", "Everything"],
  ["sent", "Sent to n8n"],
  ["saved", "Dropped"],
  ["shadow", "Shadow"],
  ["unrouted", "Not routed"],
  ["error", "n8n error"],
  ["bad", "Rejected"],
];

/** The same request keeps the same id while rows arrive above it. */
const eventId = (e: LiveEvent) => [e.time, e.app, e.kind, e.type, e.subtype, e.channel].join("|");

export function Live({ goTo }: { goTo: GoTo }) {
  const live = useLive();
  const { config } = useConfig();
  const [bot, setBot] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [paused, setPaused] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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

      {live.state === "unavailable" && (
        <div className="notice warn small">{live.message} Showing what the stats table has instead: it lags a minute or two behind each request.</div>
      )}
      {live.state === "connecting" && live.message && <div className="notice info small">{live.message} The activity below is kept; new requests appear once it's back.</div>}
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
            const id = eventId(e);
            const open = openId === id;
            const detailId = `activity-detail-${i}`;
            return (
              <div className={`feed-item${open ? " open" : ""}`} key={`${id}-${i}`}>
                <button
                  type="button"
                  className={`feed-row${!paused && Date.parse(e.time) > openedAt ? " new" : ""}`}
                  aria-expanded={open}
                  aria-controls={open ? detailId : undefined}
                  onClick={() => setOpenId(open ? null : id)}
                >
                  <span className="t">{new Date(e.time).toLocaleTimeString()}</span>
                  <span className="who">{e.app ?? "—"}</span>
                  <span className="what">
                    {describe(e)}
                    {e.channel && <small className="mono">{e.channel}</small>}
                  </span>
                  <span className={`pill ${t.tone}`} title={t.title}>
                    {SHORT[t.tone]}
                  </span>
                  <span className="feed-chev" aria-hidden="true">
                    <Icon name="chevron" size={16} />
                  </span>
                </button>
                {open && (
                  <div id={detailId} className="feed-detail">
                    <ActivityDetail e={e} appHasRoutes={Boolean(e.app && (config?.apps[e.app]?.routes.length ?? 0) > 0)} goTo={goTo} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
