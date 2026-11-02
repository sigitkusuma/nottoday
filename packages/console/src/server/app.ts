/**
 * The local web server: the API plus the built UI. It listens on 127.0.0.1
 * only, and every API call needs the random session token from the URL the
 * CLI opens, so other websites and other users on the machine can't use it.
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Hono } from "hono";
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
  /** Directory URL of the built UI; omitted in dev, where Vite serves it. */
  webRoot?: URL;
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);

  // Blocks DNS-rebinding: a hostile page can't reach us under its own host name.
  app.use("*", async (c, next) => {
    if (!allowedHosts.has(c.req.header("host") ?? "")) return c.json({ error: "Forbidden host" }, 403);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.header("x-session-token") !== opts.sessionToken) return c.json({ error: "Open the console from the link the CLI printed." }, 401);
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
