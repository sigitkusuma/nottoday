#!/usr/bin/env node
/** `npx nottoday`: starts the console and opens it in the browser. See options.ts for the server modes. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { localHosts, newSessionToken, savedSessionToken, type HostPolicy } from "./access";
import { createApp } from "./app";
import { parseArgs, USAGE } from "./options";
import { stateDir } from "./store";
import { SERVE_HINT, startServe, tailscaleName, TailscaleError } from "./tailscale";
import { fingerprint, machineAddresses, savedSelfSigned, type TlsFiles } from "./tls";
import { version } from "../../package.json";

const parsed = parseArgs(process.argv.slice(2));
if ("help" in parsed) {
  console.log(`${USAGE}\n\nTokens are stored in ${stateDir()} (readable only by you).`);
  process.exit(0);
}
if ("version" in parsed) {
  console.log(version);
  process.exit(0);
}
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const opts = parsed;
const { port, mode } = opts;

// In dev the session token is fixed so the Vite UI (port 5173) can use it.
const dev = process.env.NOTTODAY_DEV === "1";
const webRoot = new URL("./web/", import.meta.url);
const hasWeb = existsSync(fileURLToPath(webRoot));

let sessionToken: string;
let tsName: string | undefined;
let tls: TlsFiles | undefined;
let hosts: HostPolicy = localHosts(port);
const notes: string[] = [];

try {
  if (mode === "tailscale") tsName = await tailscaleName();

  if (dev) sessionToken = "dev";
  else if (mode === "local") sessionToken = newSessionToken();
  else {
    const saved = await savedSessionToken(opts.newToken);
    sessionToken = saved.token;
    if (saved.created) notes.push(opts.newToken ? "New session token: links printed before no longer work." : "Session token saved; it stays the same on later starts. --new-token replaces it.");
  }

  if (opts.tls) tls = { cert: await readFile(opts.tls.cert, "utf8"), key: await readFile(opts.tls.key, "utf8") };
  else if (mode === "direct" && !opts.insecureHttp) {
    const names = [...(opts.host === "0.0.0.0" || opts.host === "::" ? machineAddresses().filter((a) => isIP(a) === 4) : [opts.host]), ...opts.allowHosts];
    const made = await savedSelfSigned(names);
    tls = made;
    if (made.created) notes.push(`Made a self-signed certificate (in ${stateDir()}/tls).`);
  }

  if (mode === "direct") hosts = { port, names: [...hosts.names, ...opts.allowHosts, ...(isIP(opts.host) ? [] : [opts.host.toLowerCase()])], anyIp: true };
  if (tsName) hosts = { ...hosts, bareNames: [tsName] };
} catch (err) {
  console.error(err instanceof TailscaleError ? err.message : `Couldn't start: ${(err as Error).message}`);
  process.exit(1);
}

const app = createApp({ sessionToken, port, hosts, webRoot: hasWeb ? webRoot : undefined });
const scheme = tls ? "https" : "http";
const server = serve(
  {
    fetch: app.fetch,
    hostname: opts.host,
    port,
    ...(tls ? { createServer: createHttpsServer, serverOptions: { cert: tls.cert, key: tls.key } } : {}),
  },
  () => {
    if (!hasWeb) {
      console.log(`Not Today console: API only on port ${port} (run the UI with npm run dev:web)`);
      return;
    }
    // tailscale serve adds HTTPS in front of the plain local server.
    const link = (host: string) => `${mode === "tailscale" ? "https" : scheme}://${host}/#t=${sessionToken}`;
    const withPort = (h: string) => `${isIP(h) === 6 ? `[${h}]` : h}:${port}`;
    if (mode === "local") {
      console.log(`Not Today console: ${link(withPort("127.0.0.1"))}`);
    } else if (mode === "tailscale") {
      console.log(`Not Today console, on your tailnet: ${link(tsName!)}`);
      console.log("Only devices on your tailnet can open it.");
    } else {
      const wildcard = opts.host === "0.0.0.0" || opts.host === "::";
      const addresses = wildcard ? machineAddresses().filter((a) => isIP(a) === 4) : [opts.host];
      console.log("Not Today console. Open it with one of these links (use your server's public address if it isn't listed):");
      for (const h of [...addresses, ...opts.allowHosts]) console.log(`  ${link(withPort(h))}`);
      if (tls && !opts.tls) {
        console.log("The certificate is self-signed, so the browser warns the first time. Check that it shows this SHA-256 fingerprint, then continue:");
        console.log(`  ${fingerprint(tls.cert)}`);
      }
      if (opts.insecureHttp) console.log("WARNING: plain HTTP. Anyone on the network path can read the session token and use the console.");
      console.log("Keep the link private: it is the key to this console.");
    }
    for (const note of notes) console.log(note);
    console.log("Press Ctrl+C to stop.");
    if (opts.open) openBrowser(link(withPort("127.0.0.1")));
    if (mode === "tailscale") {
      const child = startServe(port, (code) => {
        if (stopping) return;
        console.error(code === null ? "Couldn't run tailscale serve." : SERVE_HINT);
        process.exit(1);
      });
      stopServe = () => child.kill("SIGINT");
    }
  },
);

let stopping = false;
let stopServe: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    stopServe?.();
    process.exit(0);
  });
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${port} is in use. Try --port ${port + 1}.`);
  else if (err.code === "EADDRNOTAVAIL") console.error(`${opts.host} isn't an address of this machine. Use 0.0.0.0 for all of them.`);
  else console.error(err.message);
  process.exit(1);
});

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
