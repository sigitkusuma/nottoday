/**
 * One line per Cloudflare account: how many apps it has, whether they're fine,
 * and what they saved. Pure, so the switcher, the dashboard strip and the
 * tests share it. Each account is its own gateway; nothing here mixes them.
 */

import { makeBots, type Bot, type Tone } from "./botHealth";
import type { AccountOverview } from "./types";

export interface AccountSummary {
  id: string;
  name: string;
  url: string;
  active: boolean;
  /** "loading" until the first read; "error" when the account couldn't be read. */
  load: "ready" | "loading" | "error";
  error?: string;
  reachable?: boolean;
  statsEnabled: boolean;
  bots: Bot[];
  /** Executions saved in the chosen range; null when unknown or stats are off. */
  saved: number | null;
  tone: Tone;
  /** "3 apps · all good", "2 apps · 1 needs attention", "Gateway not answering"… */
  line: string;
}

export interface AccountHead {
  id: string;
  name: string | null;
  url: string;
  active: boolean;
  statsEnabled: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names the tone and the line from what is known. Problems that stop requests (gateway down, can't read) count as "bad". */
export function describeAccount(i: { load: AccountSummary["load"]; reachable?: boolean; bots: Bot[]; error?: string }): { tone: Tone; line: string } {
  if (i.load === "loading") return { tone: "idle", line: "Checking…" };
  if (i.load === "error") return { tone: "bad", line: "Can't read this account" };
  if (i.reachable === false) return { tone: "bad", line: "Gateway not answering" };
  if (i.bots.length === 0) return { tone: "idle", line: "No apps yet" };
  const bad = i.bots.filter((b) => b.status.tone === "bad").length;
  const warn = i.bots.filter((b) => b.status.tone === "warn").length;
  const apps = plural(i.bots.length, "app");
  if (bad > 0) return { tone: "bad", line: `${apps} · ${bad} ${bad === 1 ? "needs" : "need"} attention` };
  if (warn > 0) return { tone: "warn", line: `${apps} · ${warn} ${warn === 1 ? "needs" : "need"} a look` };
  return { tone: "ok", line: `${apps} · all good` };
}

const sumSaved = (routes: { dropped: number }[] | null | undefined) => (routes ? routes.reduce((n, r) => n + r.dropped, 0) : null);

/** An account other than the active one, from the overview (no live stream, so "receiving" can only come from stats). */
export function summarizeOverview(head: AccountHead, o: AccountOverview | undefined, now: number, loaded: boolean): AccountSummary {
  const base = { id: head.id, name: head.name ?? "Cloudflare account", url: head.url, active: head.active, statsEnabled: head.statsEnabled };
  if (!o) {
    const load = loaded ? "error" : "loading";
    return { ...base, load, error: loaded ? "It wasn't in the last read." : undefined, bots: [], saved: null, ...describeAccount({ load, bots: [] }) };
  }
  if (o.error || !o.apps) return { ...base, load: "error", error: o.error, bots: [], saved: null, ...describeAccount({ load: "error", bots: [] }) };
  const bots = makeBots({ apps: o.apps, missingSecrets: o.missingSecrets ?? [], routes: o.routes ?? [], signals: o.signals ?? [], live: [], now });
  const reachable = o.health?.reachable;
  return { ...base, load: "ready", reachable, bots, saved: o.statsEnabled ? sumSaved(o.routes) : null, ...describeAccount({ load: "ready", reachable, bots }) };
}

/** The active account, from what the console already holds (live events included). */
export function summarizeActive(head: AccountHead, bots: Bot[], reachable: boolean, routes: { dropped: number }[] | null): AccountSummary {
  const base = { id: head.id, name: head.name ?? "Cloudflare account", url: head.url, active: true, statsEnabled: head.statsEnabled };
  return { ...base, load: "ready", reachable, bots, saved: head.statsEnabled ? sumSaved(routes) : null, ...describeAccount({ load: "ready", reachable, bots }) };
}

export interface AccountProblem {
  /** Sentence naming the account (and the app). */
  text: string;
  /** Set when the problem belongs to one app, so a button can open it. */
  appKey?: string;
}

/** What needs doing in an account, in words, for the dashboard's "Needs attention" list. */
export function accountProblems(a: AccountSummary): AccountProblem[] {
  if (a.load === "error") return [{ text: `${a.name}: can't read this account${a.error ? ` (${a.error})` : ""}. Check its token under Cloudflare.` }];
  if (a.load === "ready" && a.reachable === false) return [{ text: `${a.name}: the gateway at ${a.url} isn't answering.` }];
  return a.bots.filter((b) => b.status.tone === "bad").map((b) => ({ text: `${a.name} · ${b.key}: ${b.status.detail}`, appKey: b.key }));
}
