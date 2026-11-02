/** Every configured Slack app with its health, counts and recent activity, from the config, stats and live stream. */

import { useEffect, useMemo, useState } from "react";
import { botStatus, botTotals, byAttention, lastSeen, type BotStatus, type BotTotals } from "./botHealth";
import { useConfig } from "./config";
import { useStats } from "./stats";
import type { AppConfig } from "./types";
import { useLive } from "./useLive";

export interface Bot {
  key: string;
  app: AppConfig;
  status: BotStatus;
  totals: BotTotals;
  /** ms since epoch, 0 if never. */
  seen: number;
}

export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function useBots(): Bot[] {
  const { config, missingSecrets } = useConfig();
  const { routes, signals } = useStats();
  const live = useLive();
  const now = useNow();
  return useMemo(() => {
    const list: Bot[] = Object.entries(config?.apps ?? {}).map(([key, app]) => {
      const mine = (routes ?? []).filter((r) => r.app === key);
      const signal = signals.find((s) => s.app === key);
      return {
        key,
        app,
        status: botStatus({ key, app, missingSecret: missingSecrets.includes(key), signal, routes: mine, live: live.events, now }),
        totals: botTotals(routes ?? [], key, (name) => app.routes.find((r) => r.name === name)?.mode),
        seen: lastSeen(signal, live.events, key),
      };
    });
    return list.sort((a, b) => byAttention(a.status, b.status) || a.key.localeCompare(b.key));
  }, [config, missingSecrets, routes, signals, live.events, now]);
}
