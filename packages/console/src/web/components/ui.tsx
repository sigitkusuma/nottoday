import { useState, type ReactNode } from "react";
import { ApiError, errorText } from "../api";

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.errors : [];
  return (
    <div className="notice error" role="alert">
      {errorText(error)}
      {details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** A button that copies `value`; says so for a moment. */
export function CopyButton({ value, label = "Copy", className = "btn" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: the text stays selectable wherever it's shown.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="copy">
      <input type="text" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <CopyButton value={value} />
    </div>
  );
}

/** Runs an async action with a busy flag and an error to show. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** A destructive button that needs a second click to confirm. */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className = "btn danger" }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row">
      <button type="button" className={className} disabled={disabled} onClick={() => (setArmed(false), onConfirm())}>
        {confirmLabel}
      </button>
      <button type="button" className="btn" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

export function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const t = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const fmt = (n: number) => n.toLocaleString();

/** "a, b , c" → ["a", "b", "c"] */
export const splitList = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
