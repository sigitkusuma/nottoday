# Changelog

## 0.1.0 (2026-11-05)

The first release.

### Gateway

- A Cloudflare Worker between Slack and n8n. It checks each request's Slack signature (and that it's under 5 minutes old), answers Slack at once, and forwards matching requests to n8n byte for byte, so an existing Slack Trigger node keeps working unchanged.
- Routes pick which requests reach a workflow: event types, mentions of people on a list, channels and channel types, senders, bot posts, message kinds and a text pattern. Slash commands, button clicks and modals too, with the option to wait for n8n's reply.
- Shadow mode: a new route forwards everything and records what it would drop, until you switch it to enforce.
- Retries to n8n on 502, 503, 504 and network errors. Logs and stats record the event type, channel ID and routing decision, never message text.
- Engine 0.3.0. It also handles GitHub, Telegram and generic webhooks; the console's connect flow for them is switched off until they've been tested against real repositories and bots.

### Console (`npx nottoday`)

- Runs on your machine at 127.0.0.1, with a session token in the link. Your Cloudflare and n8n tokens stay in `~/.config/nottoday`.
- Setup checklist: connect Cloudflare with a pre-filled token link, install the Worker in one click, optional stats, optional n8n connection.
- Connect a Slack app in four steps, with Slack opened pre-filled from a manifest and a live check for each step.
- Route editor with templates for common uses, lists you can copy from an n8n data table, and "Try a message" against the gateway's own logic.
- Dashboard with executions saved per app, an Activity feed with the reason for every decision, and a hint when Slack sends events no route uses.
- Several Cloudflare accounts, each with its own gateway; reconnect to a gateway that's already in an account.
- Config history: every save keeps the version it replaced.
- Server mode: `--host` (HTTPS with a self-signed certificate, or your own) or `--tailscale`.
