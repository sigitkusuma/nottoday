/**
 * A list-valued filter field: leave it off, type IDs, choose a saved list, or
 * create a list right here without leaving the route. A new list is saved at
 * once (lists belong to the whole gateway, not to this route), then selected.
 * No <form> elements: this sits inside the route editor's form.
 */

import { useId, useState } from "react";
import { useConfig } from "../config";
import { LIST_FIELD_KINDS, idProblems, listNameError, pickerMode, suggestListName, whereToFindIds, type ListField } from "../listPicker";
import { Chip } from "./parts";
import { SyncFromN8n } from "./Lists";
import { ErrorNotice, splitList, timeAgo, useAction } from "./ui";

const NONE = "";
const TYPE_IDS = "__ids";
const NEW_LIST = "__new";

export function ListPicker({
  field,
  label,
  hint,
  value,
  onChange,
  n8nConnected,
}: {
  field: ListField;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  n8nConnected: boolean;
}) {
  const id = useId();
  const { config } = useConfig();
  const kind = LIST_FIELD_KINDS[field];
  const lists = config?.lists ?? {};
  const names = Object.keys(lists);
  const [mode, setMode] = useState<"none" | "ids" | "list" | "new">(pickerMode(value));

  const selectValue = mode === "new" ? NEW_LIST : mode === "ids" ? TYPE_IDS : mode === "list" ? value.trim() : NONE;
  const missing = mode === "list" && !(value.trim().slice(1) in lists);

  const choose = (v: string) => {
    if (v === NONE) {
      setMode("none");
      onChange("");
    } else if (v === TYPE_IDS) {
      setMode("ids");
      if (pickerMode(value) !== "ids") onChange("");
    } else if (v === NEW_LIST) {
      setMode("new");
    } else {
      setMode("list");
      onChange(v);
    }
  };

  return (
    <div className="field list-picker">
      <label className="label" htmlFor={`${id}-select`}>
        {label}
      </label>
      <select id={`${id}-select`} value={selectValue} onChange={(e) => choose(e.target.value)} aria-describedby={`${id}-hint`}>
        <option value={NONE}>Not used</option>
        <option value={TYPE_IDS}>IDs I type</option>
        {names.length > 0 && (
          <optgroup label="Saved lists">
            {names.map((n) => (
              <option key={n} value={`@${n}`}>
                @{n} ({lists[n].length})
              </option>
            ))}
          </optgroup>
        )}
        {missing && <option value={value.trim()}>{value.trim()} (doesn't exist)</option>}
        <option value={NEW_LIST}>New list…</option>
      </select>

      {mode === "ids" && <TypedIds id={id} kind={kind} value={value} onChange={onChange} />}
      {mode === "list" && !missing && <ListSummary name={value.trim().slice(1)} />}
      {mode === "list" && missing && (
        <div className="notice warn small" role="alert">
          The list {value.trim()} doesn't exist. Choose another, or create it with "New list…".
        </div>
      )}
      {mode === "new" && (
        <NewList
          field={field}
          kind={kind}
          existing={names}
          n8nConnected={n8nConnected}
          onCancel={() => setMode(pickerMode(value))}
          onCreated={(name) => {
            setMode("list");
            onChange(`@${name}`);
          }}
        />
      )}
      <span className="hint" id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

function TypedIds({ id, kind, value, onChange }: { id: string; kind: "person" | "channel"; value: string; onChange: (v: string) => void }) {
  const problems = idProblems(splitList(value).filter((v) => !v.startsWith("@")), kind);
  return (
    <>
      <input
        type="text"
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={kind === "person" ? "U01ABC23, U02DEF45" : "C01ABC23, C02DEF45"}
        aria-describedby={problems.length ? `${id}-problems` : undefined}
        aria-label="Slack IDs, separated by commas"
      />
      {problems.length > 0 && (
        <span className="field-warning" id={`${id}-problems`}>
          {problems.join(", ")} {problems.length === 1 ? "doesn't look" : "don't look"} like a Slack ID, so {problems.length === 1 ? "it" : "they"} will never match.{" "}
          {whereToFindIds(kind)}
        </span>
      )}
    </>
  );
}

function ListSummary({ name }: { name: string }) {
  const { config } = useConfig();
  const values = config?.lists[name] ?? [];
  const source = config?.listSources?.[name];
  return (
    <div className="list-summary small">
      <strong>{values.length}</strong> {values.length === 1 ? "value" : "values"}
      {values.length > 0 && (
        <span className="value-chips" style={{ marginTop: 6 }}>
          {values.slice(0, 5).map((v) => (
            <code key={v} className="code-chip">
              {v}
            </code>
          ))}
          {values.length > 5 && <span className="muted"> +{values.length - 5} more</span>}
        </span>
      )}
      <div className="muted" style={{ marginTop: 4 }}>
        {source ? `Copied from the n8n table "${source.tableName}", ${timeAgo(source.syncedAt)}.` : "Typed in."} Edit it on the Lists page after saving this route.
      </div>
    </div>
  );
}

function NewList({
  field,
  kind,
  existing,
  n8nConnected,
  onCancel,
  onCreated,
}: {
  field: ListField;
  kind: "person" | "channel";
  existing: string[];
  n8nConnected: boolean;
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const id = useId();
  const { config, save, reload } = useConfig();
  const [name, setName] = useState(() => suggestListName(field, existing));
  const [source, setSource] = useState<"type" | "n8n">("type");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const action = useAction();

  const nameError = listNameError(name, existing);
  const values = [...new Set(splitList(text))];
  const problems = idProblems(values, kind);
  const valuesError = values.length === 0 ? "Add at least one ID." : "";

  const createTyped = () => {
    setTouched(true);
    if (nameError || valuesError || !config) return;
    void action.run(async () => {
      await save({ ...config, lists: { ...config.lists, [name.trim()]: values } });
      onCreated(name.trim());
    });
  };

  // Enter here must not submit the route form around us.
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (source === "type" && (e.target as HTMLElement).tagName === "INPUT") createTyped();
  };

  return (
    <div className="new-list" role="group" aria-label="New list" onKeyDown={onEnter}>
      <label className="field" style={{ marginBottom: 8 }}>
        <span className="label">List name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(touched && nameError)} aria-describedby={`${id}-name-err`} />
        {touched && nameError && (
          <span className="field-error" id={`${id}-name-err`}>
            {nameError}
          </span>
        )}
        <span className="hint">Other routes can use it as @{name.trim() || "name"}.</span>
      </label>

      {n8nConnected && (
        <div className="chips" role="radiogroup" aria-label="Where the IDs come from" style={{ marginBottom: 12 }}>
          <Chip type="radio" name={`${id}-source`} checked={source === "type"} onChange={() => setSource("type")}>
            I type the IDs
          </Chip>
          <Chip type="radio" name={`${id}-source`} checked={source === "n8n"} onChange={() => setSource("n8n")}>
            Copy from an n8n data table
          </Chip>
        </div>
      )}

      {source === "type" ? (
        <>
          <label className="field" style={{ marginBottom: 8 }}>
            <span className="label">Slack IDs</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === "person" ? "U01ABC23\nU02DEF45" : "C01ABC23\nC02DEF45"}
              aria-invalid={Boolean(touched && valuesError)}
              aria-describedby={`${id}-values-hint`}
              style={{ minHeight: 80 }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="hint" id={`${id}-values-hint`}>
              One per line or separated by commas. {whereToFindIds(kind)}
            </span>
            {touched && valuesError && <span className="field-error">{valuesError}</span>}
            {problems.length > 0 && (
              <span className="field-warning">
                {problems.join(", ")} {problems.length === 1 ? "doesn't look" : "don't look"} like a Slack ID of this kind.
              </span>
            )}
          </label>
          <ErrorNotice error={action.error} />
          <div className="row">
            <button type="button" className="btn primary" disabled={action.busy} onClick={createTyped}>
              {action.busy ? "Creating…" : "Create list"}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <SyncFromN8n
            name={name.trim()}
            disabledReason={nameError || undefined}
            onDone={async () => {
              await reload();
              onCreated(name.trim());
            }}
          />
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
