/**
 * Bots: every Slack app as a card; open one to see its health, routes,
 * connection details and recent activity.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useBots, type Bot } from "../bots";
import type { GoTo } from "../App";
import { useConfig } from "../config";
import { summarizeRoute } from "../routeSummary";
import { useStats } from "../stats";
import type { GatewayConfig, Route, Status } from "../types";
import { useLive } from "../useLive";
import { AddBotCard, BotCard } from "./BotCard";
import { ConnectSlackApp } from "./ConnectSlackApp";
import { LiveCheck, describe } from "./LiveCheck";
import { Avatar, Empty, PageHead, PulseLegend, PulseStrip, StatusPill } from "./parts";
import { RouteEditor, type RouteDraft } from "./RouteEditor";
import { ConfirmButton, CopyField, ErrorNotice, Field, fmt, timeAgo, useAction } from "./ui";

export function Apps({
  status,
  sub,
  goTo,
  draft,
  onDraftUsed,
}: {
  status: Status;
  /** From the URL: "new" opens the connect wizard, "<app>" a bot, "<app>/new-route" its route editor. */
  sub: string;
  goTo: GoTo;
  draft?: RouteDraft | null;
  onDraftUsed?: () => void;
}) {
  const { config, save, loadError } = useConfig();
  const bots = useBots();
  const [editing, setEditing] = useState<{ app: string; route?: string; draft?: RouteDraft } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // A route started from the n8n page.
  useEffect(() => {
    if (!draft || !config) return;
    const apps = Object.keys(config.apps);
    if (apps.length > 0) setEditing({ app: apps[0], draft });
    onDraftUsed?.();
  }, [draft, config, onDraftUsed]);

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
        <ConnectSlackApp status={status} onCancel={() => goTo("apps")} onDone={(key) => goTo(`apps/${key}/new-route`)} />
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
    setSavedNote(
      `Route "${route.name}" saved. It's live within a minute.${route.mode === "shadow" ? " Next: post a few test messages in Slack and watch the squares on the bot, then switch it to enforce." : ""}`,
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
        <PageHead title={route ? `Edit route "${route.name}"` : "New route"} sub={`On ${editing.app}. A route decides which Slack requests reach which n8n workflow.`} back={{ label: `Back to ${editing.app}`, onClick: close }} />
        {!editing.route && keys.length > 1 && (
          <Field label="Bot">
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
        title="Bots"
        sub="Each Slack app sends its events to its own gateway URL. Open a bot to see its routes and what's happening on it."
        actions={
          bots.length > 0 && (
            <button type="button" className="btn primary" onClick={() => goTo("apps/new")}>
              Connect a Slack app
            </button>
          )
        }
      />
      {botKey && !config.apps[botKey] && (
        <div className="notice warn small" role="status">
          There's no bot called "{botKey}" (maybe it was just removed).
        </div>
      )}
      {savedNote && (
        <div className="notice ok small" role="status">
          {savedNote}
        </div>
      )}
      {bots.length === 0 ? (
        <Empty
          title="No bots yet"
          actions={
            <button type="button" className="btn primary" onClick={() => goTo("apps/new")}>
              Connect a Slack app
            </button>
          }
        >
          Connect the Slack app whose events start your n8n workflow. The console creates the Slack app settings for you and confirms each step as it
          happens.
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
        back={{ label: "All bots", onClick: () => goTo("apps") }}
        title={
          <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
            <Avatar name={key} size={40} />
            <span>{key}</span>
            <StatusPill tone={bot.status.tone} label={bot.status.label} live={bot.status.health === "receiving"} />
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
                      {summarizeRoute(r).join(" ")}
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
              <p className="hint">Before enforcing, post a few messages the workflow should act on and a few it should ignore. The squares in Recent activity turn amber where enforce would drop something.</p>
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
                {live.state === "unavailable" ? `Real-time activity isn't available. ${live.message ?? ""}` : "Nothing since you opened the console. Post a message in a channel this bot is in."}
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
            <Field label="Request URL" hint="Paste into the Slack app's Event Subscriptions. Interactivity and slash commands can use it too.">
              <CopyField value={`${status.gateway!.url}/slack/${key}`} label={`Request URL for ${key}`} />
            </Field>
            <LiveCheck appKey={key} compact />
          </section>

          <section className="card" aria-labelledby="secret-h">
            <h3 id="secret-h">Signing secret</h3>
            <p className="muted small">Slack signs every request with it. If the gateway shows "wrong signing secret", replace it here.</p>
            {replacing ? <ReplaceSecret appKey={key} onDone={() => setReplacing(false)} /> : (
              <button type="button" className="btn" onClick={() => setReplacing(true)}>
                Replace signing secret
              </button>
            )}
          </section>

          <section className="card danger-zone" aria-labelledby="rm-h">
            <h3 id="rm-h">Remove this bot</h3>
            <p className="muted small">Deletes its routes and signing secret from the gateway. The Slack app itself is not touched.</p>
            <ConfirmButton
              label="Remove bot"
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

function ReplaceSecret({ appKey, onDone }: { appKey: string; onDone: () => void }) {
  const [secret, setSecret] = useState("");
  const action = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => (await api("PUT", `/apps/${appKey}/secret`, { signingSecret: secret }), onDone()));
      }}
    >
      <Field label="New signing secret" hint="Takes effect immediately. Then click Retry next to the Request URL in Slack.">
        <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} required />
      </Field>
      <ErrorNotice error={action.error} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={action.busy}>
          Save secret
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
