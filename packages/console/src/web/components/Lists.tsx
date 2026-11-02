/** Named lists used by filters as "@name", typed in or copied from an n8n data table. */

import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../config";
import type { GatewayConfig, Status } from "../types";
import { Icon } from "./icons";
import { Empty, PageHead } from "./parts";
import { ConfirmButton, ErrorNotice, Field, splitList, timeAgo, useAction } from "./ui";

interface Table {
  id: string;
  name: string;
  columns: string[];
}

export function Lists({ status }: { status: Status }) {
  const { config, save, reload, loadError } = useConfig();
  const [newName, setNewName] = useState("");
  const action = useAction();

  if (loadError) return <ErrorNotice error={loadError} />;
  if (!config) return <p className="muted">Loading…</p>;

  const usedBy = (name: string) =>
    Object.entries(config.apps).flatMap(([app, a]) =>
      a.routes.filter((r) => r.filters && Object.values(r.filters).some((v) => v === `@${name}`)).map((r) => `${app} / ${r.name}`),
    );
  const names = Object.keys(config.lists);

  return (
    <>
      <PageHead
        title="Lists"
        sub="Reusable sets of Slack IDs, used in route filters as @name. If a workflow checks against an n8n data table (for example who's on call), copy that table here so the gateway's list matches it. A list that falls behind drops messages the workflow would have acted on."
      />

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          void action.run(async () => {
            if (!/^[\w-]+$/.test(name)) throw new Error("Use letters, digits, - or _ for the list name.");
            if (config.lists[name]) throw new Error(`A list named ${name} already exists.`);
            await save({ ...config, lists: { ...config.lists, [name]: [] } });
            setNewName("");
          });
        }}
      >
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New list name, e.g. oncall" aria-label="New list name" />
        <button type="submit" className="btn primary" disabled={action.busy || !newName.trim()}>
          <Icon name="plus" size={15} /> Add list
        </button>
      </form>
      <ErrorNotice error={action.error} />

      {names.length === 0 ? (
        <Empty title="No lists yet">Add one above, for example "oncall" with the Slack IDs of the people on call. Then pick it in a route's filters.</Empty>
      ) : (
        <div className="list-grid">
          {Object.entries(config.lists).map(([name, values]) => (
            <ListCard key={name} name={name} values={values} config={config} usedBy={usedBy(name)} status={status} save={save} reload={reload} />
          ))}
        </div>
      )}
    </>
  );
}

const PREVIEW = 14;

function ListCard({
  name,
  values,
  config,
  usedBy,
  status,
  save,
  reload,
}: {
  name: string;
  values: string[];
  config: GatewayConfig;
  usedBy: string[];
  status: Status;
  save: (c: GatewayConfig) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [text, setText] = useState(values.join("\n"));
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const action = useAction();
  const source = config.listSources?.[name];
  const dirty = text.trim() !== values.join("\n");

  useEffect(() => setText(values.join("\n")), [values]);

  const resync = () =>
    action.run(async () => {
      if (!source) return;
      const r = await api<{ added: string[]; removed: string[]; values: string[] }>("POST", `/lists/${name}/sync`, source);
      await reload();
      setResult(`Refreshed: ${r.values.length} values, ${r.added.length} added, ${r.removed.length} removed.`);
    });

  const shown = showAll ? values : values.slice(0, PREVIEW);

  return (
    <section className="list-card" aria-labelledby={`list-${name}`}>
      <div className="list-head">
        <h3 id={`list-${name}`} className="mono">
          @{name}
        </h3>
        <span className="badge">
          {values.length} {values.length === 1 ? "value" : "values"}
        </span>
      </div>

      <div className="list-meta small">
        {usedBy.length ? (
          <span className="chips tight">
            <span className="muted">Used by</span>
            {usedBy.map((u) => (
              <span key={u} className="code-chip">
                {u}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">Not used by any route yet</span>
        )}
        {source && (
          <span className="list-source">
            <Icon name="workflow" size={14} /> From n8n table <b>{source.tableName}</b> · <code>{source.column}</code> · {timeAgo(source.syncedAt)}{" "}
            {status.n8n ? (
              <button type="button" className="btn link" disabled={action.busy} onClick={() => void resync()}>
                Refresh now
              </button>
            ) : (
              <span className="muted">Connect n8n to refresh.</span>
            )}
          </span>
        )}
      </div>
      {result && <div className="notice ok small">{result}</div>}

      {editing ? (
        <div>
          <Field label="Values" hint={source ? "Edits here are replaced by the next refresh from n8n." : "One ID per line (or comma-separated)."}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`Values of ${name}`} />
          </Field>
          <ErrorNotice error={action.error} />
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await save({ ...config, lists: { ...config.lists, [name]: [...new Set(splitList(text))] } });
                  setEditing(false);
                })
              }
            >
              Save values
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText(values.join("\n"));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {values.length === 0 ? (
            <p className="muted small">Empty. Add values, or copy them from an n8n data table.</p>
          ) : (
            <div className="value-chips">
              {shown.map((v) => (
                <code key={v} className="code-chip">
                  {v}
                </code>
              ))}
              {values.length > PREVIEW && (
                <button type="button" className="btn link small" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Show fewer" : `+${values.length - PREVIEW} more`}
                </button>
              )}
            </div>
          )}
          <ErrorNotice error={action.error} />
          <div className="row list-actions">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit values
            </button>
            {status.n8n && (
              <button type="button" className="btn" aria-pressed={syncing} onClick={() => setSyncing(!syncing)}>
                {source ? "Change n8n source" : "Copy from n8n table"}
              </button>
            )}
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete list"
              disabled={action.busy || usedBy.length > 0}
              onConfirm={() =>
                void action.run(async () => {
                  const lists = { ...config.lists };
                  delete lists[name];
                  const listSources = { ...config.listSources };
                  delete listSources[name];
                  await save({ ...config, lists, listSources });
                })
              }
            />
          </div>
          {usedBy.length > 0 && <p className="hint">Remove it from the routes that use it before deleting.</p>}
        </>
      )}
      {syncing && (
        <SyncFromN8n
          name={name}
          onDone={async (message) => {
            setSyncing(false);
            setResult(message);
            await reload();
          }}
        />
      )}
    </section>
  );
}

/**
 * Copies one column of an n8n data table into a list, then reports how many
 * values it got. No <form>: it also appears inside the route editor's form,
 * and forms can't nest.
 */
export function SyncFromN8n({ name, onDone, disabledReason }: { name: string; onDone: (message: string) => void; disabledReason?: string }) {
  const [tables, setTables] = useState<Table[] | null>(null);
  const [tableId, setTableId] = useState("");
  const [column, setColumn] = useState("");
  const load = useAction();
  const action = useAction();
  const table = tables?.find((t) => t.id === tableId);

  useEffect(() => {
    void load.run(async () => setTables((await api<{ tables: Table[] }>("GET", "/n8n/data-tables")).tables));
  }, []);

  const copy = () =>
    action.run(async () => {
      const r = await api<{ values: string[]; added: string[]; removed: string[] }>("POST", `/lists/${name}/sync`, { tableId, tableName: table?.name, column });
      onDone(`Copied ${r.values.length} values (${r.added.length} added, ${r.removed.length} removed).`);
    });

  return (
    <div className="sync-box">
      <ErrorNotice error={load.error} />
      {tables && tables.length === 0 && <p className="muted">This n8n instance has no data tables, or its version doesn't expose them through the API.</p>}
      {tables && tables.length > 0 && (
        <>
          <Field label="Data table">
            <select value={tableId} onChange={(e) => (setTableId(e.target.value), setColumn(""))}>
              <option value="">Choose…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          {table && (
            <Field label="Column with the IDs">
              <select value={column} onChange={(e) => setColumn(e.target.value)}>
                <option value="">Choose…</option>
                {table.columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
          <ErrorNotice error={action.error} />
          <button type="button" className="btn primary" disabled={action.busy || !tableId || !column || Boolean(disabledReason)} onClick={() => void copy()}>
            {action.busy ? "Copying…" : "Copy values"}
          </button>
          {disabledReason && <span className="hint">{disabledReason}</span>}
        </>
      )}
    </div>
  );
}
