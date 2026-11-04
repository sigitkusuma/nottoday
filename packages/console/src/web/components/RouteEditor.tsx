/**
 * Form over one Route, in the order people decide: what should reach the
 * workflow, where it goes, which filters apply, then shadow or enforce. A
 * preview beside the form says in plain words what the route does and lets
 * people try a message against it. New routes start in shadow mode.
 */

import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import type { ListField } from "../listPicker";
import { eventNames, unforwardedEvents } from "../eventCoverage";
import { summarizeRoute } from "../routeSummary";
import { sourceInfo } from "../sources";
import { sourceOf, type Condition, type SourceType } from "@gw/shared";
import type { EventFilters, GatewayConfig, ListRef, Route, Status, TriggerNode } from "../types";
import { Icon, type IconName } from "./icons";
import { ListPicker } from "./ListPicker";
import { Chip, Toggle } from "./parts";
import { ROUTE_TEMPLATES } from "./templates";
import { TryMessage, TryPayload } from "./TryMessage";
import { ConditionsEditor } from "./ConditionsEditor";
import { ErrorNotice, Field, splitList, useAction } from "./ui";

export interface RouteDraft {
  name?: string;
  forwardTo?: string;
  events?: string[];
}

const SUBTYPES: [string, string][] = [
  ["", "New message"],
  ["thread_broadcast", "Thread reply also sent to channel"],
  ["file_share", "Message with a file"],
  ["bot_message", "Bot message"],
  ["message_changed", "Edit"],
  ["message_deleted", "Delete"],
];
const CHANNEL_TYPES: [string, string][] = [
  ["channel", "Public channel"],
  ["group", "Private channel"],
  ["im", "Direct message"],
  ["mpim", "Group DM"],
];
const LIST_FIELDS: [ListField, string, string][] = [
  ["mentionIn", "Must mention someone in", "At least one mentioned person must be on this list. The most effective filter for \"notify when X is mentioned\" workflows."],
  ["channels", "Only these channels", "Not used means every channel the bot is in."],
  ["excludeChannels", "Never these channels", "Channels to ignore."],
  ["users", "Only from these people", "Only messages written by someone on this list."],
  ["excludeUsers", "Never from these people", "Messages from anyone on this list are ignored."],
];

const listRefText = (ref?: ListRef) => (ref === undefined ? "" : typeof ref === "string" ? ref : ref.join(", "));
const parseListRef = (text: string): ListRef | undefined => {
  const t = text.trim();
  if (!t) return undefined;
  if (/^@[\w-]+$/.test(t)) return t as `@${string}`;
  return splitList(t);
};

export function RouteEditor({
  config,
  appKey,
  route,
  draft,
  status,
  onSave,
  onCancel,
}: {
  config: GatewayConfig;
  appKey: string;
  route?: Route;
  draft?: RouteDraft;
  status: Status;
  onSave: (route: Route) => Promise<void>;
  onCancel: () => void;
}) {
  const app = config.apps[appKey];
  const source = sourceOf(app);
  const isSlack = source === "slack";
  const info = sourceInfo(source);
  // Slack routes start from Slack's templates; other sources from their own.
  const templates: { id: string; label: string; example: string; on: Route["on"]; filters?: EventFilters; match?: Route["match"]; respond?: "proxy"; todo?: string }[] = isSlack
    ? ROUTE_TEMPLATES
    : info.templates;
  const initial: Route =
    route ??
    (isSlack
      ? {
          name: draft?.name ?? "",
          mode: "shadow",
          on: { type: "event", events: draft?.events ?? ["message"] },
          filters: { ignoreBots: true },
          forwardTo: draft?.forwardTo ?? "",
        }
      : // A draft's suggested events come from a Slack Trigger, so they don't apply here.
        { name: draft?.name ?? "", mode: "shadow", on: { type: "event", events: ["*"] }, forwardTo: draft?.forwardTo ?? "" });
  const [r, setR] = useState<Route>(structuredClone(initial));
  const [eventsText, setEventsText] = useState(r.on.type === "event" ? r.on.events.join(", ") : "message");
  const [listTexts, setListTexts] = useState<Record<string, string>>(Object.fromEntries(LIST_FIELDS.map(([k]) => [k, listRefText(r.filters?.[k])])));
  const [triggers, setTriggers] = useState<TriggerNode[] | null>(null);
  // Editing an existing route skips the template step; a new one starts there.
  const [templateId, setTemplateId] = useState(route ? "custom" : "");
  const [fineTuneOpen, setFineTuneOpen] = useState(Boolean(route));
  const action = useAction();
  const template = templates.find((t) => t.id === templateId);
  const lists = Object.keys(config.lists);
  // A Slack Trigger node only understands Slack's requests.
  const usableTriggers = (triggers ?? []).filter((t) => isSlack || t.kind === "webhook");
  // Event types the chosen workflow's Slack Trigger listens to but this route doesn't forward: they'd never arrive.
  const chosenTrigger = usableTriggers.find((t) => t.url === r.forwardTo);
  const missingEvents = isSlack && r.on.type === "event" ? unforwardedEvents(chosenTrigger?.suggestedEvents, splitList(eventsText)) : [];
  const addEvents = (extra: string[]) => {
    const next = [...splitList(eventsText).filter((e) => e !== "*"), ...extra];
    setEventsText(next.join(", "));
    setR((prev) => (prev.on.type === "event" ? { ...prev, on: { type: "event", events: next } } : prev));
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) {
      setFineTuneOpen(true);
      return;
    }
    setR((prev) => ({
      ...prev,
      on: structuredClone(t.on),
      filters: t.filters ? structuredClone(t.filters) : undefined,
      match: t.match ? structuredClone(t.match) : undefined,
      respond: t.respond,
    }));
    if (t.on.type === "event") setEventsText(t.on.events.join(", "));
    setListTexts(Object.fromEntries(LIST_FIELDS.map(([k]) => [k, listRefText(t.filters?.[k])])));
    // Templates that still need input open the fine-tuning section.
    setFineTuneOpen(Boolean(t.todo));
  };

  useEffect(() => {
    if (!status.n8n) return;
    api<{ triggers: TriggerNode[] }>("GET", "/n8n/triggers")
      .then((t) => setTriggers(t.triggers))
      .catch(() => setTriggers([]));
  }, [status.n8n]);

  const f = r.filters ?? {};
  const setFilter = (patch: Partial<EventFilters>) => setR({ ...r, filters: { ...f, ...patch } });
  const toggleIn = (key: "subtypes" | "channelTypes", value: string, on: boolean) => {
    const current = new Set(f[key] ?? []);
    if (on) current.add(value);
    else current.delete(value);
    setFilter({ [key]: current.size ? [...current] : undefined });
  };

  const build = (): Route => {
    const out: Route = structuredClone(r);
    if (!isSlack) {
      const events = splitList(eventsText);
      out.on = { type: "event", events: events.length ? events : ["*"] };
      delete out.filters;
    } else if (out.on.type === "event") {
      out.on = { type: "event", events: splitList(eventsText) };
      const filters: EventFilters = { ...out.filters };
      for (const [k] of LIST_FIELDS) filters[k] = parseListRef(listTexts[k] ?? "");
      if (!filters.textMatches) delete filters.textMatches;
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== false)) as EventFilters;
      out.filters = Object.keys(clean).length ? clean : undefined;
    } else {
      delete out.filters;
    }
    const match = out.match?.filter((c) => c.field.trim());
    if (match?.length) out.match = match;
    else delete out.match;
    if (!out.description) delete out.description;
    if (out.respond === "ack") delete out.respond;
    if (out.enabled !== false) delete out.enabled;
    return out;
  };

  const built = build();
  const chosen = templateId !== "";
  const [picking, setPicking] = useState(false);
  const activeFilters = Object.keys(built.filters ?? {}).length + (built.match?.length ?? 0);
  // New routes number the template step first; editing starts at the destination.
  const n = route ? 0 : 1;

  const submit = () =>
    action.run(() => {
      const missing = Object.values(built.filters ?? {}).filter((v): v is string => typeof v === "string" && v.startsWith("@") && !lists.includes(v.slice(1)));
      if (missing.length) throw new Error(`The list ${missing.join(", ")} doesn't exist. In the filter that uses it, choose another list or pick "New list…".`);
      return onSave(built);
    });

  return (
    <form
      className="editor"
      // Enter in a text field shouldn't save the whole route; use the Save route button.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "checkbox") e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={`editor-grid${chosen ? " has-side" : ""}`}>
        <div className="editor-main">
          {!route && (
            <Block n={1} id="step-what" title="What should reach your workflow?" hint={chosen && !picking ? undefined : "Pick the closest match. You can fine-tune everything afterwards."}>
              {chosen && !picking ? (
                <div className="picked">
                  <span className="tile-icon" aria-hidden="true">
                    <Icon name={TEMPLATE_ICON[templateId] ?? (isSlack ? "sliders" : info.icon)} />
                  </span>
                  <span className="picked-text">
                    <strong>{template?.label ?? "Something else"}</strong>
                    <span className="muted small">{template?.example ?? "Blank route: you set the filters yourself."}</span>
                  </span>
                  <button type="button" className="btn sm" onClick={() => setPicking(true)}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="tiles" role="radiogroup" aria-labelledby="step-what">
                  {[...templates, { id: "custom", label: "Something else", example: "Start blank and set the filters yourself." }].map((t) => (
                    <label key={t.id} className={`tile${templateId === t.id ? " selected" : ""}`}>
                      <input
                        type="radio"
                        name="template"
                        checked={templateId === t.id}
                        onChange={() => {
                          applyTemplate(t.id);
                          setPicking(false);
                        }}
                      />
                      <span className="tile-icon" aria-hidden="true">
                        <Icon name={TEMPLATE_ICON[t.id] ?? (t.id === "custom" ? "sliders" : info.icon)} />
                      </span>
                      <strong>{t.label}</strong>
                      <span className="small">{t.example}</span>
                    </label>
                  ))}
                </div>
              )}
            </Block>
          )}

          {chosen && (
            <>
              <Block n={n + 1} id="step-where" title="Where should it go?">
                {usableTriggers.length > 0 && (
                  <Field label="Pick a trigger from n8n" hint="Fills in the URL below and suggests a name.">
                    <select
                      value={usableTriggers.some((t) => t.url === r.forwardTo) ? r.forwardTo : ""}
                      onChange={(e) => {
                        const t = usableTriggers.find((x) => x.url === e.target.value);
                        if (!t) return;
                        setR({ ...r, forwardTo: t.url, name: r.name || slug(t.workflowName) });
                      }}
                    >
                      <option value="">Choose a workflow trigger…</option>
                      {usableTriggers.map((t) => (
                        <option key={t.url} value={t.url}>
                          {t.workflowName} — {t.nodeName} ({t.kind === "slack" ? "Slack Trigger" : "Webhook"})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {missingEvents.length > 0 && (
                  <div className="notice warn small event-gap" role="status">
                    <span>
                      This workflow's Slack Trigger also listens for <b>{eventNames(missingEvents)}</b>, which this route doesn't forward. Those requests never reach the workflow, even in shadow mode. If the workflow acts on them, add them; if it ignores them, leave the route as it is.
                    </span>
                    <button type="button" className="btn sm" onClick={() => addEvents(missingEvents)}>
                      Add {eventNames(missingEvents)}
                    </button>
                  </div>
                )}
                <Field
                  label="n8n production URL"
                  hint={
                    !isSlack
                      ? `A Webhook node's Production URL (POST). Not n8n's ${info.label} Trigger node: it registers its own webhook with ${info.label}, which the gateway replaces. Requests arrive unchanged, with ${info.label}'s headers.`
                      : status.n8n
                        ? "The trigger's Production URL. Requests arrive unchanged with Slack's signature, so the node works as before."
                        : "The Slack Trigger or Webhook node's Production URL, e.g. https://<n8n>/webhook/<id>/webhook. Connect n8n (Settings) to pick it from a list instead."
                  }
                >
                  <input type="url" value={r.forwardTo} onChange={(e) => setR({ ...r, forwardTo: e.target.value })} placeholder="https://your-n8n/webhook/…" required />
                </Field>
                <Field label="Route name" hint="Shown in stats and logs. Letters, digits and dashes work best.">
                  <input type="text" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required />
                </Field>
              </Block>

              <Block
                n={n + 2}
                id="step-tune"
                title="Filters"
                hint="Filters are what save executions. Keep each one at least as loose as the workflow's own checks: the gateway may pass on something the workflow then ignores, but must never drop something it would act on."
              >
                {template?.todo && <div className="notice ok small">{template.todo}</div>}
                <details className="disclosure" open={fineTuneOpen} onToggle={(e) => setFineTuneOpen((e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <span>
                      {fineTuneOpen ? "Hide filters" : "Show filters"}
                      {(built.on.type === "event" || !isSlack) && <span className="muted small"> · {activeFilters === 0 ? "none set" : `${activeFilters} on`}</span>}
                    </span>
                    <span className="chev">
                      <Icon name="chevron" size={16} />
                    </span>
                  </summary>
                  <div className="disclosure-body">
                    {!isSlack ? (
                      <SourceFilters
                        source={source}
                        eventsText={eventsText}
                        setEventsText={setEventsText}
                        conditions={r.match ?? []}
                        setConditions={(match) => setR({ ...r, match })}
                        lists={lists}
                        hasEventField={source !== "webhook" || Boolean(app.eventField)}
                      />
                    ) : (
                    <FineTune
                      r={r}
                      setR={setR}
                      f={f}
                      setFilter={setFilter}
                      toggleIn={toggleIn}
                      eventsText={eventsText}
                      setEventsText={setEventsText}
                      listTexts={listTexts}
                      setListTexts={setListTexts}
                      n8nConnected={Boolean(status.n8n)}
                    />
                    )}
                  </div>
                </details>
              </Block>

              <Block n={n + 3} id="step-mode" title="Start in" hint="Shadow lets you watch what a route's filters would drop before they drop anything. Event types the route doesn't list are dropped either way.">
                <div className="tiles two" role="radiogroup" aria-labelledby="step-mode">
                  <label className={`tile${(r.mode ?? "enforce") === "shadow" ? " selected" : ""}`}>
                    <input type="radio" name="mode" checked={(r.mode ?? "enforce") === "shadow"} onChange={() => setR({ ...r, mode: "shadow" })} />
                    <strong>
                      Shadow <span className="badge shadow">recommended at first</span>
                    </strong>
                    <span className="small">Forwards everything and records what it would have dropped. Saves nothing yet.</span>
                  </label>
                  <label className={`tile${(r.mode ?? "enforce") === "enforce" ? " selected" : ""}`}>
                    <input type="radio" name="mode" checked={(r.mode ?? "enforce") === "enforce"} onChange={() => setR({ ...r, mode: "enforce" })} />
                    <strong>Enforce</strong>
                    <span className="small">Drops what the filters reject, so those requests never become n8n executions.</span>
                  </label>
                </div>
                <div className="toggles">
                  {source !== "github" && (
                    <Toggle
                      checked={r.respond === "proxy"}
                      onChange={(on) => setR({ ...r, respond: on ? "proxy" : undefined })}
                      title={`Wait for n8n's reply and return it to ${isSlack ? "Slack" : info.label === "Any webhook" ? "the sender" : info.label}`}
                      hint={isSlack ? "For slash commands and modals that answer directly. Leave off otherwise." : "Only when the workflow's reply must go back in the same request. Leave off otherwise."}
                    />
                  )}
                  <Toggle checked={r.enabled !== false} onChange={(on) => setR({ ...r, enabled: on ? undefined : false })} title="Enabled" hint="Turn off to keep the route but stop forwarding." />
                </div>
              </Block>
            </>
          )}

          {!chosen && (
            <div className="row">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {chosen && (
          <aside className="editor-side" aria-label="Preview">
            <div className="preview">
              <h3>What this route does</h3>
              <div className="summary-box" aria-live="polite">
                {summarizeRoute(built, source).map((s) => (
                  <p key={s}>{s}</p>
                ))}
              </div>
              {!isSlack ? <TryPayload route={built} app={app} lists={config.lists} /> : built.on.type === "event" && <TryMessage route={built} lists={config.lists} />}
            </div>
          </aside>
        )}
      </div>

      {chosen && (
        <>
          <ErrorNotice error={action.error} />
          <div className="action-bar">
            <span className="note">
              {r.enabled === false ? "Saved but turned off." : (r.mode ?? "enforce") === "shadow" ? "Shadow mode: the filters don't drop yet." : "Enforce mode: rejected requests are dropped."} Live within a minute of saving.
            </span>
            <span className="row">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={action.busy}>
                {action.busy ? "Saving…" : "Save route"}
              </button>
            </span>
          </div>
        </>
      )}
    </form>
  );
}

const TEMPLATE_ICON: Record<string, IconName> = {
  "mention-list": "at",
  dm: "chat",
  "bot-mention": "bot",
  channels: "hash",
  keyword: "search",
  command: "slash",
  buttons: "pointer",
  custom: "sliders",
};

function Block({ n, id, title, hint, children }: { n: number; id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="block" aria-labelledby={id}>
      <header className="block-head">
        <span className="step-num">{n}</span>
        <div>
          <h3 id={id}>{title}</h3>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </header>
      <div className="block-body">{children}</div>
    </section>
  );
}

function FineTune(p: {
  r: Route;
  setR: (r: Route) => void;
  f: EventFilters;
  setFilter: (patch: Partial<EventFilters>) => void;
  toggleIn: (key: "subtypes" | "channelTypes", value: string, on: boolean) => void;
  eventsText: string;
  setEventsText: (s: string) => void;
  listTexts: Record<string, string>;
  setListTexts: (t: Record<string, string>) => void;
  n8nConnected: boolean;
}) {
  const { r, setR, f, setFilter, toggleIn } = p;
  return (
    <div className="tune">
      <div className="tune-group">
        <h4 className="tune-title" id="tune-kind">
          Which requests
        </h4>
        <div className="chips" role="radiogroup" aria-labelledby="tune-kind">
          {(["event", "interactivity", "command"] as const).map((t) => (
            <Chip
              key={t}
              type="radio"
              name="ontype"
              checked={r.on.type === t}
              onChange={() =>
                setR({ ...r, on: t === "event" ? { type: "event", events: splitList(p.eventsText) } : t === "command" ? { type: "command", commands: [] } : { type: "interactivity" } })
              }
            >
              {t === "event" ? "Events (messages, @mentions, reactions…)" : t === "interactivity" ? "Buttons, menus, modals" : "Slash command"}
            </Chip>
          ))}
        </div>
        <p className="tune-hint" style={{ marginTop: 8 }}>
          {r.on.type === "event"
            ? "Things that happen in Slack: a message, an @mention of the app, a reaction. Pick which ones below."
            : r.on.type === "interactivity"
              ? "Someone clicks a button, chooses from a menu, or submits a form or shortcut."
              : "Someone types a slash command such as /ask."}
        </p>
        <div style={{ marginTop: 12 }}>
          {r.on.type === "event" && (
            <EventPicker
              source="slack"
              eventsText={p.eventsText}
              setEventsText={p.setEventsText}
              labelId="tune-event-types"
              title="Event types"
              hint="Tick what the workflow acts on. A message that @mentions the app arrives as two events, a message and an app_mention, so tick only the one the workflow uses. None ticked means every event."
            />
          )}
          {r.on.type === "command" && (
            <Field label="Commands" hint="e.g. /ask. Turn on “wait for n8n's reply” under Start in if the workflow answers the command directly.">
              <input type="text" value={r.on.commands.join(", ")} onChange={(e) => setR({ ...r, on: { type: "command", commands: splitList(e.target.value) } })} />
            </Field>
          )}
          {r.on.type === "interactivity" && (
            <>
              <Field label="Action IDs (optional)" hint="Empty matches every button and menu.">
                <input type="text" value={(r.on.actionIds ?? []).join(", ")} onChange={(e) => setR({ ...r, on: { ...r.on, type: "interactivity", actionIds: optionalList(e.target.value) } })} />
              </Field>
              <Field label="Callback IDs (optional)" hint="Modal and shortcut callback IDs.">
                <input type="text" value={(r.on.callbackIds ?? []).join(", ")} onChange={(e) => setR({ ...r, on: { ...r.on, type: "interactivity", callbackIds: optionalList(e.target.value) } })} />
              </Field>
            </>
          )}
        </div>
      </div>

      {r.on.type === "event" && (
        <>
          <div className="tune-group">
            <h4 className="tune-title" id="tune-subtypes">
              Message kinds to keep
            </h4>
            <p className="tune-hint">None selected keeps every kind.</p>
            <div className="chips" role="group" aria-labelledby="tune-subtypes">
              {SUBTYPES.map(([v, label]) => (
                <Chip key={v || "plain"} checked={(f.subtypes ?? []).includes(v)} onChange={(on) => toggleIn("subtypes", v, on)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="tune-group">
            <h4 className="tune-title" id="tune-where">
              Where
            </h4>
            <p className="tune-hint">None selected keeps all.</p>
            <div className="chips" role="group" aria-labelledby="tune-where">
              {CHANNEL_TYPES.map(([v, label]) => (
                <Chip key={v} checked={(f.channelTypes ?? []).includes(v)} onChange={(on) => toggleIn("channelTypes", v, on)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="tune-group">
            <h4 className="tune-title">Rules</h4>
            <div className="toggles">
              <Toggle checked={Boolean(f.ignoreBots)} onChange={(on) => setFilter({ ignoreBots: on || undefined })} title="Ignore bot posts" />
              <Toggle checked={Boolean(f.requireMention)} onChange={(on) => setFilter({ requireMention: on || undefined })} title="Must mention someone" />
              <Toggle checked={Boolean(f.ignoreSelfMention)} onChange={(on) => setFilter({ ignoreSelfMention: on || undefined })} title="Mentioning yourself doesn't count" />
            </div>
          </div>

          <div className="tune-group">
            <h4 className="tune-title">People and channels</h4>
            {LIST_FIELDS.map(([key, label, hint]) => (
              <ListPicker
                key={key}
                field={key}
                label={label}
                hint={hint}
                value={p.listTexts[key] ?? ""}
                onChange={(v) => p.setListTexts({ ...p.listTexts, [key]: v })}
                n8nConnected={p.n8nConnected}
              />
            ))}
          </div>

          <div className="tune-group">
            <h4 className="tune-title">Text</h4>
            <Field label="Text must match (optional)" hint="A JavaScript regular expression tested against the message text, e.g. \b[Dd]eploy matches deploy, Deploy and deploying.">
              <input type="text" className="mono" value={f.textMatches ?? ""} onChange={(e) => setFilter({ textMatches: e.target.value || undefined })} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

/** Event names as ticks for the common ones of this kind of app, plus a field for any other. None ticked means every event. */
function EventPicker(p: { source: SourceType; eventsText: string; setEventsText: (s: string) => void; labelId: string; title?: string; hint?: string }) {
  const info = sourceInfo(p.source);
  const events = splitList(p.eventsText).filter((e) => e !== "*");
  const known = new Set(info.events.map((e) => e.value));
  const others = events.filter((e) => !known.has(e));
  const setEvents = (next: string[]) => p.setEventsText(next.length ? next.join(", ") : "*");
  return (
    <>
      {p.title && (
        <div className="tune-sub" id={p.labelId}>
          {p.title}
        </div>
      )}
      <p className="tune-hint">{p.hint ?? `None selected means every ${info.noun}.`}</p>
      {info.events.length > 0 && (
        <div className="chips" role="group" aria-labelledby={p.labelId} style={{ marginBottom: 10 }}>
          {info.events.map((e) => (
            <Chip key={e.value} checked={events.includes(e.value)} onChange={(on) => setEvents(on ? [...events, e.value] : events.filter((x) => x !== e.value))}>
              {e.label}
            </Chip>
          ))}
        </div>
      )}
      <Field label={info.events.length ? "Other event names" : "Event names"} hint={`Comma-separated, exactly as ${info.sender === "the service" ? "the app" : info.sender} sends them.`}>
        <input type="text" className="mono" value={others.join(", ")} onChange={(e) => setEvents([...events.filter((x) => known.has(x)), ...splitList(e.target.value)])} />
      </Field>
    </>
  );
}

function SourceFilters(p: {
  source: SourceType;
  eventsText: string;
  setEventsText: (s: string) => void;
  conditions: Condition[];
  setConditions: (c: Condition[]) => void;
  lists: string[];
  hasEventField: boolean;
}) {
  const info = sourceInfo(p.source);
  return (
    <div className="tune">
      <div className="tune-group">
        <h4 className="tune-title" id="tune-events">
          Which {info.noun}s
        </h4>
        {p.hasEventField ? (
          <EventPicker source={p.source} eventsText={p.eventsText} setEventsText={p.setEventsText} labelId="tune-events" />
        ) : (
          <p className="tune-hint">Every request. To route by event name, the app needs an event field (set when it was connected); conditions below work either way.</p>
        )}
      </div>
      <div className="tune-group">
        <h4 className="tune-title">Conditions</h4>
        <p className="tune-hint">All must pass. Pick a field, or choose "Other field…" and type its path in the request, e.g. data.object.status.</p>
        <ConditionsEditor conditions={p.conditions} onChange={p.setConditions} fields={info.fields} lists={p.lists} />
      </div>
    </div>
  );
}

function optionalList(text: string): string[] | undefined {
  const items = splitList(text);
  return items.length ? items : undefined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
