/** One app at a glance: name, kind, status, last activity, counts, routes and a pulse of recent events. */

import type { Bot } from "../bots";
import { useLive } from "../useLive";
import { fmt, timeAgo } from "./ui";
import { sourceOf } from "@gw/shared";
import { sourceInfo } from "../sources";
import { Icon } from "./icons";
import { Avatar, PulseStrip, StatusPill } from "./parts";

/** `pulses` is off for an app of another account: the live stream belongs to the active one, and app names can repeat across accounts. */
export function BotCard({ bot, showCounts, onOpen, pulses = true }: { bot: Bot; showCounts: boolean; onOpen: () => void; pulses?: boolean }) {
  const live = useLive();
  const { status, totals, app } = bot;
  const info = sourceInfo(sourceOf(app));
  return (
    <button type="button" className={`bot-card tone-${status.tone}`} onClick={onOpen} aria-label={`${bot.key}, ${info.label}: ${status.label}. Open`}>
      <span className="bot-top">
        <Avatar name={bot.key} />
        <span className="bot-title">
          <div className="bot-name">{bot.key}</div>
          <span className="bot-tags">
            <StatusPill tone={status.tone} label={status.label} live={status.health === "receiving"} />
            <SourceTag source={app.source} />
          </span>
        </span>
      </span>

      {status.tone !== "ok" && <p className="bot-detail">{status.detail}</p>}

      {app.routes.length > 0 && (
        <ul className="bot-routes" aria-label="Routes">
          {app.routes.map((r) => (
            <li key={r.name}>
              {r.name}
              <span className={`badge ${r.enabled === false ? "off" : r.mode === "shadow" ? "shadow" : "enforce"}`}>{r.enabled === false ? "off" : r.mode === "shadow" ? "shadow" : "live"}</span>
            </li>
          ))}
        </ul>
      )}

      <span className="bot-pulse">
        {pulses ? <PulseStrip live={live.events} bot={bot.key} emptyText="" /> : <span />}
        <span className="bot-seen">{bot.seen ? `Last event ${timeAgo(new Date(bot.seen).toISOString())}` : "No events yet"}</span>
      </span>

      {showCounts && (
        <span className="bot-stats">
          <span className="bot-stat">
            <b>{fmt(totals.received)}</b>
            <span>received</span>
          </span>
          <span className="bot-stat">
            <b>{fmt(totals.forwarded)}</b>
            <span>to n8n</span>
          </span>
          <span className="bot-stat">
            <b>{fmt(totals.saved)}</b>
            <span>{totals.wouldSave > 0 ? `saved · +${fmt(totals.wouldSave)} in shadow` : "saved"}</span>
          </span>
        </span>
      )}
    </button>
  );
}

export function AddBotCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="bot-card add" onClick={onClick}>
      <span className="plus" aria-hidden="true">
        +
      </span>
      <strong>Connect an app</strong>
      <span className="small">Takes about five minutes and checks each step for you.</span>
    </button>
  );
}

/** Which kind of app this is: an icon and its name. */
export function SourceTag({ source }: { source?: Parameters<typeof sourceOf>[0]["source"] }) {
  const info = sourceInfo(source);
  return (
    <span className="source-tag">
      <Icon name={info.icon} size={13} />
      {info.label}
    </span>
  );
}
