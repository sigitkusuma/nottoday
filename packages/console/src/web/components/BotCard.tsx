/** One bot at a glance: name, status, last activity, counts, routes and a pulse of recent events. */

import type { Bot } from "../bots";
import { useLive } from "../useLive";
import { fmt, timeAgo } from "./ui";
import { Avatar, PulseStrip, StatusPill } from "./parts";

export function BotCard({ bot, showCounts, onOpen }: { bot: Bot; showCounts: boolean; onOpen: () => void }) {
  const live = useLive();
  const { status, totals, app } = bot;
  return (
    <button type="button" className={`bot-card tone-${status.tone}`} onClick={onOpen} aria-label={`${bot.key}: ${status.label}. Open`}>
      <span className="bot-top">
        <Avatar name={bot.key} />
        <span className="bot-title">
          <div className="bot-name">{bot.key}</div>
          <StatusPill tone={status.tone} label={status.label} live={status.health === "receiving"} />
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
        <PulseStrip live={live.events} bot={bot.key} emptyText="" />
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
      <strong>Connect a Slack app</strong>
      <span className="small">Takes about five minutes and checks each step for you.</span>
    </button>
  );
}
