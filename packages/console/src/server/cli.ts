#!/usr/bin/env node
/** `npx nottoday`: starts the console on this machine and opens it in the browser. */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { stateDir } from "./store";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: nottoday [--port <n>] [--no-open]

Starts the gateway console on http://127.0.0.1 and opens it in your browser.
Tokens are stored in ${stateDir()} (readable only by you).`);
  process.exit(0);
}

const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 4870;
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("--port must be a number between 1024 and 65535");
  process.exit(1);
}

// In dev the session token is fixed so the Vite UI (port 5173) can use it.
const dev = process.env.NOTTODAY_DEV === "1";
const sessionToken = dev ? "dev" : randomBytes(24).toString("base64url");
const webRoot = new URL("./web/", import.meta.url);
const hasWeb = existsSync(fileURLToPath(webRoot));

const app = createApp({ sessionToken, port, webRoot: hasWeb ? webRoot : undefined });

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  const url = `http://127.0.0.1:${port}/#t=${sessionToken}`;
  console.log(`Not Today console: ${hasWeb ? url : `API only on port ${port} (run the UI with npm run dev:web)`}`);
  console.log("Press Ctrl+C to stop.");
  if (hasWeb && !args.includes("--no-open")) openBrowser(url);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(err.code === "EADDRINUSE" ? `Port ${port} is in use. Try --port ${port + 1}.` : err.message);
  process.exit(1);
});

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
