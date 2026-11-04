/**
 * Working with more than one Cloudflare account: the switcher at the top of the
 * sidebar, the account label on page titles, the all-accounts views for the
 * dashboard and the Apps page, and the "which gateway?" choice when connecting
 * an app. Each account is its own gateway with its own apps.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { AccountSummary } from "../accountSummary";
import { useAccounts } from "../accounts";
import type { GoTo } from "../App";
import { rangeLabel, useStats } from "../stats";
import { BotCard } from "./BotCard";
import { Icon } from "./icons";
import { Avatar, PulseLegend, StatusPill } from "./parts";
import { ErrorNotice, fmt, useAction } from "./ui";

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The account the console is showing, at the top of the sidebar; opens a list of every account. */
export function AccountSwitcher({ goTo }: { goTo: GoTo }) {
  const acc = useAccounts();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const act = useAction();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = acc.active;
  const name = active?.name ?? "Cloudflare account";
  const elsewhere = acc.accounts.filter((a) => !a.active && a.tone === "bad").length;

  const pick = (a: AccountSummary) => {
    if (a.active) return setOpen(false);
    // An app of one account means nothing in another, so leave the app's page.
    const leaveApp = /^#apps\/./.test(location.hash);
    void act.run(async () => {
      await acc.switchTo(a.id);
      if (leaveApp) goTo("apps");
      setOpen(false);
    });
  };

  return (
    <div className="switcher" ref={root}>
      <button ref={button} type="button" className="switcher-btn" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        <span className="switcher-avatar">
          <Avatar name={name} size={30} />
          {elsewhere > 0 && <i className="dot bad flag" aria-hidden="true" />}
        </span>
        <span className="switcher-text">
          <strong>{name}</strong>
          <span>{acc.multiple && active ? active.line : "Cloudflare account"}</span>
        </span>
        <Icon name="chevron" size={16} />
        {elsewhere > 0 && <span className="visually-hidden">{elsewhere === 1 ? "Another account needs attention" : `${elsewhere} other accounts need attention`}</span>}
      </button>
      {open && (
        <div className="switcher-menu" id={menuId}>
          <div className="switcher-title">Cloudflare accounts</div>
          <ul>
            {acc.accounts.map((a) => (
              <li key={a.id}>
                <button type="button" className="switcher-item" aria-current={a.active ? "true" : undefined} disabled={act.busy} onClick={() => pick(a)}>
                  <Avatar name={a.name} size={26} />
                  <span className="switcher-text">
                    <strong>{a.name}</strong>
                    <span>{a.line}</span>
                  </span>
                  {a.active ? <Icon name="check" size={16} /> : <i className={`dot ${a.tone}`} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
          <ErrorNotice error={act.error} />
          <div className="switcher-foot">
            <button
              type="button"
              className="switcher-item compact"
              onClick={() => {
                setOpen(false);
                goTo("cloudflare/add");
              }}
            >
              <Icon name="plus" size={16} />
              <span>Add a Cloudflare account</span>
            </button>
            <button
              type="button"
              className="switcher-item compact"
              onClick={() => {
                setOpen(false);
                goTo("cloudflare");
              }}
            >
              <Icon name="cloud" size={16} />
              <span>Manage accounts</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dashboard: every account at a glance. Click one to switch to it. */
export function AccountsStrip({ goTo }: { goTo: GoTo }) {
  const acc = useAccounts();
  const { days } = useStats();
  const act = useAction();
  if (!acc.multiple) return null;
  const total = acc.accounts.reduce((n, a) => n + (a.saved ?? 0), 0);
  const anySaved = acc.accounts.some((a) => a.saved !== null);
  return (
    <section className="acct-strip" aria-labelledby="accts-h">
      <div className="spread">
        <h3 id="accts-h">Your Cloudflare accounts</h3>
        {anySaved && (
          <span className="muted small">
            {fmt(total)} executions saved across all · {rangeLabel(days)}
          </span>
        )}
      </div>
      <ErrorNotice error={act.error} />
      <div className="acct-strip-grid">
        {acc.accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`acct-tile tone-${a.tone}${a.active ? " active" : ""}`}
            aria-current={a.active ? "true" : undefined}
            disabled={act.busy}
            onClick={() => (a.active ? goTo("apps") : void act.run(() => acc.switchTo(a.id)))}
          >
            <Avatar name={a.name} />
            <span className="acct-tile-main">
              <span className="acct-tile-name">
                <strong>{a.name}</strong>
                {a.active && <span className="badge enforce">viewing</span>}
              </span>
              <span className="small">
                <i className={`dot ${a.tone}`} aria-hidden="true" /> {a.line}
              </span>
            </span>
            <span className="acct-tile-num">
              <b>{a.saved === null ? "–" : fmt(a.saved)}</b>
              <small>saved</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Apps page, "All accounts": every account's apps in one place, grouped by account. */
export function AllAccountsApps({ goTo }: { goTo: GoTo }) {
  const acc = useAccounts();
  const act = useAction();
  const ordered = [...acc.accounts].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <>
      <ErrorNotice error={act.error ?? acc.error} />
      <div style={{ marginBottom: 10 }}>
        <PulseLegend />
      </div>
      {ordered.map((a) => (
        <section key={a.id} className="acct-group" aria-labelledby={`group-${a.id}`}>
          <header className="acct-group-head">
            <Avatar name={a.name} />
            <div className="acct-group-title">
              <h3 id={`group-${a.id}`}>{a.name}</h3>
              <span className="muted small mono">{hostOf(a.url)}</span>
            </div>
            <StatusPill tone={a.tone} label={a.line} />
            {a.active ? (
              <button type="button" className="btn sm" onClick={() => goTo("apps/new")}>
                Connect an app
              </button>
            ) : (
              <button type="button" className="btn sm" disabled={act.busy} onClick={() => void act.run(() => acc.open(a.id, "apps/new"))}>
                Connect an app
              </button>
            )}
          </header>
          {a.load === "error" ? (
            <div className="notice warn small" role="status">
              Couldn't read this account{a.error ? `: ${a.error}` : "."} Check its token under Cloudflare.
            </div>
          ) : a.load === "loading" ? (
            <p className="muted small">Loading…</p>
          ) : a.bots.length === 0 ? (
            <p className="muted small">No apps in this account yet.</p>
          ) : (
            <div className="bot-grid">
              {a.bots.map((b) => (
                <BotCard
                  key={b.key}
                  bot={b}
                  showCounts={a.statsEnabled}
                  pulses={a.active}
                  onOpen={() => (a.active ? goTo(`apps/${b.key}`) : void act.run(() => acc.open(a.id, `apps/${b.key}`)))}
                />
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="hint">Each account is its own gateway. Opening an app in another account switches the console to that account.</p>
    </>
  );
}

/** First step of "Connect an app" with several gateways: which one the app's address will be on. */
export function GatewayPicker() {
  const acc = useAccounts();
  const act = useAction();
  const ids = useId();
  if (!acc.multiple) return null;
  return (
    <fieldset className="gw-pick">
      <legend>Which gateway should this app go to?</legend>
      <div className="tiles two" role="radiogroup" aria-label="Gateway">
        {acc.accounts.map((a) => (
          <label key={a.id} className={`tile${a.active ? " selected" : ""}`}>
            <input type="radio" name={`${ids}-gateway`} checked={a.active} disabled={act.busy} onChange={() => void act.run(() => acc.switchTo(a.id))} />
            <span className="row" style={{ flexWrap: "nowrap" }}>
              <Avatar name={a.name} size={28} />
              <strong>{a.name}</strong>
            </span>
            <span className="small mono">{hostOf(a.url)}</span>
            <span className="small">{a.line}</span>
          </label>
        ))}
      </div>
      <ErrorNotice error={act.error} />
      {acc.active?.reachable === false && (
        <div className="notice warn small" role="status">
          This gateway isn't answering right now, so the checks in the next steps won't pass until it's back. Pick another one, or check it under Cloudflare.
        </div>
      )}
      <p className="hint">The app's address will be on that gateway. Each gateway keeps its own apps, routes and lists.</p>
    </fieldset>
  );
}
