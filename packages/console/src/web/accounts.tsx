/**
 * Every saved Cloudflare account, side by side. Each account is its own
 * gateway; the console shows one of them (the active one) in full, and reads
 * the rest through `GET /overview` so they can be reviewed without switching.
 * Switching remounts the pages (see App), so nothing from one gateway leaks into another.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { summarizeActive, summarizeOverview, type AccountSummary } from "./accountSummary";
import { api } from "./api";
import type { GoTo } from "./App";
import { useBots, useNow } from "./bots";
import { useStats } from "./stats";
import type { AccountOverview, Status } from "./types";

interface AccountsState {
  /** Every saved account that has a gateway, in the order they were added. */
  accounts: AccountSummary[];
  active: AccountSummary | undefined;
  /** Two or more gateways: the switcher, account labels and the all-accounts views appear. */
  multiple: boolean;
  /** Makes an account the active one. The pages reload for it. */
  switchTo: (id: string) => Promise<void>;
  /** Switches to the account, then goes to a page in it. */
  open: (id: string, path?: Parameters<GoTo>[0]) => Promise<void>;
  refresh: () => Promise<void>;
  error: unknown;
}

const AccountsContext = createContext<AccountsState | null>(null);

const REFRESH_MS = 60_000;

export function AccountsProvider({ status, onStatusChange, goTo, children }: { status: Status; onStatusChange: () => Promise<void> | void; goTo: GoTo; children: ReactNode }) {
  const othersKey = status.connections
    .filter((c) => c.accountId && c.gatewayUrl && !c.active)
    .map((c) => c.id)
    .join(",");
  const { days, routes } = useStats();
  const activeBots = useBots();
  const now = useNow();
  const [data, setData] = useState<Record<string, AccountOverview>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!othersKey) {
      setData({});
      setLoaded(true);
      return;
    }
    try {
      const r = await api<{ accounts: AccountOverview[] }>("GET", `/overview?others=1&days=${days}`);
      setData(Object.fromEntries(r.accounts.map((a) => [a.id, a])));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoaded(true);
    }
  }, [othersKey, days]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const accounts = useMemo(
    () =>
      status.connections
        .filter((c) => c.accountId && c.gatewayUrl)
        .map((c) => {
          const statsEnabled = c.active ? (status.gateway?.statsEnabled ?? true) : (data[c.id]?.statsEnabled ?? true);
          const head = { id: c.id, name: c.accountName, url: c.gatewayUrl!, active: c.active, statsEnabled };
          return c.active ? summarizeActive(head, activeBots, status.gateway?.health.reachable ?? false, routes) : summarizeOverview(head, data[c.id], now, loaded);
        }),
    [status.connections, status.gateway, activeBots, routes, data, now, loaded],
  );

  const switchTo = useCallback(
    async (id: string) => {
      await api("POST", `/connections/${id}/activate`);
      await onStatusChange();
    },
    [onStatusChange],
  );
  const open = useCallback(
    async (id: string, path?: Parameters<GoTo>[0]) => {
      await switchTo(id);
      if (path) goTo(path);
    },
    [switchTo, goTo],
  );

  const value: AccountsState = { accounts, active: accounts.find((a) => a.active), multiple: accounts.length > 1, switchTo, open, refresh, error };
  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts(): AccountsState {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error("useAccounts outside AccountsProvider");
  return ctx;
}

/** For shared pieces (like the page header) that also render before the console is set up. */
export function useMaybeAccounts(): AccountsState | null {
  return useContext(AccountsContext);
}
