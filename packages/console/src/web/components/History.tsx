/** Earlier versions of the config (restore any), plus export/import as JSON and account settings. */

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../config";
import type { GoTo } from "../App";
import type { GatewayConfig, Status } from "../types";
import { PageHead } from "./parts";
import { ConfirmButton, ErrorNotice, timeAgo, useAction } from "./ui";

export function History({ status, goTo }: { status: Status; onStatusChange: () => void; goTo: GoTo }) {
  const { config, reload, save } = useConfig();
  const [versions, setVersions] = useState<{ key: string; savedAt: string }[] | null>(null);
  const [viewing, setViewing] = useState<{ key: string; config: GatewayConfig } | null>(null);
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () => action.run(async () => setVersions((await api<{ versions: { key: string; savedAt: string }[] }>("GET", "/config/history")).versions));
  useEffect(() => void load(), []);

  const [all, setAll] = useState(false);
  const shown = all ? versions : versions?.slice(0, 8);

  return (
    <>
      <PageHead title="Versions" sub="Every save keeps the version it replaced (the last 50). Restoring one is itself a save, so it can be undone the same way." />
      <ErrorNotice error={action.error} />

      <div className="detail-grid">
        <section className="block" aria-labelledby="hist-title">
          <h3 id="hist-title">History</h3>
          {versions === null && <p className="muted">Loading…</p>}
          {versions && versions.length === 0 && <p className="muted">No earlier versions yet. They appear after the first save.</p>}
          {shown && shown.length > 0 && (
            <ol className="timeline">
              {shown.map((v) => (
                <li key={v.key} className={viewing?.key === v.key ? "viewing" : ""}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div className="timeline-main">
                    <b>{new Date(v.savedAt).toLocaleString()}</b>
                    <span className="muted small">replaced {timeAgo(v.savedAt)}</span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => void action.run(async () => setViewing({ key: v.key, config: (await api<{ config: GatewayConfig }>("GET", `/config/history/${encodeURIComponent(v.key)}`)).config }))}
                    >
                      View
                    </button>
                    <ConfirmButton
                      className="btn sm"
                      label="Restore"
                      confirmLabel="Restore this version"
                      disabled={action.busy}
                      onConfirm={() => void action.run(async () => (await api("POST", "/config/rollback", { key: v.key }), await reload(), await load()))}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
          {versions && versions.length > 8 && (
            <button type="button" className="btn link" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${versions.length}`}
            </button>
          )}
          {viewing && (
            <>
              <div className="spread" style={{ marginTop: 14 }}>
                <h4>Version from {new Date(viewing.key.slice(15, 39)).toLocaleString()}</h4>
                <button type="button" className="btn sm" onClick={() => setViewing(null)}>
                  Close
                </button>
              </div>
              <pre className="json">{JSON.stringify(viewing.config, null, 2)}</pre>
            </>
          )}
        </section>

        <div>
          <section className="block" aria-labelledby="backup-title">
            <h3 id="backup-title">Backup</h3>
            <p className="muted small">The config as JSON: apps, routes and lists. Signing secrets are not in it; they stay on Cloudflare.</p>
            <div className="row">
              <button type="button" className="btn" disabled={!config} onClick={() => config && download(config)}>
                Export JSON
              </button>
              <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                Import JSON…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void action.run(async () => (await save(JSON.parse(await file.text()) as GatewayConfig), await load()));
                }}
              />
            </div>
            <p className="hint">Importing replaces the whole config (the current one is kept as a version). Apps it adds need their signing secret set under Bots.</p>
          </section>

          <section className="block" aria-labelledby="cf-title">
            <h3 id="cf-title">Cloudflare</h3>
            <p className="small">
              Account <strong>{status.cloudflare?.accountName}</strong>, Worker <code>{status.gateway?.scriptName}</code>.
            </p>
            <button type="button" className="btn" onClick={() => goTo("cloudflare")}>
              Switch, add or forget accounts
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

function download(config: GatewayConfig) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `gateway-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
