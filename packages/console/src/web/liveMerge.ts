/**
 * The activity feed is the live stream (this session) plus what the stats table
 * remembers of the last day, so a reload, a restart or switching accounts doesn't
 * empty it. Pure: the stream's own events win, history only fills in what they miss.
 */

import { ts } from "./botHealth";
import type { RecentDecision } from "./types";
import type { LiveEvent } from "./useLive";

/** Stats rows come one per route decision; this puts the rows of one request back together. Newest first. */
export function eventsFromDecisions(rows: RecentDecision[]): LiveEvent[] {
  const byKey = new Map<string, LiveEvent>();
  for (const r of rows) {
    const at = ts(r.time);
    if (!at) continue;
    const kind: LiveEvent["kind"] = r.outcome === "bad_signature" ? "bad_signature" : r.outcome === "url_verification" ? "verified" : "event";
    const key = [r.time, r.app, kind, r.type, r.channel].join("\u0000");
    let e = byKey.get(key);
    if (!e) {
      e = { time: new Date(at).toISOString(), kind, app: r.app, type: r.type || undefined, channel: r.channel || undefined, fromStats: true, ...(kind === "event" ? { routes: [] } : {}) };
      byKey.set(key, e);
    }
    if (kind === "event" && (r.outcome === "forwarded" || r.outcome === "dropped")) {
      e.routes!.push({ route: r.route, mode: r.mode, filter: r.filter, reason: r.reason || undefined, forwarded: r.outcome === "forwarded", status: r.status || undefined });
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/** Stats and the stream stamp the same request a moment apart. */
const SAME_MOMENT_MS = 2000;

const same = (a: LiveEvent, b: LiveEvent) =>
  a.app === b.app &&
  a.kind === b.kind &&
  (a.type ?? "") === (b.type ?? "") &&
  (a.channel ?? "") === (b.channel ?? "") &&
  Math.abs(Date.parse(a.time) - Date.parse(b.time)) <= SAME_MOMENT_MS;

/** Live events plus the history rows that aren't among them, newest first. */
export function mergeEvents(live: LiveEvent[], history: LiveEvent[], max = 200): LiveEvent[] {
  const extra = history.filter((h) => !live.some((l) => same(l, h)));
  return [...live, ...extra].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, max);
}
