import { useCallback, useEffect, useState } from "react";
import type { RouteDraft } from "./components/RouteEditor";
import { api } from "./api";
import { useBots } from "./bots";
import { ConfigProvider } from "./config";
import { Apps } from "./components/Apps";
import { Connections } from "./components/Connections";
import { Dashboard } from "./components/Dashboard";
import { History } from "./components/History";
import { Icon, type IconName } from "./components/icons";
import { Lists } from "./components/Lists";
import { Live } from "./components/Live";
import { N8n } from "./components/N8n";
import { Setup } from "./components/Setup";
import { ErrorNotice } from "./components/ui";
import { StatsProvider } from "./stats";
import type { Status } from "./types";
import { LiveProvider } from "./useLive";

/** Main sections, then the settings group. */
const MAIN: [string, string, IconName][] = [
  ["overview", "Dashboard", "dashboard"],
  ["apps", "Bots", "bot"],
  ["live", "Activity", "activity"],
  ["lists", "Lists", "list"],
];
const SETTINGS: [string, string, IconName][] = [
  ["n8n", "n8n connection", "workflow"],
  ["history", "Versions", "history"],
  ["cloudflare", "Cloudflare", "cloud"],
];
const IDS = [...MAIN, ...SETTINGS].map(([id]) => id);
export type Tab = "overview" | "apps" | "live" | "lists" | "n8n" | "history" | "cloudflare";
/** A section, optionally with a sub-path such as "apps/new" or "apps/<key>". Kept in the URL hash, so views can be linked and Back works. */
export type GoTo = (path: Tab | `${Tab}/${string}`) => void;

function readHash(): { tab: Tab; sub: string } {
  const [first, ...rest] = location.hash.replace(/^#/, "").split("/");
  const tab = (IDS.includes(first) ? first : "overview") as Tab;
  return { tab, sub: decodeURIComponent(rest.join("/")) };
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [{ tab, sub }, setView] = useState(readHash);
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const clearDraft = useCallback(() => setDraft(null), []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>("GET", "/status"));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goTo: GoTo = useCallback((path) => {
    if (location.hash !== `#${path}`) location.hash = path;
    else setView(readHash());
    window.scrollTo(0, 0);
  }, []);

  if (error && !status) {
    return (
      <div className="setup">
        <ErrorNotice error={error} />
      </div>
    );
  }
  if (!status) return <div className="setup muted">Loading…</div>;
  if (!status.cloudflare?.accountId || !status.gateway) {
    return <Setup status={status} onChange={refresh} />;
  }

  return (
    <ConfigProvider>
      <StatsProvider enabled={status.gateway.statsEnabled}>
        <LiveProvider>
          <div className="app">
            <Sidebar status={status} tab={tab} goTo={goTo} />
            <main className="main" id="main">
              {tab === "overview" && <Dashboard status={status} onStatusChange={refresh} goTo={goTo} />}
              {tab === "apps" && <Apps status={status} sub={sub} goTo={goTo} draft={draft} onDraftUsed={clearDraft} />}
              {tab === "live" && <Live />}
              {tab === "lists" && <Page><Lists status={status} /></Page>}
              {tab === "n8n" && <Page><N8n status={status} onStatusChange={refresh} onStartRoute={(d) => (setDraft(d), goTo("apps"))} /></Page>}
              {tab === "history" && <Page><History status={status} onStatusChange={refresh} goTo={goTo} /></Page>}
              {tab === "cloudflare" && <Page><Connections status={status} onStatusChange={refresh} goTo={goTo} /></Page>}
            </main>
          </div>
        </LiveProvider>
      </StatsProvider>
    </ConfigProvider>
  );
}

const Page = ({ children }: { children: React.ReactNode }) => <div className="page">{children}</div>;

function Sidebar({ status, tab, goTo }: { status: Status; tab: Tab; goTo: GoTo }) {
  const bots = useBots();
  const attention = bots.filter((b) => b.status.tone === "bad").length;
  const gw = status.gateway!;
  const item = ([id, label, icon]: [string, string, IconName]) => (
    <button key={id} type="button" className="nav-item" aria-current={tab === id ? "page" : undefined} onClick={() => goTo(id as Tab)}>
      <Icon name={icon} />
      {label}
      {id === "apps" && bots.length > 0 && (
        <span className={`nav-badge${attention ? "" : " ok"}`} aria-label={attention ? `${attention} of ${bots.length} bots need attention` : `${bots.length} bots`}>
          {attention || bots.length}
        </span>
      )}
    </button>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="activity" size={17} />
        </span>
        <span>
          <div className="brand-name">Not Today</div>
          <div className="brand-sub">Slack gateway for n8n</div>
        </span>
      </div>
      <nav className="nav" aria-label="Sections">
        {MAIN.map(item)}
        <div className="nav-label">Settings</div>
        {SETTINGS.map(item)}
      </nav>
      <div className="sidebar-foot">
        <div className="engine-line">
          <span className={`pill ${gw.health.reachable ? "ok live" : "bad"}`} style={{ padding: "2px 8px 2px 6px", fontSize: 12 }}>
            {gw.health.reachable ? "Gateway online" : "Gateway down"}
          </span>
        </div>
        <button type="button" className="acct" onClick={() => goTo("cloudflare")}>
          <strong>{status.cloudflare?.accountName ?? "Cloudflare account"}</strong>
          {status.connections.length > 1 ? `${status.connections.length} accounts · switch` : "Switch or add account"}
        </button>
      </div>
    </aside>
  );
}
