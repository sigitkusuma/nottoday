/** Subscribes to the gateway's real-time decisions while a component is on screen. */

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, errorText, openStream } from "./api";
import { eventsFromDecisions, mergeEvents } from "./liveMerge";
import type { RecentDecision } from "./types";

export interface LiveDecision {
  route: string;
  mode: string;
  filter: string;
  reason?: string;
  forwarded: boolean;
  /** What n8n answered; absent when it never did. */
  status?: number;
  /** How many tries the forward took (it retries when n8n is briefly unavailable). */
  attempts?: number;
  /** Why the forward failed, when it did. */
  error?: string;
}

export interface LiveEvent {
  time: string;
  kind: "verified" | "bad_signature" | "unknown_app" | "missing_secret" | "event" | "error";
  app?: string;
  /** slack, github, telegram or webhook; absent from engines before 0.3.0 (Slack). */
  source?: string;
  type?: string;
  subtype?: string;
  channel?: string;
  retry?: string;
  /** Slack's reason for the retry, e.g. "http_timeout". */
  retryReason?: string;
  routes?: LiveDecision[];
  message?: string;
  /** Rebuilt from the stats table, which has less detail than the live stream (no subtype, retry or tries). */
  fromStats?: boolean;
}

export interface LiveState {
  state: "connecting" | "live" | "unavailable";
  message?: string;
  /** Newest first. */
  events: LiveEvent[];
}

const MAX_EVENTS = 200;
/** How much of the stats table to read back: a request can have several rows (one per route). */
const HISTORY_ROWS = 300;
const HISTORY_POLL_MS = 15_000;

/** Waits, but ends early when the signal aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

function useLiveStream(enabled: boolean): LiveState {
  const [status, setStatus] = useState<Pick<LiveState, "state" | "message">>({ state: "connecting" });
  // Events that arrived while this page was open, newest first.
  const [session, setSession] = useState<LiveEvent[]>([]);
  // What the stats table remembers of the last day, so a reload doesn't start from an empty feed.
  const [history, setHistory] = useState<LiveEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const loadHistory = () =>
      api<{ decisions: RecentDecision[] }>("GET", `/stats/recent?limit=${HISTORY_ROWS}`)
        .then((r) => !controller.signal.aborted && setHistory(eventsFromDecisions(r.decisions)))
        .catch(() => undefined);

    void loadHistory();
    void (async () => {
      // The stream can end (the console restarted, the laptop slept, the network blinked): reconnect, don't go quiet.
      let attempt = 0;
      while (!controller.signal.aborted) {
        try {
          await openStream(
            "/live/stream",
            (event, data) => {
              attempt = 0;
              if (event === "status") {
                const s = JSON.parse(data) as { state: LiveState["state"]; message?: string };
                setStatus({ state: s.state, message: s.message });
              } else if (event === "decision") {
                const e = JSON.parse(data) as LiveEvent;
                setSession((prev) => [e, ...prev].slice(0, MAX_EVENTS));
              }
            },
            controller.signal,
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          // A new console session token: reconnecting can't help, the link it printed is needed.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            setStatus({ state: "unavailable", message: "This page can no longer reach the console. Open the link it printed." });
            return;
          }
          attempt += 1;
          setStatus(attempt >= 4 ? { state: "unavailable", message: errorText(err) } : { state: "connecting", message: "Reconnecting…" });
        }
        if (controller.signal.aborted) return;
        if (attempt === 0) setStatus({ state: "connecting", message: "Reconnecting…" });
        await pause(Math.min(1000 * 2 ** attempt, 15_000), controller.signal);
        // Whatever happened while disconnected is in the stats by now.
        void loadHistory();
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  // Without the real-time stream, stats are all there is, so keep them fresh.
  useEffect(() => {
    if (!enabled || status.state !== "unavailable") return;
    const controller = new AbortController();
    const timer = setInterval(
      () =>
        api<{ decisions: RecentDecision[] }>("GET", `/stats/recent?limit=${HISTORY_ROWS}`)
          .then((r) => !controller.signal.aborted && setHistory(eventsFromDecisions(r.decisions)))
          .catch(() => undefined),
      HISTORY_POLL_MS,
    );
    return () => (clearInterval(timer), controller.abort());
  }, [enabled, status.state]);

  const events = useMemo(() => mergeEvents(session, history, MAX_EVENTS), [session, history]);
  return { ...status, events };
}

const LiveContext = createContext<LiveState | null>(null);

/** One stream for the whole console: the dashboard pulse strips, the activity feed and the live checks all read it. */
export function LiveProvider({ children }: { children: ReactNode }) {
  return createElement(LiveContext.Provider, { value: useLiveStream(true) }, children);
}

export function useLive(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive outside LiveProvider");
  return ctx;
}
