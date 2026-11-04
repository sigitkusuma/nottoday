/** Small shared pieces of the console's look: status pill, bot avatar, pulse strip, page header. */

import { useId, useState, type ReactNode } from "react";
import { pulse, type PulseTone, type Tone } from "../botHealth";
import { useMaybeAccounts } from "../accounts";
import { Icon } from "./icons";

export function StatusPill({ tone, label, live }: { tone: Tone; label: string; live?: boolean }) {
  return <span className={`pill ${tone === "idle" ? "" : tone}${live ? " live" : ""}`}>{label}</span>;
}

// Muted, distinct hues so bots are easy to tell apart at a glance. Decorative: the name is always next to it.
const HUES = ["#4b6bdc", "#0e8f7a", "#b0562a", "#7a4fc7", "#c0394f", "#5d7a1f", "#1f7aa8", "#9a6a00"];
const hueOf = (key: string) => HUES[[...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

export function Avatar({ name, size }: { name: string; size?: number }) {
  return (
    <span className="avatar" aria-hidden="true" style={{ background: hueOf(name), ...(size ? { width: size, height: size, fontSize: size * 0.42 } : {}) }}>
      {name.slice(0, 1)}
    </span>
  );
}

const PULSE_TEXT: Record<PulseTone, string> = {
  sent: "Sent to n8n",
  saved: "Dropped by a filter (execution saved)",
  shadow: "Shadow: forwarded, would drop",
  unrouted: "No route lists it: dropped",
  error: "n8n didn't accept it",
  bad: "Rejected",
  info: "Slack check",
};

export function PulseLegend() {
  const tones: PulseTone[] = ["sent", "saved", "shadow", "unrouted", "error", "bad"];
  return (
    <div className="legend" aria-label="What the squares mean">
      {tones.map((t) => (
        <span key={t}>
          <i className={t} />
          {PULSE_TEXT[t]}
        </span>
      ))}
    </div>
  );
}

export function PulseStrip({ live, bot, emptyText = "No events since you opened the console" }: { live: Parameters<typeof pulse>[0]; bot: string; emptyText?: string }) {
  const dots = pulse(live, bot);
  if (dots.length === 0) return emptyText ? <span className="pulse-empty">{emptyText}</span> : <span />;
  return (
    <span className="pulse-strip" role="img" aria-label={`Last ${dots.length} events, newest first: ${dots.map((d) => d.title).join(", ")}`}>
      {dots.map((d, i) => (
        <i key={i} className={d.tone} title={d.title} />
      ))}
    </span>
  );
}

/** Next to a page title when there are several accounts, so it's always clear which gateway the page is about. */
function AccountChip() {
  const acc = useMaybeAccounts();
  if (!acc?.multiple || !acc.active) return null;
  return (
    <span className="acct-chip" title={`This page is about the gateway in ${acc.active.name}. Switch accounts at the top of the sidebar.`}>
      <Avatar name={acc.active.name} size={16} />
      {acc.active.name}
    </span>
  );
}

export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { label: string; onClick: () => void } }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <div className="crumb">
            <Icon name="back" size={14} />
            <button type="button" className="btn link" onClick={back.onClick}>
              {back.label}
            </button>
          </div>
        )}
        <div className="title-row">
          <h2>{title}</h2>
          <AccountChip />
        </div>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card empty">
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: "52ch", margin: "0 auto" }}>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/** A pill-shaped choice. The real input is stretched over it, so the whole pill is the click target and keyboard focus is visible. */
export function Chip({ type = "checkbox", name, checked, onChange, children }: { type?: "checkbox" | "radio"; name?: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className={`chip${checked ? " on" : ""}`}>
      <input type={type} name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked && <Icon name="check" size={14} />}
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (on: boolean) => void; title: string; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** A password-style field with a show/hide button, for tokens and keys. */
export function SecretField({ label, hint, value, onChange, required }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <span className="secret-row">
        <input id={id} type={show ? "text" : "password"} className="mono" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} required={required} aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" className="btn icon-btn" aria-label={show ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`} aria-pressed={show} onClick={() => setShow(!show)}>
          <Icon name={show ? "eyeOff" : "eye"} size={16} />
        </button>
      </span>
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
