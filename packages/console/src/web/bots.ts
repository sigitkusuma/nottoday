/** Every configured app with its health, counts and recent activity, from the config, stats and live stream. */

import { useEffect, useMemo, useState } from "react";
import { makeBots, type Bot } from "./botHealth";
import { useConfig } from "./config";
import { useStats } from "./stats";
import { useLive } from "./useLive";

export type { Bot };

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
  return useMemo(
    () => makeBots({ apps: config?.apps ?? {}, missingSecrets, routes: routes ?? [], signals, live: live.events, now }),
    [config, missingSecrets, routes, signals, live.events, now],
  );
}
