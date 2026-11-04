/** What opens under a row in Activity: what happened, why, the route-by-route decisions and where to act on it. */

import { explainEvent, routeResult } from "../activityExplain";
import type { GoTo } from "../App";
import { eventTone } from "../botHealth";
import { reasonText } from "../routeSummary";
import { sourceInfo } from "../sources";
import type { LiveEvent } from "../useLive";
import { CopyButton, timeAgo } from "./ui";

const SOURCE = (e: LiveEvent) => (e.source === "github" || e.source === "telegram" || e.source === "webhook" ? e.source : "slack");

export function ActivityDetail({ e, appHasRoutes, goTo }: { e: LiveEvent; appHasRoutes: boolean; goTo: GoTo }) {
  const why = explainEvent(e, { appHasRoutes });
  const tone = eventTone(e).tone;
  const info = sourceInfo(SOURCE(e));
  const routes = e.routes ?? [];
  const event = [e.type, e.subtype].filter(Boolean).join(" / ");

  return (
    <div className={`activity-detail tone-${tone}`}>
      <div className="detail-why">
        <strong>{why.headline}</strong>
        {why.why.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {why.action && (
          <button type="button" className="btn sm" onClick={() => goTo(why.action!.path as Parameters<GoTo>[0])}>
            {why.action.label}
          </button>
        )}
      </div>

      <div className="detail-cols">
        <dl className="kv small detail-facts">
          <dt>When</dt>
          <dd>
            {new Date(e.time).toLocaleString()} <span className="muted">({timeAgo(e.time)})</span>
          </dd>
          {e.app && (
            <>
              <dt>App</dt>
              <dd>
                {e.app} <span className="muted">· {info.label}</span>
              </dd>
            </>
          )}
          {event && (
            <>
              <dt>{info.noun === "event" ? "Event" : "Type"}</dt>
              <dd className="mono">{event}</dd>
            </>
          )}
          {e.channel && (
            <>
              <dt>{SOURCE(e) === "slack" ? "Channel" : "Source"}</dt>
              <dd>
                <span className="mono">{e.channel}</span> <CopyButton value={e.channel} label="Copy" className="btn sm" />
              </dd>
            </>
          )}
          {e.retry && (
            <>
              <dt>{info.sender} retry</dt>
              <dd>
                number {e.retry}
                {e.retryReason ? ` (${e.retryReason})` : ""}
                <div className="muted">{info.sender} sends it again when it didn't get a reply in time. It's handled like any other request.</div>
              </dd>
            </>
          )}
          <dt>Detail</dt>
          <dd className="muted">{e.fromStats ? "From stats: the subtype, retry and number of tries are only known for live requests." : "Live: as the gateway handled it."}</dd>
        </dl>

        {routes.length > 0 && (
          <div className="detail-routes">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Filters</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={`${r.route}-${i}`}>
                    <th scope="row">
                      {r.route} <span className={`badge ${r.mode === "shadow" ? "shadow" : "enforce"}`}>{r.mode === "shadow" ? "shadow" : "enforce"}</span>
                    </th>
                    <td>{r.filter === "fail" ? `Failed: ${reasonText(r.reason, SOURCE(e)) || "a filter"}` : r.filter === "pass" ? "Passed" : "—"}</td>
                    <td>
                      {routeResult(r)}
                      {r.error && <div className="muted">Error: {r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="hint detail-note">Message text is never recorded, so it can't be shown here.</p>
    </div>
  );
}
