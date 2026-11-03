# Security

## What the console can do with your Cloudflare token

The token you create from the console's link has these permissions:

| Permission | Used for |
|---|---|
| Workers Scripts: Edit | Upload the gateway Worker, turn on its workers.dev address, set each app's secret |
| Workers KV Storage: Edit | Create the gateway's KV namespace; read and write its config |
| Account Analytics: Read | Read the forwarded/dropped counts for the dashboard |
| Account Settings: Read | List the accounts the token can reach |

Under **Account Resources**, limit the token to the one account you install into.

## The local console

- It listens on `127.0.0.1` only, never on your network.
- Every API call needs a random session token, generated at start and passed in the URL fragment of the link the CLI opens. Fragments aren't sent to servers or written to logs.
- Requests with any `Host` header other than `127.0.0.1:<port>` or `localhost:<port>` are refused, which blocks DNS-rebinding attacks from web pages.
- Tokens are stored in `~/.config/nottoday/state.json`, mode `0600`, in a `0700` directory. If `~/.config/slack-gateway` exists from before the rename and the new folder doesn't, that one is used instead. Set `NOTTODAY_HOME` to use another directory (`SLACK_GATEWAY_HOME` still works). If you save several Cloudflare accounts, all their tokens are in that one file. "Forget" removes a token from it; it doesn't revoke the token, which you do in Cloudflare (My Profile → API Tokens).

## Real-time logs (live check and Activity)

While the console is open, it opens a Cloudflare tail session for the gateway Worker, the same mechanism `wrangler tail` uses. It needs no extra permission: Workers Scripts Edit covers it. The session's WebSocket URL works without further authentication, so it stays inside the console process and is never sent to the browser. The session is closed when nobody is watching.

## The gateway Worker

- Every Slack request must carry a valid Slack signature less than 5 minutes old. Otherwise it gets 401.
- GitHub deliveries must carry a valid `X-Hub-Signature-256`, Telegram updates the bot's secret token, and webhooks whatever their app is set to check (an HMAC signature, a secret header, or a secret in the URL). There is no unchecked option. Tokens are compared without stopping at the first difference.
- GitHub, HMAC-signed and token webhooks have no timestamp, so a captured request could be sent again. The same is true when they go straight to n8n; Slack's 5-minute window is the exception.
- An app is reachable only under its own kind's address: a Slack app never answers on `/github/…`, and the other way round.
- Each app's secret is a Worker secret. Secrets are not in the config, the KV namespace, exports or logs. Secrets the console generates are shown once and not kept on your machine.
- A secret in the URL (for services that can't sign or set headers) ends up wherever that service logs URLs. Prefer a signature or header when the service offers one.
- Connecting a Telegram bot uses its bot token for two calls to Telegram (`getMe`, `setWebhook`). The token is not stored, logged, or shown in error messages.
- Logs and stats record the event type, subtype, channel ID and routing decision. They never record message text.
- A broken or unreadable config never replaces the last good one, so a bad save can't take the gateway down.
- Optional: set a `GATEWAY_FORWARD_SECRET` Worker secret, and the gateway sends it to n8n as `x-nottoday-secret` (Slack requests also carry it as `x-slack-gateway-secret`, for existing workflows). A Webhook node can then check it with Header Auth.
- Requests from GitHub, Telegram and webhooks reach n8n with their original headers, minus the ones about the hop to the gateway (`host`, `cf-*`, `x-forwarded-*` and similar).

## Reporting a vulnerability

Please report security problems privately to the maintainers rather than in a public issue.
