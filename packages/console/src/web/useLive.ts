/** Subscribes to the gateway's real-time decisions while a component is on screen. */

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { errorText, openStream } from "./api";

export interface LiveDecision {
  route: string;
  mode: string;
  filter: string;
  reason?: string;
  forwarded: boolean;
  status?: number;
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
  routes?: LiveDecision[];
  message?: string;
}

export interface LiveState {
  state: "connecting" | "live" | "unavailable";
  message?: string;
  /** Newest first. */
  events: LiveEvent[];
}

const MAX_EVENTS = 200;

function useLiveStream(enabled: boolean): LiveState {
  const [live, setLive] = useState<LiveState>({ state: "connecting", events: [] });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    openStream(
      "/live/stream",
      (event, data) => {
        if (event === "status") {
          const s = JSON.parse(data) as { state: LiveState["state"]; message?: string };
          setLive((prev) => ({ ...prev, state: s.state, message: s.message }));
        } else if (event === "decision") {
          const e = JSON.parse(data) as LiveEvent;
          setLive((prev) => ({ ...prev, events: [e, ...prev.events].slice(0, MAX_EVENTS) }));
        }
      },
      controller.signal,
    ).catch((err) => {
      if (!controller.signal.aborted) setLive((prev) => ({ ...prev, state: "unavailable", message: errorText(err) }));
    });
    return () => controller.abort();
  }, [enabled]);

  return live;
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
