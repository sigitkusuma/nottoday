/** First run: connect Cloudflare, pick the account, install the gateway Worker. */

import { useEffect, useState } from "react";
import { api } from "../api";
import type { Status } from "../types";
import { SavedAccountsBar } from "./Connections";
import { Icon } from "./icons";
import { SecretField } from "./parts";
import { TokenGuide } from "./TokenGuide";
import { ErrorNotice, Field, useAction } from "./ui";

interface Account {
  id: string;
  name: string;
}

const STEPS = ["Connect Cloudflare", "Install the gateway"];

export function Setup({ status, onChange }: { status: Status; onChange: () => void }) {
  const hasToken = status.cloudflare !== null;
  const hasAccount = Boolean(status.cloudflare?.accountId);
  const step = hasToken && hasAccount ? 1 : 0;

  return (
    <div className="welcome">
      <header className="welcome-head">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="activity" size={20} />
        </span>
        <div>
          <h1>Set up the gateway</h1>
          <p className="muted">A Cloudflare Worker in your own account, on the free plan. Two short steps.</p>
        </div>
      </header>

      <div className="flow" aria-label="How the gateway fits between Slack and n8n">
        <div className="flow-node">
          <b>Slack</b>
          <span>Sends every message, mention and click</span>
        </div>
        <span className="flow-arrow" aria-hidden="true">
          <Icon name="arrow" />
        </span>
        <div className="flow-node accent">
          <b>The gateway</b>
          <span>Drops what no workflow acts on</span>
        </div>
        <span className="flow-arrow" aria-hidden="true">
          <Icon name="arrow" />
        </span>
        <div className="flow-node">
          <b>n8n</b>
          <span>Runs only when it's needed</span>
        </div>
      </div>

      <ol className="hstepper" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "current" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="rail-dot" aria-hidden="true">
              {i < step ? <Icon name="check" size={15} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <SavedAccountsBar status={status} onChange={onChange} />
      {!hasToken || !hasAccount ? <ConnectCloudflare status={status} hasToken={hasToken} onChange={onChange} /> : <Install status={status} onChange={onChange} />}
    </div>
  );
}

function ConnectCloudflare({ status, hasToken, onChange }: { status: Status; hasToken: boolean; onChange: () => void }) {
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const action = useAction();

  useEffect(() => {
    if (hasToken && !accounts) void action.run(async () => setAccounts((await api<{ accounts: Account[] }>("GET", "/cloudflare/accounts")).accounts));
  }, [hasToken]);

  if (hasToken && accounts) {
    return (
      <section className="wizard-pane" aria-labelledby="setup-title">
        <p className="muted small step-of">Step 1 of 2</p>
        <h3 id="setup-title">Choose the Cloudflare account</h3>
        <p className="lead-sm">The token can reach more than one account. The gateway is installed in the one you pick.</p>
        <ErrorNotice error={action.error} />
        <div className="tiles">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="tile"
              disabled={action.busy}
              onClick={() => action.run(async () => (await api("POST", "/cloudflare/account", { accountId: a.id }), onChange()))}
            >
              <span className="tile-icon" aria-hidden="true">
                <Icon name="cloud" />
              </span>
              <strong>{a.name}</strong>
              <span className="small mono">{a.id}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <form
      className="wizard-pane"
      aria-labelledby="setup-title"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const { accounts: list } = await api<{ accounts: Account[] }>("POST", "/cloudflare/token", { token });
          setToken("");
          if (list.length > 1) setAccounts(list);
          else onChange();
        });
      }}
    >
      <p className="muted small step-of">Step 1 of 2</p>
      <h3 id="setup-title">Connect your Cloudflare account</h3>
      <p className="lead-sm">The console needs an API token to create the Worker and store its settings. It takes about two minutes.</p>
      <TokenGuide tokenUrl={status.tokenUrl} />
      <SecretField label="API token" value={token} onChange={setToken} required hint="Stored only on this computer, in a file only your user can read. Never sent anywhere except Cloudflare's API." />
      <ErrorNotice error={action.error} />
      <div className="wizard-foot end">
        <button type="submit" className="btn primary" disabled={action.busy || !token.trim()}>
          {action.busy ? "Checking…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function Install({ status, onChange }: { status: Status; onChange: () => void }) {
  const [name, setName] = useState("nottoday");
  const action = useAction();
  return (
    <form
      className="wizard-pane"
      aria-labelledby="setup-title"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => (await api("POST", "/gateway/install", { scriptName: name.trim() }), onChange()));
      }}
    >
      <p className="muted small step-of">Step 2 of 2 · account {status.cloudflare?.accountName}</p>
      <h3 id="setup-title">Install the gateway</h3>
      <p className="lead-sm">This is what the install does in your Cloudflare account:</p>
      <ul className="todos plain">
        <li className="todo">
          <span className="tile-icon" aria-hidden="true">
            <Icon name="cloud" />
          </span>
          <div>
            <b className="todo-title">Creates a Worker</b>
            <div className="todo-body small">The gateway itself, with its own workers.dev address.</div>
          </div>
        </li>
        <li className="todo">
          <span className="tile-icon" aria-hidden="true">
            <Icon name="list" />
          </span>
          <div>
            <b className="todo-title">Creates a KV namespace</b>
            <div className="todo-body small">Where the gateway keeps its settings: apps, routes and lists.</div>
          </div>
        </li>
      </ul>
      <p className="hint" style={{ marginTop: 0 }}>
        If a Worker with this name already exists (for example one you deployed with wrangler), it is updated in place and its secrets are kept.
      </p>
      <Field label="Worker name" hint="Lowercase letters, digits and dashes. It becomes part of the URL Slack calls.">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9][a-z0-9\-]{0,62}" required />
      </Field>
      <ErrorNotice error={action.error} />
      <div className="wizard-foot">
        <button type="button" className="btn" onClick={() => void action.run(async () => (await api("DELETE", "/cloudflare"), onChange()))}>
          {status.connections.length > 1 ? "Cancel and go back" : "Use a different token"}
        </button>
        <button type="submit" className="btn primary" disabled={action.busy}>
          {action.busy ? "Installing…" : "Install the gateway"}
        </button>
      </div>
    </form>
  );
}
