/**
 * Events Slack sends that no route uses. Slack only sends what the app subscribes to,
 * so the cheapest fix is in Slack: unsubscribe from the event. These helpers turn the
 * gateway's "unrouted" counts into a short list of what to remove.
 */

import { ts } from "./botHealth";

export interface UnroutedRow {
  app: string;
  type: string;
  count: number;
  last: string;
}

export interface NoiseHint {
  type: string;
  count: number;
  /** Bot events to remove under Event Subscriptions. */
  unsubscribe: string[];
}

/** Fewer than this in the range is normal background, not worth a hint. */
export const MIN_NOISE = 20;
/** Still arriving: the latest one is this recent. Once someone unsubscribes in Slack, the hint goes away within this time. */
export const FRESH_MS = 2 * 60 * 60 * 1000;

/** The bot events that produce an event type. Messages come from three: public channels, private channels and DMs. */
export function botEventsFor(type: string): string[] {
  return type === "message" ? ["message.channels", "message.groups", "message.im"] : [type];
}

export function noiseHints(rows: UnroutedRow[], app: string, now: number, min = MIN_NOISE): NoiseHint[] {
  return rows
    .filter((r) => r.app === app && r.type && r.count >= min && now - ts(r.last) <= FRESH_MS)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ type: r.type, count: r.count, unsubscribe: botEventsFor(r.type) }));
}
