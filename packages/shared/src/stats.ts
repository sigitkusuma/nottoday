/**
 * One Analytics Engine data point per routing decision. The engine writes them
 * with toDataPoint(); the console queries them with SQL using STATS_COLUMNS.
 * Both sides import this file, so the column order can't drift apart.
 * Message text is never recorded.
 */

export type StatsOutcome =
  /** The request was sent to n8n. */
  | "forwarded"
  /** A route matched but its filters failed in enforce mode: an n8n execution saved. */
  | "dropped"
  /** No route matched the request at all. */
  | "unrouted"
  /** Slack's Request URL check succeeded. */
  | "url_verification"
  /** The signature didn't match: usually the wrong signing secret. */
  | "bad_signature";

export interface StatsRow {
  app: string;
  route: string;
  /** event, interactivity, command, url_verification, … */
  kind: string;
  /** Slack event type, interactivity payload type or command. */
  type: string;
  channel: string;
  mode: string;
  /** pass, fail or none. */
  filter: string;
  /** Which filter failed. */
  reason: string;
  outcome: StatsOutcome;
  /** HTTP status n8n returned; 0 when nothing was sent. */
  status: number;
  attempts: number;
}

/** Analytics Engine column for each StatsRow field. */
export const STATS_COLUMNS = {
  app: "blob1",
  route: "blob2",
  kind: "blob3",
  type: "blob4",
  channel: "blob5",
  mode: "blob6",
  filter: "blob7",
  reason: "blob8",
  outcome: "blob9",
  status: "double1",
  attempts: "double2",
} as const satisfies Record<keyof StatsRow, string>;

export function toDataPoint(row: StatsRow): { indexes: string[]; blobs: string[]; doubles: number[] } {
  return {
    indexes: [row.app],
    blobs: [row.app, row.route, row.kind, row.type, row.channel, row.mode, row.filter, row.reason, row.outcome],
    doubles: [row.status, row.attempts],
  };
}
