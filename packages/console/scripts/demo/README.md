# Demo data for screenshots

`server.mjs` stands in for the console's API (`src/server/api.ts`) with made-up
data for a fictional company, Acme: three Slack apps (`oncall-alerts`,
`support-bot`, `standup-bot`), an `@on-call` list synced from an n8n data
table, n8n connected with a handful of workflows, a week of stats, an activity
feed and a few config versions. Nothing talks to Cloudflare, n8n or Slack, and
there are no real tokens. Saves are kept in memory until the server stops.

It is plain Node with no dependencies, and it isn't part of the npm package
(`files` in `package.json` only ships `dist`, `README.md` and `LICENSE`).

## Run it

From `packages/console`, in two terminals:

```sh
DEMO_ACCOUNTS=1 node scripts/demo/server.mjs   # API on 127.0.0.1:4870
npm run dev:web                               # UI on http://localhost:5173, proxies /api to 4870
```

Open http://localhost:5173/. Stop a real `nottoday` console first: it uses
port 4870 too. To use another port, start the server with `PORT=4871` and point
the Vite proxy in `vite.config.ts` at it for the session.

`DEMO_ACCOUNTS=1` shows one Cloudflare account. Without it a second one,
"Acme Labs" (a GitHub app and a Slack app), is added, so the account switcher,
the accounts strip on the Dashboard and "All accounts" on Apps have something to
show.

## Capture the screenshots

`capture.mjs` drives headless Chrome with puppeteer-core, which is not a
dependency of this repo. Install it somewhere outside the repo once:

```sh
mkdir -p /tmp/nottoday-shots && npm install --prefix /tmp/nottoday-shots puppeteer-core
export PUPPETEER_DIR=/tmp/nottoday-shots   # CHROME_PATH overrides the Chrome location (macOS default)
```

With the server (`DEMO_ACCOUNTS=1`) and Vite running:

```sh
node scripts/demo/capture.mjs readme    # docs/screenshots/*.png, 2040x1290 (1360x860 at 1.5x)
node scripts/demo/capture.mjs launch    # docs/launch/raw/*.png, 2540x1520 (1270x760 at 2x)
```

Then restart the server without `DEMO_ACCOUNTS=1` for the account switcher:

```sh
node scripts/demo/capture.mjs accounts  # docs/launch/raw/accounts.png
```

A different UI address goes last, e.g. `node scripts/demo/capture.mjs launch http://localhost:5174`.
The README shots use a 1360px-wide window because the route editor shows its
"Try a message" preview beside the form only from 1100px up.

The data is the same on every run; only the times shown follow the clock. Look
at every PNG before committing it.
