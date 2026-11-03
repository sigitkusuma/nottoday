/**
 * The console's web server: the API plus the built UI. It answers only to the
 * host names it was started for, and every API call needs the session token
 * from the link the CLI printed, so other websites, other users on the
 * machine, and (in the server modes) other people on the network can't use it.
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Hono } from "hono";
import { hostAllowed, localHosts, tokenMatches, type HostPolicy } from "./access";
import { createApi, type ApiDeps } from "./api";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface AppOptions extends ApiDeps {
  sessionToken: string;
  port: number;
  /** Host names to answer to; defaults to 127.0.0.1 and localhost with the port. */
  hosts?: HostPolicy;
  /** Directory URL of the built UI; omitted in dev, where Vite serves it. */
  webRoot?: URL;
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const hosts = opts.hosts ?? localHosts(opts.port);

  // Blocks DNS-rebinding: a hostile page can't reach us under its own host name.
  app.use("*", async (c, next) => {
    if (!hostAllowed(c.req.header("host"), hosts)) return c.json({ error: "Forbidden host. To use this address, start the console with --allow-host <name>." }, 403);
    c.header("x-frame-options", "DENY");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    await next();
  });

  app.use("/api/*", async (c, next) => {
    if (!tokenMatches(c.req.header("x-session-token"), opts.sessionToken)) return c.json({ error: "Open the console from the link the CLI printed." }, 401);
    c.header("cache-control", "no-store");
    await next();
  });

  app.route("/api", createApi(opts));

  if (opts.webRoot) {
    const root = opts.webRoot;
    app.get("*", async (c) => {
      const path = new URL(c.req.path, "http://x").pathname;
      if (path.includes("..")) return c.notFound();
      const file = path === "/" ? "index.html" : path.slice(1);
      try {
        const body = await readFile(new URL(file, root));
        return c.body(body, 200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      } catch {
        const index = await readFile(new URL("index.html", root));
        return c.body(index, 200, { "content-type": TYPES[".html"] });
      }
    });
  }
  return app;
}
