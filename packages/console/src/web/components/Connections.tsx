/**
 * Saved Cloudflare accounts: switch between them, add another, or forget one.
 * Each account has its own gateway. Only one is active at a time; the rest of
 * the console shows the active one.
 */

import { useEffect, useRef, useState } from "react";
import { useMaybeAccounts } from "../accounts";
import { api } from "../api";
import type { GoTo } from "../App";
import type { ConnectionSummary, Status } from "../types";
import { Icon } from "./icons";
import { Avatar, PageHead, SecretField, StatusPill } from "./parts";
import { TokenGuide } from "./TokenGuide";
import { ConfirmButton, ErrorNotice, useAction } from "./ui";

export function Connections({ status, sub, onStatusChange, goTo }: { status: Status; /** "add" opens the add-an-account form. */ sub?: string; onStatusChange: () => void; goTo: GoTo }) {
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(sub === "add");
  const addForm = useRef<HTMLFormElement>(null);
  const accounts = useMaybeAccounts();

  // "Add a Cloudflare account" in the sidebar menu lands here with the form open.
  useEffect(() => {
    if (sub !== "add") return;
    setAdding(true);
    addForm.current?.scrollIntoView({ block: "start" });
  }, [sub]);
  const add = useAction();
  const act = useAction();

  const activate = (c: ConnectionSummary) =>
    act.run(async () => {
      await api("POST", `/connections/${c.id}/activate`);
      await onStatusChange();
      goTo("overview");
    });

  return (
    <>
      <PageHead
        title="Cloudflare accounts"
        sub="Each account has its own gateway, with its own apps, routes and lists. Switch accounts at the top of the sidebar: Activity, Lists and Versions show the account you're in, while the Dashboard and Apps pages can show all of them. Tokens stay on this computer, in a file only your user can read."
      />
      <ErrorNotice error={act.error} />
      {note && (
        <div className="notice ok small" role="status">
          {note}
        </div>
      )}

      <div className="acct-grid">
        {status.connections.map((c) => (
          <section key={c.id} className={`acct-card${c.active ? " active" : ""}`} aria-label={c.accountName ?? "Account not chosen yet"}>
            <div className="acct-top">
              <Avatar name={c.accountName ?? "?"} />
              <div className="acct-title">
                <strong>{c.accountName ?? "Account not chosen yet"}</strong>
                <span className="muted small mono">{c.accountId ?? "The token can see several accounts"}</span>
              </div>
              {c.active && <StatusPill tone="ok" label="Active" />}
            </div>
            <dl className="kv small">
              {accounts?.accounts.find((a) => a.id === c.id) && (
                <>
                  <dt>Apps</dt>
                  <dd>{accounts.accounts.find((a) => a.id === c.id)!.line}</dd>
                </>
              )}
              <dt>Gateway</dt>
              <dd>
                {c.gatewayUrl ? (
                  <>
                    <span className="mono">{c.scriptName}</span>
                    <div className="muted mono acct-url">{c.gatewayUrl}</div>
                  </>
                ) : (
                  <span className="muted">{c.pending ? "Choose the account to continue" : "Not installed yet"}</span>
                )}
              </dd>
            </dl>
            <div className="row acct-actions">
              {!c.active && (
                <button type="button" className="btn primary" disabled={act.busy} onClick={() => void activate(c)}>
                  {c.pending || !c.gatewayUrl ? "Finish setup" : "Use this account"}
                </button>
              )}
              <ConfirmButton
                label="Forget"
                confirmLabel="Forget this token"
                disabled={act.busy}
                onConfirm={() =>
                  void act.run(async () => {
                    await api("DELETE", `/connections/${c.id}`);
                    setNote(`Forgot ${c.accountName ?? "the unfinished connection"} on this computer. Nothing in Cloudflare was deleted.`);
                    await onStatusChange();
                  })
                }
              />
            </div>
          </section>
        ))}
      </div>
      <p className="hint">
        Forgetting removes only the token and the link to the gateway from this computer. The Worker and its settings stay in Cloudflare; connect that account again to manage them.
      </p>

      <form
        ref={addForm}
        className="block"
        aria-labelledby="add-account"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run(async () => {
            const r = await api<{ refreshed: boolean }>("POST", "/cloudflare/token", { token });
            setToken("");
            setNote(r.refreshed ? "That account was already saved. Its token was updated." : null);
            setAdding(false);
            await onStatusChange();
          });
        }}
      >
        <header className="block-head">
          <span className="tile-icon" aria-hidden="true">
            <Icon name="plus" />
          </span>
          <div style={{ flex: 1 }}>
            <h3 id="add-account">Add another Cloudflare account</h3>
            <p className="muted small">You'll choose the account if the token sees several, then install a gateway in it. If the account is already saved, its token is replaced.</p>
          </div>
          <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {adding ? "Close" : "Add an account"}
          </button>
        </header>
        {adding && (
          <>
            <TokenGuide tokenUrl={status.tokenUrl} accountHint="not the one that's active now" />
            <SecretField label="API token" value={token} onChange={setToken} required hint="Stored only on this computer." />
            <ErrorNotice error={add.error} />
            <button type="submit" className="btn primary" disabled={add.busy || !token.trim()}>
              {add.busy ? "Checking…" : "Add account"}
            </button>
          </>
        )}
      </form>
    </>
  );
}

/** Shown on the setup screen when other accounts are saved, so there's always a way back. */
export function SavedAccountsBar({ status, onChange }: { status: Status; onChange: () => void }) {
  const others = status.connections.filter((c) => !c.active && !c.pending && c.gatewayUrl);
  const act = useAction();
  if (others.length === 0) return null;
  return (
    <div className="notice ok small" role="region" aria-label="Saved Cloudflare accounts">
      <div className="row">
        <span>You also have saved accounts:</span>
        {others.map((c) => (
          <button
            key={c.id}
            type="button"
            className="btn"
            disabled={act.busy}
            onClick={() =>
              void act.run(async () => {
                await api("POST", `/connections/${c.id}/activate`);
                await onChange();
              })
            }
          >
            Switch to {c.accountName}
          </button>
        ))}
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
