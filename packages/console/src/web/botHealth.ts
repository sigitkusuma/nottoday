/**
 * What state is each Slack app in? One answer per bot, derived from the config,
 * the stats signals and the live stream, so the list can show a single status
 * and the reason behind it. Pure: also used by the tests.
 */

import { sourceOf } from "@gw/shared";
import { sourceInfo } from "./sources";
import type { AppConfig, AppSignal, RouteSummary } from "./types";
import type { LiveEvent } from "./useLive";

export type Health = "receiving" | "quiet" | "waiting" | "no-routes" | "bad-secret" | "no-secret" | "n8n-errors";
export type Tone = "ok" | "warn" | "bad" | "idle";

export interface BotStatus {
  health: Health;
  tone: Tone;
  label: string;
  /** One sentence: what is true now, and what to do if it's not good. */
  detail: string;
}

/** A bot counts as "receiving" if something reached it within this window. */
export const RECEIVING_WINDOW_MS = 10 * 60_000;

export interface BotInput {
  key: string;
  app: AppConfig;
  missingSecret: boolean;
  signal?: AppSignal;
  routes: RouteSummary[];
  /** Live events newest first. */
  live: LiveEvent[];
  now?: number;
}

/** Stats timestamps ("2026-11-04 07:30:00") are UTC without a zone mark. */
export const ts = (iso?: string): number => {
  if (!iso) return 0;
  const t = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? 0 : t;
};

export function lastSeen(signal: AppSignal | undefined, live: LiveEvent[], key: string): number {
  const liveLast = live.find((e) => e.app === key && (e.kind === "event" || e.kind === "bad_signature"));
  return Math.max(ts(signal?.lastRequest), liveLast ? ts(liveLast.time) : 0);
}

export function botStatus(i: BotInput): BotStatus {
  const now = i.now ?? Date.now();
  const mine = i.live.filter((e) => e.app === i.key);
  const slack = sourceOf(i.app) === "slack";
  const info = sourceInfo(sourceOf(i.app));
  const Sender = info.sender.charAt(0).toUpperCase() + info.sender.slice(1);

  if (i.missingSecret) {
    return { health: "no-secret", tone: "bad", label: slack ? "Needs signing secret" : "Needs its secret", detail: `The gateway has no secret for this app, so ${info.sender}'s requests are refused.` };
  }
  const badLive = mine.find((e) => e.kind === "bad_signature");
  const goodLive = mine.find((e) => e.kind === "event" || e.kind === "verified");
  const badAt = Math.max(ts(i.signal?.lastBadSignature), badLive ? ts(badLive.time) : 0);
  const goodAt = Math.max(ts(i.signal?.lastRequest), ts(i.signal?.lastVerified), goodLive ? ts(goodLive.time) : 0);
  if (badAt && badAt > goodAt) {
    return {
      health: "bad-secret",
      tone: "bad",
      label: slack ? "Wrong signing secret" : "Wrong secret",
      detail: `${Sender}'s requests fail the signature check. ${slack ? "Replace the signing secret." : sourceOf(i.app) === "telegram" ? "Reconnect the bot." : "Replace the secret."}`,
    };
  }
  // Stats cover days; errors from a route that has since been turned off or removed aren't a problem now.
  const active = new Set(i.app.routes.filter((r) => r.enabled !== false).map((r) => r.name));
  const failing = i.routes.filter((r) => active.has(r.route) && r.n8nErrors > 0);
  if (failing.length > 0) {
    return { health: "n8n-errors", tone: "bad", label: "Workflow returning errors", detail: errorDetail(failing) };
  }
  if (i.app.routes.length === 0) {
    return { health: "no-routes", tone: "warn", label: "No routes yet", detail: "Requests are acknowledged and dropped until you add a route." };
  }
  const seen = lastSeen(i.signal, i.live, i.key);
  if (seen && now - seen <= RECEIVING_WINDOW_MS) {
    return { health: "receiving", tone: "ok", label: "Receiving", detail: `${Sender} is sending ${info.noun}s and the gateway is routing them.` };
  }
  if (seen) {
    return { health: "quiet", tone: "ok", label: "Healthy, quiet", detail: "Working. Nothing has arrived in the last few minutes." };
  }
  return { health: "waiting", tone: "warn", label: slack ? "Waiting for Slack" : `Waiting for ${info.sender === "the service" ? "requests" : info.sender}`, detail: `No ${info.noun} from ${info.sender} has arrived yet. Open the app to run the live check.` };
}

const STATUS_HINT: [(s: number) => boolean, string][] = [
  [(s) => s === 404, "404 usually means the workflow is inactive or the URL is wrong."],
  [(s) => s === 405, "405 means that URL doesn't accept Slack's POST: use the trigger's Production URL."],
  [(s) => s === 401 || s === 403, "The URL refused the request: check the Webhook node's authentication."],
  [(s) => s >= 500, "5xx can mean n8n is down or out of executions."],
];

/** What a status n8n answered usually means, in a sentence; empty when there is nothing useful to say. */
export const statusHint = (status: number): string => STATUS_HINT.find(([test]) => test(status))?.[1] ?? "";

/** "support / triage got HTTP 404 (3×). 404 usually means…" */
export function errorDetail(failing: RouteSummary[]): string {
  const byStatus = new Map<number, number>();
  for (const r of failing) for (const [s, n] of Object.entries(r.errorStatuses ?? {})) byStatus.set(Number(s), (byStatus.get(Number(s)) ?? 0) + n);
  const codes = [...byStatus.entries()].sort((a, b) => b[1] - a[1]);
  const names = failing.map((r) => r.route).join(", ");
  if (codes.length === 0) return `The workflow URL for ${names} answered forwarded requests with an error.`;
  const list = codes.map(([s, n]) => `HTTP ${s} (${n}×)`).join(", ");
  const hint = STATUS_HINT.find(([test]) => test(codes[0][0]))?.[1] ?? "";
  return `The workflow URL for ${names} answered ${list}. ${hint}`.trim();
}

/** sent: reached n8n · saved: a filter dropped it · shadow: reached n8n but a filter would drop it · unrouted: no route lists this event
 *  · error: n8n didn't accept it · bad: the gateway refused it · info: Slack's URL check. */
export type PulseTone = "sent" | "saved" | "shadow" | "unrouted" | "error" | "bad" | "info";

/** One dot per recent event, newest first, for the little pulse strip on a bot card. */
export function pulse(live: LiveEvent[], key: string, max = 14): { tone: PulseTone; title: string }[] {
  const out: { tone: PulseTone; title: string }[] = [];
  for (const e of live) {
    if (e.app !== key) continue;
    out.push(eventTone(e));
    if (out.length >= max) break;
  }
  return out;
}

/** The engine counts a forward as failed unless n8n answered with a status below 400. */
const failedForward = (r: { forwarded: boolean; status?: number }) => r.forwarded && !(r.status && r.status < 400);

export function eventTone(e: LiveEvent): { tone: PulseTone; title: string } {
  if (e.kind === "bad_signature" || e.kind === "missing_secret" || e.kind === "unknown_app" || e.kind === "error") return { tone: "bad", title: "Rejected" };
  if (e.kind === "verified") return { tone: "info", title: "Slack verified the URL" };
  const routes = e.routes ?? [];
  if (routes.length === 0) return { tone: "unrouted", title: "No route lists this event: dropped" };
  if (routes.some(failedForward)) return { tone: "error", title: "Forwarded, but n8n didn't accept it" };
  if (routes.some((r) => r.forwarded && r.filter === "fail")) return { tone: "shadow", title: "Forwarded (shadow: would drop)" };
  if (routes.some((r) => r.forwarded)) return { tone: "sent", title: "Sent to n8n" };
  return { tone: "saved", title: "Dropped: execution saved" };
}

/** The same classes for a row from the stats table, used when the live feed isn't available. */
export function decisionTone(d: { outcome: string; mode: string; filter: string; status: number }): { tone: PulseTone; title: string } {
  switch (d.outcome) {
    case "bad_signature":
      return { tone: "bad", title: "Rejected" };
    case "url_verification":
      return { tone: "info", title: "Slack verified the URL" };
    case "unrouted":
      return { tone: "unrouted", title: "No route lists this event: dropped" };
    case "dropped":
      return { tone: "saved", title: "Dropped: execution saved" };
    case "forwarded":
      if (failedForward({ forwarded: true, status: d.status })) return { tone: "error", title: "Forwarded, but n8n didn't accept it" };
      if (d.mode === "shadow" && d.filter === "fail") return { tone: "shadow", title: "Forwarded (shadow: would drop)" };
      return { tone: "sent", title: "Sent to n8n" };
    default:
      return { tone: "info", title: d.outcome };
  }
}

export interface BotTotals {
  received: number;
  forwarded: number;
  saved: number;
  wouldSave: number;
}

export function botTotals(routes: RouteSummary[], app: string, modeOf: (route: string) => string | undefined): BotTotals {
  const t: BotTotals = { received: 0, forwarded: 0, saved: 0, wouldSave: 0 };
  for (const r of routes) {
    if (r.app !== app) continue;
    t.received += r.received;
    t.forwarded += r.forwarded;
    t.saved += r.dropped;
    if (modeOf(r.route) === "shadow") t.wouldSave += r.wouldDrop;
  }
  return t;
}

/** One app with its health, counts and last sign of life. */
export interface Bot {
  key: string;
  app: AppConfig;
  status: BotStatus;
  totals: BotTotals;
  /** ms since epoch, 0 if never. */
  seen: number;
}

/** Every app of a gateway as a Bot, the ones that need attention first. Used for the active account (with live events) and for the others (without). */
export function makeBots(i: { apps: Record<string, AppConfig>; missingSecrets: string[]; routes: RouteSummary[]; signals: AppSignal[]; live: LiveEvent[]; now: number }): Bot[] {
  const list = Object.entries(i.apps).map(([key, app]): Bot => {
    const mine = i.routes.filter((r) => r.app === key);
    const signal = i.signals.find((s) => s.app === key);
    return {
      key,
      app,
      status: botStatus({ key, app, missingSecret: i.missingSecrets.includes(key), signal, routes: mine, live: i.live, now: i.now }),
      totals: botTotals(i.routes, key, (name) => app.routes.find((r) => r.name === name)?.mode),
      seen: lastSeen(signal, i.live, key),
    };
  });
  return list.sort((a, b) => byAttention(a.status, b.status) || a.key.localeCompare(b.key));
}

const ORDER: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, idle: 3 };
/** Bots that need attention first. */
export const byAttention = (a: BotStatus, b: BotStatus): number => ORDER[a.tone] - ORDER[b.tone];
