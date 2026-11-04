/**
 * Reads the engine's routing decisions from Analytics Engine. New data points
 * show up after a minute or two. Cloudflare samples bursts of writes (21 requests
 * in 5 seconds stored 17 rows) and records each row's weight in _sample_interval,
 * so counts are SUM(_sample_interval): estimates, exact only at steady low volume.
 * Query quirk: after `timestamp AS time`, ORDER BY must use the alias; ordering by
 * `timestamp` is rejected ("unable to find type of column").
 */

import { STATS_COLUMNS as C } from "@gw/shared";
import type { CloudflareApi } from "./cloudflare";

export interface RouteSummary {
  app: string;
  route: string;
  mode: string;
  /** Requests this route matched. */
  received: number;
  forwarded: number;
  /** Dropped in enforce mode: n8n executions saved. */
  dropped: number;
  /** Shadow mode: forwarded, but enforce would have dropped them. */
  wouldDrop: number;
  /** Why the filters failed, with counts. */
  reasons: Record<string, number>;
  /** Forwards n8n answered with an error (status 0 = network error). */
  n8nErrors: number;
  /** Those errors by HTTP status, e.g. { "404": 3 }. */
  errorStatuses: Record<string, number>;
}

export interface RecentDecision {
  time: string;
  app: string;
  route: string;
  kind: string;
  type: string;
  channel: string;
  mode: string;
  filter: string;
  reason: string;
  outcome: string;
  status: number;
}

export interface AppSignal {
  app: string;
  lastVerified?: string;
  lastBadSignature?: string;
  lastRequest?: string;
}

export interface UnroutedType {
  app: string;
  /** The event type, e.g. "message" or "reaction_added". */
  type: string;
  count: number;
  /** When the latest one arrived. */
  last: string;
}

export interface DailyPoint {
  day: string;
  forwarded: number;
  dropped: number;
}

export class Stats {
  constructor(
    private readonly cf: CloudflareApi,
    private readonly accountId: string,
    private readonly dataset: string,
  ) {
    // The dataset name is interpolated into SQL; it comes from our own install, but check anyway.
    if (!/^[a-z0-9_]+$/.test(dataset)) throw new Error(`Unexpected dataset name ${dataset}`);
  }

  async summary(days: number): Promise<RouteSummary[]> {
    const rows = await this.cf.sql<{ app: string; route: string; mode: string; filter: string; reason: string; outcome: string; status: number; n: number }>(
      this.accountId,
      `SELECT ${C.app} AS app, ${C.route} AS route, ${C.mode} AS mode, ${C.filter} AS filter, ${C.reason} AS reason,
              ${C.outcome} AS outcome, ${C.status} AS status, SUM(_sample_interval) AS n
       FROM ${this.dataset}
       WHERE timestamp > NOW() - INTERVAL '${int(days)}' DAY AND ${C.outcome} IN ('forwarded', 'dropped')
       GROUP BY app, route, mode, filter, reason, outcome, status`,
    );
    const byRoute = new Map<string, RouteSummary>();
    for (const r of rows) {
      const key = `${r.app}\u0000${r.route}`;
      let s = byRoute.get(key);
      if (!s) {
        s = { app: r.app, route: r.route, mode: r.mode, received: 0, forwarded: 0, dropped: 0, wouldDrop: 0, reasons: {}, n8nErrors: 0, errorStatuses: {} };
        byRoute.set(key, s);
      }
      const n = Number(r.n);
      s.received += n;
      if (r.outcome === "forwarded") s.forwarded += n;
      if (r.outcome === "dropped") s.dropped += n;
      if (r.outcome === "forwarded" && r.mode === "shadow" && r.filter === "fail") s.wouldDrop += n;
      if (r.filter === "fail" && r.reason) s.reasons[r.reason] = (s.reasons[r.reason] ?? 0) + n;
      // Status 0 with forwarded means dry run or network error; n8n errors are >= 400.
      if (r.outcome === "forwarded" && Number(r.status) >= 400) {
        s.n8nErrors += n;
        s.errorStatuses[String(r.status)] = (s.errorStatuses[String(r.status)] ?? 0) + n;
      }
      s.mode = r.mode || s.mode;
    }
    return [...byRoute.values()].sort((a, b) => b.received - a.received);
  }

  async daily(days: number): Promise<DailyPoint[]> {
    const rows = await this.cf.sql<{ day: string; outcome: string; n: number }>(
      this.accountId,
      `SELECT toStartOfDay(timestamp) AS day, ${C.outcome} AS outcome, SUM(_sample_interval) AS n
       FROM ${this.dataset}
       WHERE timestamp > NOW() - INTERVAL '${int(days)}' DAY AND ${C.outcome} IN ('forwarded', 'dropped')
       GROUP BY day, outcome
       ORDER BY day`,
    );
    const byDay = new Map<string, DailyPoint>();
    for (const r of rows) {
      const p = byDay.get(r.day) ?? { day: r.day, forwarded: 0, dropped: 0 };
      if (r.outcome === "forwarded") p.forwarded += Number(r.n);
      else p.dropped += Number(r.n);
      byDay.set(r.day, p);
    }
    return [...byDay.values()];
  }

  async recent(limit = 50): Promise<RecentDecision[]> {
    const rows = await this.cf.sql<RecentDecision>(
      this.accountId,
      `SELECT timestamp AS time, ${C.app} AS app, ${C.route} AS route, ${C.kind} AS kind, ${C.type} AS type,
              ${C.channel} AS channel, ${C.mode} AS mode, ${C.filter} AS filter, ${C.reason} AS reason,
              ${C.outcome} AS outcome, ${C.status} AS status
       FROM ${this.dataset}
       WHERE timestamp > NOW() - INTERVAL '1' DAY
       ORDER BY time DESC
       LIMIT ${int(limit)}`,
    );
    return rows.map((r) => ({ ...r, status: Number(r.status) }));
  }

  /** Events that reached the gateway and no route lists, per app and event type: traffic the Slack app could simply not subscribe to. */
  async unrouted(days: number): Promise<UnroutedType[]> {
    const rows = await this.cf.sql<{ app: string; type: string; n: number; last: string }>(
      this.accountId,
      `SELECT ${C.app} AS app, ${C.type} AS type, SUM(_sample_interval) AS n, MAX(timestamp) AS last
       FROM ${this.dataset}
       WHERE timestamp > NOW() - INTERVAL '${int(days)}' DAY AND ${C.outcome} = 'unrouted' AND ${C.kind} = 'event'
       GROUP BY app, type
       ORDER BY n DESC
       LIMIT 100`,
    );
    return rows.map((r) => ({ app: r.app, type: r.type, count: Number(r.n), last: r.last }));
  }

  /** Per app: when Slack last verified the URL, last sent a bad signature, and last sent anything. */
  async appSignals(): Promise<AppSignal[]> {
    const rows = await this.cf.sql<{ app: string; outcome: string; last: string }>(
      this.accountId,
      `SELECT ${C.app} AS app, ${C.outcome} AS outcome, MAX(timestamp) AS last
       FROM ${this.dataset}
       WHERE timestamp > NOW() - INTERVAL '30' DAY
       GROUP BY app, outcome`,
    );
    const byApp = new Map<string, AppSignal>();
    for (const r of rows) {
      const s = byApp.get(r.app) ?? { app: r.app };
      if (r.outcome === "url_verification") s.lastVerified = r.last;
      else if (r.outcome === "bad_signature") s.lastBadSignature = r.last;
      if (r.outcome !== "bad_signature" && (!s.lastRequest || r.last > s.lastRequest)) s.lastRequest = r.last;
      byApp.set(r.app, s);
    }
    return [...byApp.values()];
  }
}

function int(n: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1 || v > 1000) throw new Error("Out of range");
  return v;
}
