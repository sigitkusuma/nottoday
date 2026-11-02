# Not Today

**Saving your n8n executions, one "nope" at a time.**

A Slack gateway for n8n: it says "not today" to every Slack request no workflow needs, so it never becomes an n8n execution.

n8n counts an execution every time a trigger fires. A Slack Trigger fires on every message, edit, reaction and bot post in every channel your Slack bot is in, even when the workflow only cares about a few of them and stops at its first check. A busy workspace can use most of a monthly execution quota this way.

This tool puts a small Cloudflare Worker between Slack and n8n. It checks Slack's signature, answers Slack at once, and forwards only the requests a workflow acts on. Everything it drops is an execution you don't pay for. It works for any Slack-triggered workflow: alerts, assistants, triage, slash commands, buttons.

```
Slack app ──► https://<your-worker>.workers.dev/slack/<app>
                 ├─ checks the signature, replies 200 to Slack right away
                 ├─ forwards matching requests to n8n, unchanged
                 └─ drops the rest (counted, never sent)
```

- **No n8n changes.** Requests are forwarded byte for byte with Slack's signature headers, so an existing Slack Trigger node keeps working as-is.
- **Free.** It runs on the Cloudflare Workers free plan (100,000 requests a day) in your own account.
- **Local console.** `npx nottoday` opens a web UI on your machine. Your tokens stay on your machine.

![Dashboard: executions saved, and every bot with its live status](docs/screenshots/dashboard.png)

<table>
  <tr>
    <td><img src="docs/screenshots/route-editor.png" alt="Route editor: pick what reaches the workflow, then try a message against it"></td>
    <td><img src="docs/screenshots/connect-wizard.png" alt="Connect a Slack app: four steps, with Slack opened pre-filled from a manifest"></td>
  </tr>
  <tr>
    <td align="center"><sub>Routes: try a message before saving</sub></td>
    <td align="center"><sub>Connecting a Slack app</sub></td>
  </tr>
</table>

## Quick start

You need a Cloudflare account (free), a Slack workspace where you can create or manage apps, and Node.js 22.4 or later.

```bash
npx nottoday
```

The console opens in your browser with a setup checklist that shows what's done and what's next:

1. **Connect Cloudflare.** A link opens Cloudflare's token page with the right permissions filled in. Paste the token back. You can save several Cloudflare accounts, each with its own gateway, and switch between them from the account link in the header.
2. **Install.** One click creates the Worker, its settings store and its `workers.dev` address.
3. **Turn on stats** (optional, free). Cloudflare needs one Analytics Engine dataset; the console shows the exact name to use. Routing works without it.
4. **Connect n8n** (optional). Counts executions per workflow, so you can see which ones to fix, and lets you pick trigger URLs from a list.
5. **Connect a Slack app.** A four-step wizard. For a new app, one button opens Slack with everything filled in from a manifest: the gateway's Request URL, the events, the permissions, and Socket Mode off (with Socket Mode on, Slack never calls the URL). You paste the Signing Secret, click Verify in Slack, and a **live check** confirms each step within seconds: URL verified, first event arrived, signatures OK. For an existing app, the wizard gives you a checklist instead; save its old Request URL first, since putting it back is your rollback.
6. **Add a route.** Pick what should reach the workflow (mentions of people on a list, DMs to the bot, a channel, a keyword, a slash command…), pick the workflow, and check the route in plain words. Filters that take a list of people or channels let you choose a saved list or create one right there, typed or copied from an n8n data table, without leaving the route. **Try a message** shows whether a sample message would be forwarded or dropped, using the gateway's own logic. Routes start in **shadow** mode, which forwards everything and records what it *would* drop.
7. **Check, then enforce.** Post a few test messages and watch the squares on the bot card (or the **Activity** page), which show each decision as it happens. When the drops are right, open the bot and click **Switch to enforce**.

## Common uses

| Your workflow | Route to set up | What the gateway drops |
|---|---|---|
| Alerts when certain people are mentioned (on call, managers, account owners) | Messages that mention someone on a list | Every message that doesn't mention them, edits, bot posts |
| An assistant that answers DMs | Direct messages to the bot | All channel traffic, the bot's own replies |
| A bot that replies when @mentioned | Mentions of the bot | Everything else the Slack Trigger was subscribed to |
| Triage of a support or requests channel | New messages in specific channels | Other channels, edits, joins |
| Tickets from keywords ("bug", "outage") | Messages containing a keyword | Messages without the keyword |
| Slash commands, approval buttons, modal forms | A slash command / button clicks | Nothing extra; you still get one place to see and route them |

The route editor offers each of these as a starting point. One Slack app can feed several workflows: a message that matches two routes goes to both.

## The one rule

**A route's filters must be at least as loose as the workflow's own checks.** The gateway may forward something the workflow then ignores. It must never drop something the workflow would act on.

That's why routes start in shadow mode. It's also why lists, such as who's on call, can be copied from an n8n data table instead of typed in. A list that falls behind the table drops real messages. Refresh it from the **Lists** tab whenever the table changes.

## What a route can filter

| Filter | Example use |
|---|---|
| Must mention someone in a list | Only when someone on call is mentioned |
| Must mention someone / ignore self-mentions | Mentions of anyone, not counting people mentioning themselves |
| Message kinds | New messages and thread broadcasts, not edits, deletes or joins |
| Ignore bot posts | Skip messages from bots and integrations |
| Channel types, channels, senders | Only DMs; never #random; only from certain users |
| Text pattern | A regular expression the message must match |

Routes can also match button clicks, modals and slash commands. For those, choose "wait for n8n's reply" when the workflow answers Slack directly.

## Rollback

Put the old n8n URL back in the Slack app's Event Subscriptions. The workflow was never changed, so it works as before straight away. Config changes can also be undone from **Versions**: every save keeps the version it replaced.

## Behaviour details

- **Signatures:** every request is checked with the app's signing secret and must be under 5 minutes old; otherwise the gateway answers 401.
- **Slack retries:** Slack re-sends an event it didn't get a 2xx for. The gateway can't tell "we already handled it but the reply was lost" from "it never reached us", and dropping the second kind would lose the event silently. So every retry is processed like a first delivery, and its retry number and reason are logged. In rare cases that means a duplicate; a workflow that must not run twice should check the event ID.
- **n8n unavailable:** on 502, 503, 504 or a network error the gateway tries twice more (after 0.5 s, then 1.5 s). Other errors aren't retried, so a retry is unlikely to run a workflow twice.
- **Logs and stats:** event type, subtype, channel ID and the routing decision. Never message text.

## Where things are stored

| What | Where |
|---|---|
| Cloudflare API tokens (one per saved account), n8n API key | Your machine: `~/.config/nottoday/state.json` (an existing `~/.config/slack-gateway` from before the rename is still used), readable only by your user |
| Slack signing secrets | Cloudflare, as Worker secrets. Not on your machine, and never in the config |
| Routes, lists, config history | Cloudflare KV, in your account |
| Counts of forwarded and dropped requests | Cloudflare Analytics Engine, in your account (kept 3 months). Message text is never recorded. Cloudflare samples bursts of requests, so counts are estimates, exact only at steady light volume |

The console listens on `127.0.0.1` only. Every API call needs the random session token from the link the CLI opens. See [SECURITY.md](SECURITY.md).

## Development

```
packages/shared    config types, validation, stats layout (used by both)
packages/engine    the Worker
packages/console   CLI, local API server, web UI
```

```bash
npm install
npm run check                    # type-check and tests for all packages
npm run build -w nottoday        # engine bundle + UI + CLI into packages/console/dist
node packages/console/dist/cli.js
```

Engine, locally in workerd, without Cloudflare:

```bash
cd packages/engine
cp .dev.vars.example .dev.vars   # FORWARD_DRY_RUN=true: nothing is sent to n8n
npm run dev:seed                 # writes examples/dev.config.json to local KV
npm run dev
```

Console UI with hot reload: run `npm run dev -w nottoday` (API on port 4870) and `npm run dev:web -w nottoday` (UI on port 5173) in two terminals.

## License

Apache License 2.0. See [LICENSE](LICENSE).
