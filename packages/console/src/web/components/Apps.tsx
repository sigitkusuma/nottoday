/**
 * Apps: every connected app (Slack, GitHub, Telegram, webhook) as a card; open
 * one to see its health, routes, connection details and recent activity.
 */

import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../accounts";
import { api } from "../api";
import { useBots, type Bot } from "../bots";
import type { GoTo } from "../App";
import { useConfig } from "../config";
import { summarizeRoute } from "../routeSummary";
import { useStats } from "../stats";
import type { GatewayConfig, Route, Status } from "../types";
import { useLive } from "../useLive";
import { AddBotCard, BotCard } from "./BotCard";
import { requestPath, sourceOf, type SourceType } from "@gw/shared";
import { sourceInfo } from "../sources";
import { AllAccountsApps } from "./Accounts";
import { ConnectApp } from "./ConnectApp";
import { SourceTag } from "./BotCard";
import { LiveCheck, describe } from "./LiveCheck";
import { Avatar, Empty, PageHead, PulseLegend, PulseStrip, StatusPill } from "./parts";
import { RouteEditor, type RouteDraft } from "./RouteEditor";
import { ConfirmButton, CopyField, ErrorNotice, Field, fmt, timeAgo, useAction } from "./ui";
import { SecretField } from "./parts";

export function Apps({
  status,
  sub,
  goTo,
  draft,
  onDraftUsed,
}: {
  status: Status;
  /** From the URL: "new" opens the connect wizard, "<app>" an app, "<app>/new-route" its route editor. */
  sub: string;
  goTo: GoTo;
  draft?: RouteDraft | null;
  onDraftUsed?: () => void;
}) {
  const { config, save, loadError } = useConfig();
  const bots = useBots();
  const acc = useAccounts();
  const [scope, setScope] = useScope();
  const [editing, setEditing] = useState<{ app: string; route?: string; draft?: RouteDraft } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // A route started from the n8n page.
  useEffect(() => {
    if (!draft || !config) return;
    const apps = Object.keys(config.apps);
    if (apps.length > 0) setEditing({ app: apps[0], draft });
    onDraftUsed?.();
  }, [draft, config, onDraftUsed]);

  // An open editor belongs to the address it was opened from. Leaving it (the sidebar, Back, another app) closes it,
  // so the editor doesn't come back when the address returns to the list.
  useEffect(() => {
    setEditing((e) => (e && (sub === e.app || sub === `${e.app}/new-route`) ? e : null));
  }, [sub]);

  // "#apps/<key>/new-route", e.g. right after connecting a bot. Opens the editor once per visit to that
  // address: saving changes the config while the address still says new-route, and must not reopen it.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const m = /^([a-z0-9_-]+)\/new-route$/.exec(sub);
    if (!m) {
      openedFor.current = null;
      return;
    }
    if (config?.apps[m[1]] && openedFor.current !== sub) {
      openedFor.current = sub;
      setEditing({ app: m[1] });
    }
  }, [sub, config]);

  if (loadError) return <ErrorNotice error={loadError} />;
  if (!config) return <p className="muted">Loading…</p>;

  if (sub === "new") {
    return (
      <div className="page">
        <ConnectApp status={status} onCancel={() => goTo("apps")} onDone={(key) => goTo(`apps/${key}/new-route`)} />
      </div>
    );
  }

  const botKey = /^([a-z0-9_-]+)/.exec(sub)?.[1];

  const saveRoute = async (appKey: string, route: Route, previousName?: string) => {
    const next: GatewayConfig = structuredClone(config);
    const routes = next.apps[appKey].routes;
    const i = previousName === undefined ? -1 : routes.findIndex((r) => r.name === previousName);
    if (i >= 0) routes[i] = route;
    else routes.push(route);
    await save(next);
    setEditing(null);
    const sender = sourceInfo(sourceOf(next.apps[appKey])).sender;
    setSavedNote(
      `Route "${route.name}" saved. It's live within a minute.${route.mode === "shadow" ? ` Next: send a few test requests from ${sender} and watch the squares on the app, then switch it to enforce.` : ""}`,
    );
    goTo(`apps/${appKey}`);
  };

  if (editing) {
    const app = config.apps[editing.app];
    const route = editing.route ? app?.routes.find((r) => r.name === editing.route) : undefined;
    const close = () => {
      setEditing(null);
      if (/new-route$/.test(sub)) goTo(`apps/${editing.app}`);
    };
    const keys = Object.keys(config.apps);
    return (
      <div className="page">
        <PageHead title={route ? `Edit route "${route.name}"` : "New route"} sub={`On ${editing.app}. A route decides which requests reach which n8n workflow.`} back={{ label: `Back to ${editing.app}`, onClick: close }} />
        {!editing.route && keys.length > 1 && (
          <Field label="App">
            <select value={editing.app} onChange={(e) => setEditing({ ...editing, app: e.target.value })}>
              {keys.map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </Field>
        )}
        <RouteEditor
          key={editing.app + (editing.route ?? "")}
          config={config}
          appKey={editing.app}
          route={route}
          draft={editing.draft}
          status={status}
          onSave={(r) => saveRoute(editing.app, r, editing.route)}
          onCancel={close}
        />
      </div>
    );
  }

  if (botKey && config.apps[botKey]) {
    const bot = bots.find((b) => b.key === botKey)!;
    return (
      <BotDetail
        bot={bot}
        status={status}
        savedNote={savedNote}
        onDismissNote={() => setSavedNote(null)}
        goTo={goTo}
        onEditRoute={(name) => setEditing({ app: botKey, route: name })}
        onAddRoute={() => setEditing({ app: botKey })}
      />
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Apps"
        sub="Each connected app sends its requests to its own gateway URL. Open one to see its routes and what's happening on it."
        actions={
          <>
            {acc.multiple && (
              <div className="seg" role="group" aria-label="Which accounts to show">
                <button type="button" aria-pressed={scope === "this"} onClick={() => setScope("this")}>
                  This account
                </button>
                <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                  All accounts
                </button>
              </div>
            )}
            {(bots.length > 0 || (acc.multiple && scope === "all")) && (
              <button type="button" className="btn primary" onClick={() => goTo("apps/new")}>
                Connect an app
              </button>
            )}
          </>
        }
      />
      {botKey && !config.apps[botKey] && (
        <div className="notice warn small" role="status">
          There's no app called "{botKey}" (maybe it was just removed).
        </div>
      )}
      {savedNote && (
        <div className="notice ok small" role="status">
          {savedNote}
        </div>
      )}
      {acc.multiple && scope === "all" ? (
        <AllAccountsApps goTo={goTo} />
      ) : bots.length === 0 ? (
        <Empty
          title="No apps yet"
          actions={
            <button type="button" className="btn primary" onClick={() => goTo("apps/new")}>
              Connect an app
            </button>
          }
        >
          Connect the app whose events start your n8n workflow. The console confirms each step as it happens.
        </Empty>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <PulseLegend />
          </div>
          <BotsGrid bots={bots} status={status} goTo={goTo} />
        </>
      )}
    </div>
  );
}

const SCOPE_KEY = "nottoday-apps-scope";

/** "This account" or "All accounts" on the Apps page. Remembered in this browser; with several accounts it starts on "All". */
function useScope(): ["this" | "all", (s: "this" | "all") => void] {
  const [scope, setScope] = useState<"this" | "all">(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) === "this" ? "this" : "all";
    } catch {
      return "all";
    }
  });
  return [
    scope,
    (s) => {
      setScope(s);
      try {
        localStorage.setItem(SCOPE_KEY, s);
      } catch {
        // Not remembered; it still works for this visit.
      }
    },
  ];
}

function BotsGrid({ bots, status, goTo }: { bots: Bot[]; status: Status; goTo: GoTo }) {
  return (
    <div className="bot-grid">
      {bots.map((b) => (
        <BotCard key={b.key} bot={b} showCounts={status.gateway!.statsEnabled} onOpen={() => goTo(`apps/${b.key}`)} />
      ))}
      <AddBotCard onClick={() => goTo("apps/new")} />
    </div>
  );
}

function BotDetail({
  bot,
  status,
  savedNote,
  onDismissNote,
  goTo,
  onEditRoute,
  onAddRoute,
}: {
  bot: Bot;
  status: Status;
  savedNote: string | null;
  onDismissNote: () => void;
  goTo: GoTo;
  onEditRoute: (name: string) => void;
  onAddRoute: () => void;
}) {
  const { config, save, reload } = useConfig();
  const stats = useStats();
  const live = useLive();
  const action = useAction();
  const [replacing, setReplacing] = useState(false);
  const key = bot.key;
  const source = sourceOf(bot.app);
  const info = sourceInfo(source);
  const url = `${status.gateway!.url}${requestPath(source, key)}`;
  const mine = live.events.filter((e) => e.app === key).slice(0, 8);
  const statsOn = status.gateway!.statsEnabled;

  const mutate = (change: (next: GatewayConfig) => void) =>
    action.run(async () => {
      const next = structuredClone(config!);
      change(next);
      await save(next);
    });

  return (
    <div className="page">
      <PageHead
        back={{ label: "All apps", onClick: () => goTo("apps") }}
        title={
          <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
            <Avatar name={key} size={40} />
            <span>{key}</span>
            <StatusPill tone={bot.status.tone} label={bot.status.label} live={bot.status.health === "receiving"} />
            <SourceTag source={bot.app.source} />
          </span>
        }
        sub={bot.app.description ?? bot.status.detail}
        actions={
          <button type="button" className="btn primary" onClick={onAddRoute}>
            Add route
          </button>
        }
      />
      {savedNote && (
        <div className="notice ok small row" role="status" style={{ justifyContent: "space-between" }}>
          {savedNote}
          <button type="button" className="btn link small" onClick={onDismissNote}>
            Dismiss
          </button>
        </div>
      )}
      <ErrorNotice error={action.error} />

      <div className="detail-grid">
        <div>
          <section className="card" aria-labelledby="routes-h">
            <div className="card-head">
              <h3 id="routes-h">Routes</h3>
              <span className="small muted">{bot.app.routes.length === 0 ? "None yet" : `${bot.app.routes.length}`}</span>
            </div>
            {bot.app.routes.length === 0 ? (
              <p className="muted">No routes yet. Requests are acknowledged and dropped until you add one.</p>
            ) : (
              bot.app.routes.map((r) => {
                const s = stats.routes?.find((x) => x.app === key && x.route === r.name);
                const off = r.enabled === false;
                return (
                  <article key={r.name} className={`route-card${off ? " off" : ""}`}>
                    <div className="route-card-head">
                      <strong>{r.name}</strong>
                      <span className={`badge ${off ? "off" : r.mode === "shadow" ? "shadow" : "enforce"}`}>{off ? "off" : r.mode === "shadow" ? "shadow: forwards everything" : "enforcing"}</span>
                    </div>
                    <p className="route-meta" style={{ marginBottom: 6 }}>
                      {summarizeRoute(r, source).join(" ")}
                    </p>
                    <div className="mono small faint" style={{ wordBreak: "break-all", marginBottom: 8 }}>
                      {r.forwardTo}
                    </div>
                    {statsOn && (
                      <div className="route-nums">
                        <span>
                          <b>{fmt(s?.received ?? 0)}</b> received
                        </span>
                        <span>
                          <b>{fmt(s?.forwarded ?? 0)}</b> to n8n
                        </span>
                        <span>
                          <b>{fmt(r.mode === "shadow" ? (s?.wouldDrop ?? 0) : (s?.dropped ?? 0))}</b> {r.mode === "shadow" ? "would be saved" : "saved"}
                        </span>
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 10 }}>
                      {r.mode === "shadow" && !off && (
                        <ConfirmButton
                          className="btn primary sm"
                          label="Switch to enforce"
                          confirmLabel="Confirm: start dropping"
                          disabled={action.busy}
                          onConfirm={() =>
                            void mutate((next) => {
                              next.apps[key].routes.find((x) => x.name === r.name)!.mode = "enforce";
                            }).then(() => stats.patchMode(key, r.name, "enforce"))
                          }
                        />
                      )}
                      <button type="button" className="btn sm" onClick={() => onEditRoute(r.name)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={action.busy}
                        onClick={() =>
                          void mutate((next) => {
                            const x = next.apps[key].routes.find((y) => y.name === r.name)!;
                            if (off) delete x.enabled;
                            else x.enabled = false;
                          })
                        }
                      >
                        {off ? "Turn on" : "Turn off"}
                      </button>
                      <ConfirmButton
                        className="btn danger sm"
                        label="Delete"
                        confirmLabel="Delete route"
                        disabled={action.busy}
                        onConfirm={() =>
                          void mutate((next) => {
                            next.apps[key].routes = next.apps[key].routes.filter((x) => x.name !== r.name);
                          })
                        }
                      />
                    </div>
                  </article>
                );
              })
            )}
            {bot.app.routes.some((r) => r.mode === "shadow") && (
              <p className="hint">Before enforcing, send a few {info.noun}s the workflow should act on and a few it should ignore. The squares in Recent activity turn amber where enforce would drop something.</p>
            )}
          </section>

          <section className="card" aria-labelledby="act-h">
            <div className="card-head">
              <h3 id="act-h">Recent activity</h3>
              <button type="button" className="btn link small" onClick={() => goTo("live")}>
                Open full feed
              </button>
            </div>
            <div style={{ marginBottom: 10 }}>
              <PulseStrip live={live.events} bot={key} />
            </div>
            {mine.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {live.state === "unavailable"
                  ? `Real-time activity isn't available. ${live.message ?? ""}`
                  : source === "slack"
                    ? "Nothing since you opened the console. Post a message in a channel this bot is in."
                    : `Nothing since you opened the console. Send something from ${info.sender} to see it here.`}
              </p>
            ) : (
              <ul className="plain-list small">
                {mine.map((e, i) => (
                  <li key={`${e.time}-${i}`} style={{ padding: "4px 0" }}>
                    <span className="muted">{new Date(e.time).toLocaleTimeString()}</span> {describe(e)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="card" aria-labelledby="conn-h">
            <div className="card-head">
              <h3 id="conn-h">Connection</h3>
              <span className="small muted">{bot.seen ? `Last event ${timeAgo(new Date(bot.seen).toISOString())}` : "No events yet"}</span>
            </div>
            <Field label={URL_LABEL[source]} hint={URL_HINT[source]}>
              <CopyField value={url} label={`${URL_LABEL[source]} for ${key}`} />
            </Field>
            <LiveCheck appKey={key} compact source={source} />
          </section>

          <section className="card" aria-labelledby="secret-h">
            <h3 id="secret-h">{source === "slack" ? "Signing secret" : source === "telegram" ? "Bot connection" : "Secret"}</h3>
            <p className="muted small">{SECRET_TEXT[source]}</p>
            {source === "telegram" ? (
              replacing ? (
                <ReconnectBot appKey={key} onDone={() => setReplacing(false)} />
              ) : (
                <button type="button" className="btn" onClick={() => setReplacing(true)}>
                  Reconnect the bot
                </button>
              )
            ) : replacing ? (
              <ReplaceSecret appKey={key} source={source} canGenerate={source !== "slack"} onDone={() => setReplacing(false)} />
            ) : (
              <button type="button" className="btn" onClick={() => setReplacing(true)}>
                {source === "slack" ? "Replace signing secret" : "Replace the secret"}
              </button>
            )}
          </section>

          <section className="card danger-zone" aria-labelledby="rm-h">
            <h3 id="rm-h">Remove this app</h3>
            <p className="muted small">Deletes its routes and secret from the gateway. {source === "slack" ? "The Slack app itself is not touched." : `Nothing in ${info.sender} is changed: remove the webhook there too.`}</p>
            <ConfirmButton
              label="Remove app"
              confirmLabel={`Remove ${key} and its secret`}
              disabled={action.busy}
              onConfirm={() =>
                void action.run(async () => {
                  await api("DELETE", `/apps/${key}`);
                  await reload();
                  goTo("apps");
                })
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
}

const URL_LABEL: Record<SourceType, string> = { slack: "Request URL", github: "Payload URL", telegram: "Webhook URL", webhook: "Webhook URL" };
const URL_HINT: Record<SourceType, string> = {
  slack: "Paste into the Slack app's Event Subscriptions. Interactivity and slash commands can use it too.",
  github: "In GitHub, Settings → Webhooks. Content type application/json.",
  telegram: "Set for you when the bot was connected. Reconnect the bot if something changed it.",
  webhook: "Where the service sends its webhooks, as a POST. With a token in the URL, add it as ?param=token.",
};
const SECRET_TEXT: Record<SourceType, string> = {
  slack: 'Slack signs every request with it. If the gateway shows "wrong signing secret", replace it here.',
  github: "GitHub signs every delivery with it. Set a new one here, then paste the same value into the webhook's Secret field in GitHub.",
  telegram: "Telegram sends a secret token with every update. Reconnecting sets a new one and points the bot at the gateway again, e.g. after an n8n Telegram Trigger took the webhook back.",
  webhook: "The service signs or sends it with every request. Set a new one here, then update the service to match.",
};

function ReplaceSecret({ appKey, source, canGenerate, onDone }: { appKey: string; source: SourceType; canGenerate: boolean; onDone: () => void }) {
  const [secret, setSecret] = useState("");
  const [generated, setGenerated] = useState("");
  const action = useAction();
  const sender = sourceInfo(source).sender;
  if (generated) {
    return (
      <div>
        <div className="notice ok small">New secret saved. Paste it into {sender} now: it's shown only here.</div>
        <CopyField value={generated} label="New secret" />
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => (await api("PUT", `/apps/${appKey}/secret`, { signingSecret: secret }), onDone()));
      }}
    >
      <SecretField
        label={source === "slack" ? "New signing secret" : "New secret"}
        value={secret}
        onChange={setSecret}
        required
        hint={source === "slack" ? "Takes effect immediately. Then click Retry next to the Request URL in Slack." : "Takes effect immediately."}
      />
      <ErrorNotice error={action.error} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={action.busy}>
          Save secret
        </button>
        {canGenerate && (
          <button
            type="button"
            className="btn"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const value = randomSecret();
                await api("PUT", `/apps/${appKey}/secret`, { signingSecret: value });
                setGenerated(value);
              })
            }
          >
            Generate a new one
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReconnectBot({ appKey, onDone }: { appKey: string; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState("");
  const action = useAction();
  if (user) {
    return (
      <div>
        <div className="notice ok small">
          <b>@{user}</b> sends its updates to the gateway again.
        </div>
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }
  return (
    <div>
      <SecretField label="Bot token" value={token} onChange={setToken} hint="From BotFather (/mybots → your bot → API Token). Used once and not saved." />
      <ErrorNotice error={action.error} />
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={action.busy || !token.trim()}
          onClick={() => void action.run(async () => setUser((await api<{ username: string }>("POST", `/apps/${appKey}/telegram/connect`, { botToken: token.trim() })).username))}
        >
          {action.busy ? "Connecting…" : "Reconnect"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Same alphabet and length as the console server's generated secrets. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
