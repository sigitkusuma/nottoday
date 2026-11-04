/**
 * "Connect an app": pick where requests come from, then a short flow for that
 * kind of app. Slack keeps its own four-step wizard; GitHub, Telegram and any
 * webhook share the same shape: name it, connect it, check it live.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { requestPath, type SourceType, type WebhookVerify } from "@gw/shared";
import { api } from "../api";
import { useConfig } from "../config";
import { SOURCES, VERIFY_PRESETS, sourceInfo } from "../sources";
import type { Status } from "../types";
import { GatewayPicker } from "./Accounts";
import { ConnectSlackApp } from "./ConnectSlackApp";
import { Icon } from "./icons";
import { LiveCheck } from "./LiveCheck";
import { Chip, PageHead, SecretField } from "./parts";
import { CopyField, ErrorNotice, Field, useAction } from "./ui";

interface Props {
  status: Status;
  onCancel: () => void;
  onDone: (appKey: string) => void;
}

export function ConnectApp(props: Props) {
  const [source, setSource] = useState<SourceType | null>(null);
  if (source === "slack") return <ConnectSlackApp status={props.status} onBack={() => setSource(null)} onCancel={props.onCancel} onDone={props.onDone} />;
  if (source) return <ConnectOther {...props} source={source} onBack={() => setSource(null)} />;
  return (
    <>
      <PageHead title="Connect an app" sub="Where do the requests that start your n8n workflow come from?" back={{ label: "Back to Apps", onClick: props.onCancel }} />
      <GatewayPicker />
      <div className="tiles source-tiles">
        {(Object.keys(SOURCES) as SourceType[]).map((id) => {
          const s = SOURCES[id];
          return (
            <button key={id} type="button" className="tile" disabled={!s.available} onClick={() => setSource(id)}>
              <span className="tile-icon" aria-hidden="true">
                <Icon name={s.icon} />
              </span>
              <strong>
                {s.label}
                {!s.available && <span className="badge">coming soon</span>}
              </strong>
              <span className="small">{s.tagline}</span>
            </button>
          );
        })}
      </div>
      {Object.values(SOURCES).some((s) => s.available && s.id !== "slack") && (
        <p className="hint">
          For GitHub, Telegram and webhooks, the n8n workflow starts with a plain <b>Webhook</b> node. n8n's own GitHub and Telegram triggers register their webhook themselves, which would go around the gateway.
        </p>
      )}
    </>
  );
}

const STEPS: Record<Exclude<SourceType, "slack">, string[]> = {
  github: ["Name it", "Add the webhook in GitHub", "Check it"],
  telegram: ["Name it", "Connect the bot", "Check it"],
  webhook: ["Name it", "How it signs requests", "Point the service here", "Check it"],
};

const PLACEHOLDER: Record<Exclude<SourceType, "slack">, string> = { github: "e.g. API repository", telegram: "e.g. Deploy bot", webhook: "e.g. Shop orders" };

function ConnectOther({ status, onCancel, onDone, source, onBack }: Props & { source: Exclude<SourceType, "slack">; onBack: () => void }) {
  const { config, reload } = useConfig();
  const ids = useId();
  const info = sourceInfo(source);
  const steps = STEPS[source];
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState(false);
  const [secret, setSecret] = useState("");
  const [botUser, setBotUser] = useState("");
  const action = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Webhook signing settings.
  const [presetId, setPresetId] = useState(VERIFY_PRESETS[0].id);
  const preset = VERIFY_PRESETS.find((p) => p.id === presetId)!;
  const [verify, setVerify] = useState<WebhookVerify>(preset.verify);
  const [eventField, setEventField] = useState(preset.eventField ?? "");
  const [secretMode, setSecretMode] = useState<"service" | "generate">("generate");
  const [pasted, setPasted] = useState("");
  // A token in the URL is always generated: the service only needs the URL.
  const usesServiceSecret = verify.type !== "url-token" && (Boolean(preset.serviceSecret) || secretMode === "service");

  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [step]);

  const appKey = keyEdited ? key : slugKey(name);
  const url = `${status.gateway!.url}${requestPath(source, appKey || "<name>")}`;
  const nameError = !name.trim() ? "Give it a name." : "";
  const keyError = !appKey
    ? "Needs at least one letter or digit."
    : !/^[a-z0-9_-]+$/.test(appKey)
      ? "Use lowercase letters, digits, - or _."
      : config && Object.hasOwn(config.apps, appKey) && !created
        ? `An app called "${appKey}" already exists in the gateway.`
        : "";

  const create = (body: Record<string, unknown>) =>
    action.run(async () => {
      const r = await api<{ secret?: string }>("POST", "/apps", { key: appKey, source, description: name.trim(), ...body });
      await reload();
      setCreated(true);
      if (r.secret) setSecret(r.secret);
      return true;
    });

  const next = async () => {
    if (step === 0) {
      setTouched(true);
      if (nameError || keyError) {
        if (!nameError) setEditKey(true);
        return;
      }
      // GitHub and Telegram apps are created right away; a webhook first needs its signing settings.
      if (source === "github" && !created && !(await create({ generate: true }))) return;
      if (source === "telegram" && !created && !(await create({}))) return;
    }
    if (source === "webhook" && step === 1 && !created) {
      if (usesServiceSecret && !pasted.trim()) return void action.setError(new Error("Paste the secret from the service, or let the console generate one."));
      const ok = await create({ verify, eventField: eventField.trim() || undefined, ...(usesServiceSecret ? { signingSecret: pasted.trim() } : { generate: true }) });
      if (!ok) return;
      if (usesServiceSecret) setSecret(pasted.trim());
    }
    setStep(step + 1);
  };

  const last = step === steps.length - 1;
  const urlWithToken = verify.type === "url-token" && secret ? `${url}?${verify.param}=${encodeURIComponent(secret)}` : url;
  const canNext = !(source === "telegram" && step === 1 && !botUser);

  return (
    <>
      <PageHead title={`Connect ${source === "webhook" ? "a webhook" : info.label}`} sub={info.tagline} back={{ label: created ? "Back to Apps" : "Other kinds of apps", onClick: created ? onCancel : onBack }} />
      <div className="wizard">
        <nav className="wizard-rail" aria-label="Steps">
          <ol>
            {steps.map((title, i) => (
              <li key={title} className={`rail-step${i < step ? " done" : i === step ? " current" : ""}`} aria-current={i === step ? "step" : undefined}>
                <div className="rail-btn">
                  <span className="rail-dot" aria-hidden="true">
                    {i < step ? <Icon name="check" size={15} /> : i + 1}
                  </span>
                  <span className="rail-text">
                    <span className="rail-title">{title}</span>
                    {i === 0 && <span className="rail-cap">{appKey ? name.trim() || appKey : info.label}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </nav>

        <section className="wizard-pane" aria-labelledby={`${ids}-title`}>
          <div className="wizard-progress" aria-hidden="true">
            <span className="muted small">
              Step {step + 1} of {steps.length} · {steps[step]}
            </span>
            <span className="bar">
              <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            </span>
          </div>
          <p className="muted small step-of">
            Step {step + 1} of {steps.length}
          </p>
          <h3 id={`${ids}-title`} ref={heading} tabIndex={-1}>
            {steps[step]}
          </h3>

          {step === 0 && (
            <div>
              <p className="lead-sm">A name for this {source === "github" ? "repository or organization" : source === "telegram" ? "bot" : "webhook"} in the console. It also becomes part of its address on the gateway.</p>
              <label className="field">
                <span className="label">Name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={PLACEHOLDER[source]} autoFocus disabled={created} aria-invalid={Boolean(touched && nameError)} />
                {touched && nameError && <span className="field-error">{nameError}</span>}
              </label>
              <div className="address">
                <span className="address-label">{info.sender === "the service" ? "The service" : info.sender} will send to</span>
                <code>{url}</code>
                {!editKey && !created && (
                  <button type="button" className="btn link small" onClick={() => setEditKey(true)}>
                    Change the last part
                  </button>
                )}
              </div>
              {(editKey || (touched && keyError)) && !created && (
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
                    aria-invalid={Boolean(touched && keyError)}
                  />
                  {touched && keyError && <span className="field-error">{keyError}</span>}
                </label>
              )}
            </div>
          )}

          {source === "github" && step === 1 && (
            <div>
              <p className="lead-sm">GitHub sends its events to the gateway, which checks each one with this secret.</p>
              <ol className="howto">
                <li>
                  <span>
                    In GitHub, open the repository (or organization) → <b>Settings → Webhooks → Add webhook</b>.
                  </span>
                </li>
                <li>
                  <span className="stack-sm">
                    <b>Payload URL</b>
                    <CopyField value={url} label="Payload URL" />
                  </span>
                </li>
                <li>
                  <span>
                    <b>Content type</b>: <code>application/json</code>
                  </span>
                </li>
                <li>
                  <span className="stack-sm">
                    <b>Secret</b>
                    <CopyField value={secret} label="Webhook secret" />
                    <span className="hint">Shown once. If you lose it, generate a new one on the app's page.</span>
                  </span>
                </li>
                <li>
                  <span>
                    <b>Which events</b>: choose individual events and tick the ones your workflows use, or send everything. Routes drop the rest either way.
                  </span>
                </li>
                <li>
                  <span>
                    Click <b>Add webhook</b>. GitHub sends a ping right away, and the next step shows it arrive.
                  </span>
                </li>
              </ol>
            </div>
          )}

          {source === "telegram" && step === 1 && (
            <div>
              <p className="lead-sm">The console points your bot at the gateway, with a secret only the two of them know.</p>
              <ol className="howto">
                <li>
                  <span>
                    In Telegram, open <b>@BotFather</b>. Send <code>/newbot</code> for a new bot, or <code>/mybots</code> → your bot → <b>API Token</b>.
                  </span>
                </li>
                <li>
                  <span>Paste the token here. It's used once, for this call, and isn't saved.</span>
                </li>
              </ol>
              {botUser ? (
                <div className="notice ok small">
                  <b>@{botUser}</b> now sends its updates to the gateway.
                </div>
              ) : (
                <TelegramConnect appKey={appKey} onConnected={setBotUser} />
              )}
              <p className="hint">If an active n8n workflow uses a Telegram Trigger for this bot, deactivate it: it takes the webhook back when it starts. Use a Webhook node instead.</p>
            </div>
          )}

          {source === "webhook" && step === 1 && (
            <div>
              <p className="lead-sm">The gateway only passes on requests that prove they came from the service.</p>
              <Field label="How the service proves a request is genuine" hint={preset.hint}>
                <select
                  value={presetId}
                  disabled={created}
                  onChange={(e) => {
                    const p = VERIFY_PRESETS.find((x) => x.id === e.target.value)!;
                    setPresetId(p.id);
                    setVerify(structuredClone(p.verify));
                    setEventField(p.eventField ?? "");
                    if (p.serviceSecret) setSecretMode("service");
                  }}
                >
                  {VERIFY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <VerifyFields verify={verify} onChange={setVerify} disabled={created} />
              {verify.type !== "url-token" && !preset.serviceSecret && (
                <div className="chips" role="radiogroup" aria-label="Where the secret comes from" style={{ marginBottom: 12 }}>
                  <Chip type="radio" name={`${ids}-secret`} checked={secretMode === "generate"} onChange={() => setSecretMode("generate")}>
                    Generate one for me
                  </Chip>
                  <Chip type="radio" name={`${ids}-secret`} checked={secretMode === "service"} onChange={() => setSecretMode("service")}>
                    The service gave me one
                  </Chip>
                </div>
              )}
              {usesServiceSecret && <SecretField label="Secret" value={pasted} onChange={setPasted} hint="Stored as a secret on your Cloudflare Worker, not on this computer." />}
              <Field label="Event name (optional)" hint="Where the request says what happened: header:x-event-name, or a field such as type. Lets routes pick events by name. Leave empty if the service sends one kind of request.">
                <input type="text" className="mono" value={eventField} onChange={(e) => setEventField(e.target.value)} disabled={created} placeholder="header:x-event-type" />
              </Field>
            </div>
          )}

          {source === "webhook" && step === 2 && (
            <div>
              <p className="lead-sm">In the service's webhook settings, add a webhook that sends to the gateway.</p>
              <ol className="howto">
                <li>
                  <span className="stack-sm">
                    <b>URL</b> (method POST, JSON body if it asks)
                    <CopyField value={urlWithToken} label="Webhook URL" />
                    {verify.type === "url-token" && <span className="hint">The secret is part of this URL, so treat the URL itself as a secret.</span>}
                  </span>
                </li>
                {verify.type !== "url-token" && !usesServiceSecret && (
                  <li>
                    <span className="stack-sm">
                      <b>Secret</b>, in the service's signing secret or token field
                      <CopyField value={secret} label="Webhook secret" />
                      <span className="hint">Shown once. If you lose it, set a new one on the app's page.</span>
                    </span>
                  </li>
                )}
                <li>
                  <span>Save it, then send a test from the service if it has a button for that.</span>
                </li>
              </ol>
            </div>
          )}

          {last && (
            <div>
              <div className="notice ok small">
                Saved: the gateway now knows <code>{appKey}</code> and its secret.
              </div>
              <LiveCheck appKey={appKey} source={source} botHandle={botUser || undefined} />
            </div>
          )}

          <ErrorNotice error={action.error} />
          <div className="wizard-foot">
            {step === 0 ? (
              <button type="button" className="btn" onClick={onBack}>
                Back
              </button>
            ) : last ? (
              <button type="button" className="btn" onClick={onCancel}>
                Back to Apps
              </button>
            ) : created ? (
              <span />
            ) : (
              <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {last ? (
              <button type="button" className="btn primary" onClick={() => onDone(appKey)}>
                Next: add a route
              </button>
            ) : (
              <button type="button" className="btn primary" disabled={action.busy || !canNext} onClick={() => void next()}>
                {action.busy ? "Saving…" : source === "github" && step === 1 ? "I've added it, next" : source === "webhook" && step === 2 ? "I've added it, next" : "Next"}
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function TelegramConnect({ appKey, onConnected }: { appKey: string; onConnected: (username: string) => void }) {
  const [token, setToken] = useState("");
  const action = useAction();
  return (
    <div>
      <SecretField label="Bot token" value={token} onChange={setToken} hint="From BotFather. Used once and not saved." />
      <ErrorNotice error={action.error} />
      <button
        type="button"
        className="btn primary"
        disabled={action.busy || !token.trim()}
        onClick={() =>
          void action.run(async () => {
            const r = await api<{ username: string }>("POST", `/apps/${appKey}/telegram/connect`, { botToken: token.trim() });
            setToken("");
            onConnected(r.username);
          })
        }
      >
        {action.busy ? "Connecting…" : "Connect the bot"}
      </button>
    </div>
  );
}

function VerifyFields({ verify, onChange, disabled }: { verify: WebhookVerify; onChange: (v: WebhookVerify) => void; disabled?: boolean }): ReactNode {
  if (verify.type === "hmac") {
    return (
      <div className="field-grid">
        <Field label="Header">
          <input type="text" className="mono" value={verify.header} disabled={disabled} onChange={(e) => onChange({ ...verify, header: e.target.value.trim() })} />
        </Field>
        <Field label="Prefix (optional)">
          <input type="text" className="mono" value={verify.prefix ?? ""} disabled={disabled} placeholder="sha256=" onChange={(e) => onChange({ ...verify, prefix: e.target.value || undefined })} />
        </Field>
        <Field label="Encoding">
          <select value={verify.encoding} disabled={disabled} onChange={(e) => onChange({ ...verify, encoding: e.target.value as "hex" | "base64" })}>
            <option value="hex">hex</option>
            <option value="base64">base64</option>
          </select>
        </Field>
      </div>
    );
  }
  if (verify.type === "header-token") {
    return (
      <Field label="Header">
        <input type="text" className="mono" value={verify.header} disabled={disabled} onChange={(e) => onChange({ ...verify, header: e.target.value.trim() })} />
      </Field>
    );
  }
  return (
    <Field label="Query parameter" hint="The console generates the secret and puts it in the URL.">
      <input type="text" className="mono" value={verify.param} disabled={disabled} onChange={(e) => onChange({ ...verify, param: e.target.value.trim() })} />
    </Field>
  );
}

function slugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
