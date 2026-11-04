/**
 * "Connect a Slack app" in four steps, with the steps listed beside the task.
 * The order matters: the signing secret must be stored before Slack verifies
 * the Request URL, so verification comes last. New apps are created from a
 * manifest, which sets Socket Mode off, the Request URL, the events and the
 * scopes in one go.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { useConfig } from "../config";
import { DEFAULT_LISTEN, LISTEN_OPTIONS, botHandle, buildManifest, createAppUrl, hearsMessages, listenEvents, listenScopes, type ListenId } from "../manifest";
import type { Status } from "../types";
import { Icon } from "./icons";
import { LiveCheck } from "./LiveCheck";
import { PageHead } from "./parts";
import { CopyButton, CopyField, ErrorNotice, useAction } from "./ui";

const STEPS = [
  { title: "Name it", headline: "Name your bot", lead: "This is what people see in Slack. It also becomes part of the address Slack sends events to." },
  { title: "Create it in Slack", headline: "Create the app in Slack", lead: "The gateway can't create the Slack app for you, so this opens Slack with everything filled in." },
  { title: "Add the signing secret", headline: "Paste the signing secret", lead: "The gateway uses it to check that a request really came from Slack, and drops everything else." },
  { title: "Connect and test", headline: "Connect it and send a test", lead: "Finish in Slack, then send the bot something. This page confirms each step as it happens." },
] as const;

export function ConnectSlackApp({ status, onCancel, onBack, onDone }: { status: Status; onCancel: () => void; onBack?: () => void; onDone: (appKey: string) => void }) {
  const { config, reload } = useConfig();
  const ids = useId();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [path, setPath] = useState<"new" | "existing">("new");
  const [listen, setListen] = useState<ListenId[]>(DEFAULT_LISTEN);
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const action = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // After Next or Back, move keyboard and screen-reader users to the new step's heading.
  useEffect(() => {
    if (firstRender.current) firstRender.current = false;
    else heading.current?.focus();
  }, [step]);

  const appKey = keyEdited ? key : slugKey(name);
  const requestUrl = `${status.gateway!.url}/slack/${appKey || "<name>"}`;
  const handle = botHandle(name);
  const manifest = buildManifest(name, requestUrl, undefined, listen);
  const botEvents = listenEvents(listen);
  const botScopes = listenScopes(listen);
  const hearsChat = hearsMessages(listen);

  const nameError = !name.trim() ? "Give the Slack app a name." : name.trim().length > 35 ? "Slack allows at most 35 characters." : "";
  const keyError = !appKey
    ? "Needs at least one letter or digit."
    : !/^[a-z0-9_-]+$/.test(appKey)
      ? "Use lowercase letters, digits, - or _."
      : config && Object.hasOwn(config.apps, appKey) && !saved
        ? `An app called "${appKey}" already exists in the gateway.`
        : "";
  const secretLength = secret.trim().length;
  const secretOk = /^[0-9a-f]{32}$/i.test(secret.trim());
  const secretError = secretOk ? "" : "A Signing Secret is 32 characters of 0–9 and a–f. Click Show next to Signing Secret first, and don't use the Client Secret or Verification Token.";
  const showKeyField = editKey || Boolean(touched.key && keyError);

  const next = () => {
    if (step === 0) {
      setTouched({ ...touched, name: true, key: true });
      if (listen.length === 0) return;
      if (nameError || keyError) {
        if (!nameError) setEditKey(true);
        // Move keyboard and screen-reader users to the first field that needs fixing.
        setTimeout(() => document.querySelector<HTMLInputElement>(`[aria-describedby^="${ids}-${nameError ? "name" : "key"}"]`)?.focus(), 0);
        return;
      }
    }
    setStep(step + 1);
  };

  const saveSecret = () => {
    setTouched({ ...touched, secret: true });
    if (!secretOk) return;
    void action.run(async () => {
      await api("POST", "/apps", { key: appKey, signingSecret: secret, description: name.trim() });
      await reload();
      setSaved(true);
      setSecret("");
      setStep(3);
    });
  };

  const tick = (i: number, on: boolean) => {
    const t = new Set(ticked);
    if (on) t.add(i);
    else t.delete(i);
    setTicked(t);
  };

  const caption = (i: number): string => {
    if (i === 0) return appKey ? name.trim() || appKey : "Pick a name";
    if (i === 1) return step > 1 ? (path === "new" ? "New app" : "Existing app") : "In Slack";
    if (i === 2) return saved ? "Saved" : "From Basic Information";
    return "Live check";
  };

  return (
    <>
      <PageHead
        title="Connect a Slack app"
        sub="Four short steps. The console confirms each one as it happens."
        back={saved || !onBack ? { label: "Back to Apps", onClick: onCancel } : { label: "Other kinds of apps", onClick: onBack }}
      />
      <div className="wizard">
        <nav className="wizard-rail" aria-label="Steps">
          <ol>
            {STEPS.map((s, i) => {
              const done = i < step;
              // Once the secret is saved the app exists; the earlier steps can't be redone from here.
              const canJump = done && !saved;
              const inner = (
                <>
                  <span className="rail-dot" aria-hidden="true">
                    {done ? <Icon name="check" size={15} /> : i + 1}
                  </span>
                  <span className="rail-text">
                    <span className="rail-title">{s.title}</span>
                    <span className="rail-cap">{caption(i)}</span>
                  </span>
                </>
              );
              return (
                <li key={s.title} className={`rail-step${done ? " done" : i === step ? " current" : ""}`} aria-current={i === step ? "step" : undefined}>
                  {canJump ? (
                    <button type="button" className="rail-btn" onClick={() => setStep(i)}>
                      {inner}
                      <span className="visually-hidden"> (completed, go back)</span>
                    </button>
                  ) : (
                    <div className="rail-btn">{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="wizard-pane" aria-labelledby={`${ids}-title`}>
          <div className="wizard-progress" aria-hidden="true">
            <span className="muted small">
              Step {step + 1} of {STEPS.length} · {STEPS[step].title}
            </span>
            <span className="bar">
              <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </span>
          </div>
          <p className="muted small step-of">
            Step {step + 1} of {STEPS.length}
          </p>
          <h3 id={`${ids}-title`} ref={heading} tabIndex={-1}>
            {STEPS[step].headline}
          </h3>
          <p className="lead-sm">{STEPS[step].lead}</p>

          {step === 0 && (
            <div>
              <label className="field">
                <span className="label">Slack app name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched({ ...touched, name: true })}
                  aria-invalid={Boolean(touched.name && nameError)}
                  aria-describedby={`${ids}-name-hint ${ids}-name-err`}
                  placeholder="e.g. Support Alerts"
                  autoFocus
                />
                <span className="hint" id={`${ids}-name-hint`}>
                  For a new app the bot will be <code>@{handle}</code>.
                </span>
                {touched.name && nameError && (
                  <span className="field-error" id={`${ids}-name-err`}>
                    {nameError}
                  </span>
                )}
              </label>

              <div className="address">
                <span className="address-label">Slack will send events to</span>
                <code>{requestUrl}</code>
                {!showKeyField && (
                  <button type="button" className="btn link small" onClick={() => setEditKey(true)}>
                    Change the last part
                  </button>
                )}
              </div>
              {showKeyField && (
                <label className="field">
                  <span className="label">Name in the gateway URL</span>
                  <input
                    type="text"
                    className="mono"
                    value={appKey}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onBlur={() => setTouched({ ...touched, key: true })}
                    aria-invalid={Boolean(touched.key && keyError)}
                    aria-describedby={`${ids}-key-hint ${ids}-key-err`}
                  />
                  <span className="hint" id={`${ids}-key-hint`}>
                    Lowercase letters, digits, - and _. Routes and stats use this name.
                  </span>
                  {touched.key && keyError && (
                    <span className="field-error" id={`${ids}-key-err`}>
                      {keyError}
                    </span>
                  )}
                </label>
              )}

              <fieldset className="listen">
                <legend>What should the bot listen to?</legend>
                <p className="hint" style={{ marginTop: 0 }}>
                  Slack only sends what you tick here, and every event is a request to the gateway. Tick what at least one of your workflows needs; you can change it later in Slack's Event Subscriptions.
                </p>
                <div className="listen-options">
                  {LISTEN_OPTIONS.map((o) => (
                    <label key={o.id} className={`tile${listen.includes(o.id) ? " selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={listen.includes(o.id)}
                        onChange={(e) => setListen(LISTEN_OPTIONS.map((x) => x.id).filter((id) => (id === o.id ? e.target.checked : listen.includes(id))))}
                      />
                      <strong>{o.label}</strong>
                      <span className="small">{o.hint}</span>
                    </label>
                  ))}
                </div>
                {listen.length === 0 && (
                  <span className="field-error" role="alert">
                    Pick at least one, or the bot would hear nothing.
                  </span>
                )}
              </fieldset>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="tiles two" role="radiogroup" aria-label="New or existing Slack app">
                <label className={`tile${path === "new" ? " selected" : ""}`}>
                  <input type="radio" name={`${ids}-path`} checked={path === "new"} onChange={() => setPath("new")} />
                  <strong>
                    Create a new Slack app <span className="badge enforce">recommended</span>
                  </strong>
                  <span className="small">Events, permissions, Request URL and Socket Mode off are all pre-filled.</span>
                </label>
                <label className={`tile${path === "existing" ? " selected" : ""}`}>
                  <input type="radio" name={`${ids}-path`} checked={path === "existing"} onChange={() => setPath("existing")} />
                  <strong>Use a Slack app I already have</strong>
                  <span className="small">For a bot that's already in your workspace. You change its event settings by hand.</span>
                </label>
              </div>

              {path === "new" ? (
                <div className="path-body">
                  <a className="btn primary lg" href={createAppUrl(manifest)} target="_blank" rel="noreferrer">
                    Open Slack with this app filled in <Icon name="external" size={16} />
                  </a>
                  <ol className="howto">
                    <li>
                      <span>
                        <b>Pick your workspace</b>, click Next, check the summary, then Create.
                      </span>
                    </li>
                    <li>
                      <span>
                        Slack says the Request URL isn't verified. That's expected: you verify it in step 4, after the signing secret.
                      </span>
                    </li>
                  </ol>
                  <details className="disclosure">
                    <summary>
                      <span>What's pre-filled, or copy the manifest by hand</span>
                      <span className="chev">
                        <Icon name="chevron" size={16} />
                      </span>
                    </summary>
                    <div className="disclosure-body">
                      <dl className="kv">
                        <dt>Bot events</dt>
                        <dd>
                          <Codes items={botEvents} />
                        </dd>
                        <dt>Permissions</dt>
                        <dd>
                          <Codes items={botScopes} />
                        </dd>
                        <dt>Request URL</dt>
                        <dd>
                          <code>{requestUrl}</code>
                        </dd>
                        <dt>Socket Mode</dt>
                        <dd>Off</dd>
                      </dl>
                      <p className="hint">If the button doesn't open Slack: choose Create New App → From a manifest, and paste this JSON.</p>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <CopyButton value={JSON.stringify(manifest, null, 2)} label="Copy manifest" />
                      </div>
                      <textarea readOnly value={JSON.stringify(manifest, null, 2)} aria-label="Slack app manifest" onFocus={(e) => e.target.select()} />
                    </div>
                  </details>
                </div>
              ) : (
                <div className="path-body">
                  <p className="small muted" style={{ marginBottom: 10 }}>
                    Open your app at{" "}
                    <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
                      api.slack.com/apps
                    </a>{" "}
                    and check:
                  </p>
                  <ol className="howto">
                    <li>
                      <span>
                        <b>Socket Mode is off</b> (Settings → Socket Mode). With it on, Slack sends events over a WebSocket and never calls the gateway.
                      </span>
                    </li>
                    <li>
                      <span>Save the app's current Event Subscriptions Request URL somewhere. Putting it back is your way back.</span>
                    </li>
                    <li>
                      <span>Don't change the Request URL yet: that comes in step 4, after the signing secret.</span>
                    </li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <form
              id={`${ids}-secret-form`}
              onSubmit={(e) => {
                e.preventDefault();
                saveSecret();
              }}
            >
              <ol className="howto">
                <li>
                  <span>In your Slack app, open Basic Information → App Credentials.</span>
                </li>
                <li>
                  <span>
                    Next to <b>Signing Secret</b>, click Show, then copy it. Not the Client Secret, not the Verification Token.
                  </span>
                </li>
              </ol>
              <label className="field">
                <span className="label">Signing Secret</span>
                <span className="secret-row">
                  <input
                    type={showSecret ? "text" : "password"}
                    className="mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    onBlur={() => setTouched({ ...touched, secret: true })}
                    aria-invalid={Boolean(touched.secret && secretError)}
                    aria-describedby={`${ids}-secret-hint ${ids}-secret-err`}
                  />
                  <button type="button" className="btn icon-btn" aria-label={showSecret ? "Hide the secret" : "Show the secret"} aria-pressed={showSecret} onClick={() => setShowSecret(!showSecret)}>
                    <Icon name={showSecret ? "eyeOff" : "eye"} size={16} />
                  </button>
                </span>
                <span className={`meter${secretOk ? " ok" : ""}`}>
                  {secretOk ? (
                    <>
                      <Icon name="check" size={14} /> Looks like a signing secret
                    </>
                  ) : (
                    <span className="num">{secretLength} / 32 characters</span>
                  )}
                </span>
                <span className="hint" id={`${ids}-secret-hint`}>
                  Stored as a secret on your Cloudflare Worker. It's not kept on this computer.
                </span>
                {touched.secret && secretError && (
                  <span className="field-error" id={`${ids}-secret-err`}>
                    {secretError}
                  </span>
                )}
              </label>
              <ErrorNotice error={action.error} />
            </form>
          )}

          {step === 3 && (
            <div>
              <div className="notice ok small">
                Saved: the gateway now knows <code>{appKey}</code> and its signing secret.
              </div>
              <h4 className="tune-title">Finish in Slack</h4>
              <ul className="todos">
                {path === "new" ? (
                  <>
                    <Todo i={0} ticked={ticked} tick={tick} title="Verify the Request URL">
                      In your Slack app, open <b>Event Subscriptions</b> and click <b>Retry</b> (or Verify) next to the Request URL. It should show Verified.
                    </Todo>
                    <Todo i={1} ticked={ticked} tick={tick} title="Install the app">
                      Open <b>Install App</b> (or OAuth &amp; Permissions) and click <b>Install to Workspace</b>.
                    </Todo>
                    <Todo i={2} ticked={ticked} tick={tick} title="Invite the bot to a test channel">
                      <CopyField value={`/invite @${handle}`} label="Invite command" />
                    </Todo>
                    <Todo i={3} ticked={ticked} tick={tick} title={hearsChat ? "Post a message there" : "Mention the bot there"}>
                      {hearsChat ? "Anything will do." : `Write @${handle} and something after it.`} It should appear in the live check below within a couple of seconds.
                    </Todo>
                  </>
                ) : (
                  <>
                    <Todo i={0} ticked={ticked} tick={tick} title="Point Slack at the gateway">
                      In your Slack app, open <b>Event Subscriptions</b>, turn on Enable Events, and paste the Request URL. It should show Verified.
                      <CopyField value={requestUrl} label="Request URL" />
                    </Todo>
                    <Todo i={1} ticked={ticked} tick={tick} title="Subscribe to bot events, then Save Changes">
                      Under Subscribe to bot events, add only these (the ones you chose in step 1):
                      <CopyField value={botEvents.join(" ")} label="Bot events" />
                    </Todo>
                    <Todo i={2} ticked={ticked} tick={tick} title="Reinstall if Slack asks">
                      Slack asks you to reinstall the app after you change permissions or events.
                    </Todo>
                    <Todo i={3} ticked={ticked} tick={tick} title={hearsChat ? "Post a message where the bot is" : "Mention the bot where it is"}>
                      Make sure the bot is in the channel you'll test in.
                    </Todo>
                  </>
                )}
              </ul>
              <LiveCheck appKey={appKey} botHandle={path === "new" ? handle : undefined} mentionOnly={!hearsChat} />
            </div>
          )}

          <div className="wizard-foot">
            {step === 0 && (
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            )}
            {(step === 1 || step === 2) && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)} disabled={action.busy}>
                Back
              </button>
            )}
            {step === 3 && (
              <button type="button" className="btn" onClick={onCancel}>
                Back to Apps
              </button>
            )}
            {step < 2 && (
              <button type="button" className="btn primary" onClick={next}>
                {step === 1 && path === "new" ? "I've created it, next" : "Next"}
              </button>
            )}
            {step === 2 && (
              <button type="submit" form={`${ids}-secret-form`} className="btn primary" disabled={action.busy}>
                {action.busy ? "Saving…" : "Save secret and continue"}
              </button>
            )}
            {step === 3 && (
              <button type="button" className="btn primary" onClick={() => onDone(appKey)}>
                Next: add a route
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Codes({ items }: { items: readonly string[] }) {
  return (
    <span className="chips tight">
      {items.map((x) => (
        <code key={x} className="code-chip">
          {x}
        </code>
      ))}
    </span>
  );
}

function Todo({ i, ticked, tick, title, children }: { i: number; ticked: Set<number>; tick: (i: number, on: boolean) => void; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <li className={`todo${ticked.has(i) ? " done" : ""}`}>
      <input type="checkbox" id={id} checked={ticked.has(i)} onChange={(e) => tick(i, e.target.checked)} />
      <div>
        <label htmlFor={id} className="todo-title">
          {title}
        </label>
        <div className="todo-body small">{children}</div>
      </div>
    </li>
  );
}

function slugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
