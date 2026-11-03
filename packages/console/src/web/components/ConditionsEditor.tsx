/**
 * Conditions on fields of a request (Route.match), one row each: field, test,
 * value. Fields come from the source's catalog, or any dot path for fields it
 * doesn't know. Every row must pass for a request to be forwarded.
 */

import { useId, useState } from "react";
import type { Condition, ConditionOp } from "@gw/shared";
import type { FieldInfo } from "../sources";
import { Icon } from "./icons";
import { splitList } from "./ui";

const OPS: [ConditionOp, string][] = [
  ["is", "is"],
  ["isNot", "is not"],
  ["in", "is one of"],
  ["notIn", "is not one of"],
  ["matches", "matches pattern"],
  ["exists", "is present"],
  ["missing", "is missing"],
];
const OTHER = "__other";

export function ConditionsEditor({
  conditions,
  onChange,
  fields,
  lists,
}: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  fields: FieldInfo[];
  lists: string[];
}) {
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="conditions">
      {conditions.length === 0 && <p className="tune-hint">No conditions: every request of the chosen kinds is forwarded.</p>}
      {conditions.map((c, i) => (
        <Row key={i} n={i} c={c} fields={fields} lists={lists} onChange={(patch) => set(i, patch)} onRemove={() => onChange(conditions.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...conditions, { field: fields[0]?.path ?? "", op: "is", value: "" }])}>
        <Icon name="plus" size={14} /> Add condition
      </button>
    </div>
  );
}

function Row({ n, c, fields, lists, onChange, onRemove }: { n: number; c: Condition; fields: FieldInfo[]; lists: string[]; onChange: (p: Partial<Condition>) => void; onRemove: () => void }) {
  const id = useId();
  const known = fields.find((f) => f.path === c.field);
  const custom = !known;
  const needsValue = c.op !== "exists" && c.op !== "missing";
  const isList = c.op === "in" || c.op === "notIn";
  const listRef = typeof c.value === "string" && c.value.startsWith("@") ? c.value : "";
  const text = Array.isArray(c.value) ? c.value.join(", ") : listRef ? "" : (c.value ?? "");
  // Lists are typed as "a, b": keep the raw text so a comma isn't swallowed before the next value.
  const [raw, setRaw] = useState(text);

  return (
    <div className="cond-row" role="group" aria-label={`Condition ${n + 1}`}>
      <div className="cond-field">
        {fields.length > 0 && (
          <select aria-label="Field" value={custom ? OTHER : c.field} onChange={(e) => onChange({ field: e.target.value === OTHER ? "" : e.target.value })}>
            {fields.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
            <option value={OTHER}>Other field…</option>
          </select>
        )}
        {custom && <input type="text" className="mono" aria-label="Field path" placeholder="e.g. data.object.status" value={c.field} onChange={(e) => onChange({ field: e.target.value })} />}
      </div>
      <select aria-label="Test" value={c.op} onChange={(e) => onChange({ op: e.target.value as ConditionOp, value: e.target.value === "exists" || e.target.value === "missing" ? undefined : (c.value ?? "") })}>
        {OPS.map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>
      <div className="cond-value">
        {needsValue && isList && lists.length > 0 && (
          <select aria-label="Values" value={listRef} onChange={(e) => onChange({ value: e.target.value || splitList(raw) })}>
            <option value="">Values I type</option>
            {lists.map((l) => (
              <option key={l} value={`@${l}`}>
                List @{l}
              </option>
            ))}
          </select>
        )}
        {needsValue && !listRef && (
          <>
            <input
              type="text"
              className={c.op === "matches" ? "mono" : undefined}
              aria-label={isList ? "Values, separated by commas" : c.op === "matches" ? "Regular expression" : "Value"}
              placeholder={isList ? "a, b, c" : c.op === "matches" ? "e.g. ^release/" : "value"}
              list={known?.suggestions ? `${id}-sugg` : undefined}
              value={isList ? raw : text}
              onChange={(e) => {
                setRaw(e.target.value);
                onChange({ value: isList ? splitList(e.target.value) : e.target.value });
              }}
            />
            {known?.suggestions && (
              <datalist id={`${id}-sugg`}>
                {known.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
      <button type="button" className="btn icon-btn" aria-label={`Remove condition ${n + 1}`} onClick={onRemove}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
