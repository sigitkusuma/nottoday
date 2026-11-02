/** Per-route counts and per-bot signals from Analytics Engine, loaded once and shared by the dashboard and the bot pages. */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { AppSignal, RouteSummary } from "./types";

export const RANGES = [1, 7, 30] as const;
export type Range = (typeof RANGES)[number];
export const rangeLabel = (d: Range) => (d === 1 ? "24 hours" : `${d} days`);

interface StatsState {
  enabled: boolean;
  days: Range;
  setDays: (d: Range) => void;
  /** null until the first load. */
  routes: RouteSummary[] | null;
  signals: AppSignal[];
  error: unknown;
  loadedAt: number | null;
  refresh: () => Promise<void>;
  /** Reflect a mode change right away, before the next load. */
  patchMode: (app: string, route: string, mode: string) => void;
}

const StatsContext = createContext<StatsState | null>(null);

const REFRESH_MS = 60_000;

export function StatsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [days, setDays] = useState<Range>(7);
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [signals, setSignals] = useState<AppSignal[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [summary, apps] = await Promise.all([
        api<{ routes: RouteSummary[] }>("GET", `/stats/summary?days=${days}`),
        api<{ apps: AppSignal[] }>("GET", "/stats/apps"),
      ]);
      setRoutes(summary.routes);
      setSignals(apps.apps);
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err);
    }
  }, [enabled, days]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const patchMode = useCallback(
    (app: string, route: string, mode: string) => setRoutes((rs) => rs?.map((r) => (r.app === app && r.route === route ? { ...r, mode } : r)) ?? null),
    [],
  );

  return <StatsContext.Provider value={{ enabled, days, setDays, routes, signals, error, loadedAt, refresh, patchMode }}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsState {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStats outside StatsProvider");
  return ctx;
}
