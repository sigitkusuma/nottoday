# Product Hunt launch kit: Not Today

Everything to paste into the Product Hunt submission form, plus the maker comment, replies to the questions people will ask, and posts for other channels. The only brackets left are [Product Hunt link]: paste the post's URL once it's scheduled.

## Before you schedule

Status on 2026-11-05: nottoday 0.1.0 is on npm, the repo is public, and v0.1.0 is released. npm's website still showed a "temporary holding version" while it reviewed the new package; check that https://www.npmjs.com/package/nottoday shows the README before you schedule.

These block the launch, in this order. npm never lets you publish the same version twice, so test before you publish. Product Hunt visitors click through to GitHub and run `npx nottoday` within minutes, so all of it has to be done before the post goes live.

- [ ] **Fresh-machine test.** On a computer (or user account) that has never run Not Today: `npx nottoday`. Connect a throwaway Cloudflare account, install, connect a test Slack app, add a route, send a message, see it in Activity. Time it: the connect card says "about five minutes". Anything it turns up goes out as 0.1.1 before launch day.
- [x] **Publish to npm.** `npm login`, turn on 2FA for publishing on your npm account, then publish the file you tested: `npm publish ./nottoday-0.1.0.tgz --access public`. The name `nottoday` was free on 2026-11-05.
- [x] **Make the repo public:** `gh repo edit sigitkusuma/nottoday --visibility public --accept-visibility-change-consequences`. Do it right after publishing: the npm page's screenshot loads from GitHub and stays broken while the repo is private.
- [x] **Private vulnerability reporting** (SECURITY.md links to it): `gh api -X PUT repos/sigitkusuma/nottoday/private-vulnerability-reporting`.
- [x] **GitHub repo page:** homepage and topics are set.
- [ ] **Social preview:** upload `docs/launch/social-preview.png` under Settings → General → Social preview (there's no command for it).
- [x] **Release v0.1.0:** `gh release create v0.1.0 --repo sigitkusuma/nottoday --target main --title "0.1.0" --notes "$(sed -n '/^## 0.1.0/,/^## [0-9]/p' CHANGELOG.md | sed '1d;/^## [0-9]/d')"`. Optionally attach the tarball by adding `./nottoday-0.1.0.tgz` after `v0.1.0`.

## The listing

**Name:** Not Today

**Tagline** (60 characters max). Pick one:

1. `Stop Slack noise from burning your n8n executions` (49)
2. `Saving your n8n executions, one "nope" at a time` (48)
3. `Drop the Slack events your n8n workflows don't need` (51)

Option 1 says what it does to someone scrolling past. Option 2 is the README headline and has the voice, but you have to already know the problem. I'd go with 1 here and keep 2 for the first line of the maker comment.

**Description** (260 characters max, 252 used):

> n8n counts an execution every time a Slack Trigger fires: every message, edit and bot post. Not Today is a small Cloudflare Worker in front of n8n that checks Slack's signature and forwards only what a workflow acts on. Free, open source, npx nottoday.

**Links:**
- Website: https://github.com/sigitkusuma/nottoday
- Additional: https://www.npmjs.com/package/nottoday

**Topics:** Developer Tools, Open Source, Slack. If Product Hunt offers an n8n or No-Code topic when you type, swap Slack for it.

**Pricing:** Free. **Open source:** yes (Apache-2.0).

**Thumbnail:** `docs/launch/thumbnail.png` (240×240).

**Gallery** (1270×760, in this order):

| # | File | What it shows |
|---|---|---|
| 1 | `gallery/01-cover.png` | Name, tagline, and the Slack → gateway → n8n flow |
| 2 | `gallery/02-dashboard.png` | Executions saved, every app's live status |
| 3 | `gallery/03-route-editor.png` | Pick what reaches the workflow, try a message before saving |
| 4 | `gallery/04-connect.png` | Connecting a Slack app, with Slack pre-filled from a manifest |
| 5 | `gallery/05-activity.png` | Each request as it happens, and why it was sent or dropped |
| 6 | `gallery/06-app.png` | Shadow mode, then enforce |

A 30 to 60 second video as the first gallery item helps a lot. See "Optional: launch video" at the end.

## Maker's first comment

Post this the moment the launch goes live. Keep it in your voice. Edit freely, but keep the one rule paragraph: it's the thing a careful n8n user will want to know before trusting a filter in front of their workflows.

> Hi Product Hunt 👋 I'm Sigit Kusuma, and I made Not Today: saving your n8n executions, one "nope" at a time.
>
> I built this after watching a Slack alert bot on n8n Cloud burn through its monthly executions on messages it threw away at the first check. It only cared about a few mentions, but every message in every channel it was in started a run.
>
> The cause: n8n counts an execution every time a trigger fires, and a Slack Trigger fires on every message, edit, reaction and bot post. A filter inside the workflow comes too late: by the time the IF node says no, the run already counts.
>
> Not Today moves that filter in front of n8n. It's a small Cloudflare Worker in your own Cloudflare account. It checks Slack's signature, answers Slack straight away, and forwards only the requests a route matches, byte for byte, so your existing Slack Trigger node keeps working without changes. Everything else is dropped and counted as an execution saved.
>
> You set it up with `npx nottoday`, which opens a console on your own machine. It installs the Worker, walks you through the Slack app, and lets you build routes like "only messages that mention someone on the on-call list" or "only DMs to the bot". You can try a message against a route before saving it.
>
> The one rule: a route's filters must be at least as loose as the workflow's own checks. It may forward something the workflow then ignores; it must never drop something the workflow would act on. That's why every route starts in shadow mode, where it records what it would drop without dropping anything, until you switch it to enforce.
>
> It runs on Cloudflare's free plan, your tokens stay on your machine, and message text is never logged. GitHub, Telegram and generic webhooks already work in the engine and are next in the console.
>
> I'd love to hear which Slack workflows eat the most executions for you, and what you'd want filtered next.

## Replies to likely questions

Short, so you can paste and adjust.

**Why not just add an IF node at the start of the workflow?**
The IF node runs inside the execution. By the time it says no, n8n has already counted the run. The gateway says no before n8n is called.

**I self-host n8n. Does this help me?**
It depends on your plan. n8n's paid plans are priced by monthly executions, including the self-hosted Business plan (40K a month), so there the saving is the same as on n8n Cloud. The free Community Edition has no execution limit, so the saving is load: fewer runs, a smaller execution history, less noise in the logs.

**Can you read my Slack messages?**
No. The Worker runs in your Cloudflare account, the console runs on your machine, and there's no hosted service. Logs and stats record the event type, channel ID and the routing decision, never message text. SECURITY.md lists exactly what the Cloudflare token can do.

**What if a route drops something it shouldn't?**
Routes start in shadow mode: everything still goes to n8n, and the console shows what the route would have dropped. Switch to enforce once those drops look right. To undo everything, put the old n8n URL back in the Slack app's Request URL: the workflow was never changed. Config saves are versioned too.

**Does it work with Socket Mode?**
No. With Socket Mode on, Slack never calls a URL, so there's nothing for the gateway to sit in front of. The connect wizard turns Socket Mode off in the app manifest.

**Slack wants an answer within 3 seconds. Does the extra hop break that?**
The gateway answers Slack with 200 right away and forwards to n8n after. For slash commands, buttons and modals where the workflow answers Slack directly, a route can wait for n8n's reply instead.

**What does it cost?**
Nothing from us. It runs on the Cloudflare Workers free plan, which allows 100,000 requests a day. Stats use Analytics Engine, also free.

**Why Cloudflare?**
It's free at this volume, close to Slack wherever your workspace is, and has no server for you to keep running. The console can be closed: the Worker keeps routing.

**GitHub / Telegram / other webhooks?**
The engine already handles them, with signature checks for each. The console's connect flow for them is built but switched off until it's been tested against real repositories and bots. They're next.

**Can I run the console on a server instead of my laptop?**
Yes: `npx nottoday --host 0.0.0.0` (HTTPS with its own certificate) or `npx nottoday --tailscale`. The README has the details.

## Timing

- Product Hunt days run from 12:01 AM Pacific. Schedule for that, so the post gets the whole day. That's 3:01 PM the same day at UTC+7 (Jakarta).
- Tuesday to Thursday get the most traffic and the most competition. A developer tool with a niche audience often does better on a quieter day. Weekends are quietest.
- Avoid the US Thanksgiving week (Nov 23 to 27, 2026).
- Plan to be at your keyboard for the first 6 to 8 hours to answer comments. Early replies matter more than early upvotes.

## Other channels on launch day

Product Hunt asks makers not to ask for upvotes. Ask for feedback and link to the post.

**n8n community forum** (Built with n8n category, or wherever they allow project posts; check the rules first):

> **Not Today: a Slack gateway that stops Slack noise from using up n8n executions**
>
> Every message, edit and bot post in a channel your Slack bot is in starts a Slack Trigger execution, even if the workflow drops it at the first IF node. I built a small open-source Cloudflare Worker that sits in front of n8n, checks Slack's signature, and forwards only the requests a workflow acts on. Requests are forwarded byte for byte, so existing Slack Trigger nodes keep working unchanged.
>
> Setup is `npx nottoday`, which opens a local console. Routes start in shadow mode so you can see what would be dropped before anything is.
>
> GitHub: https://github.com/sigitkusuma/nottoday. It's on Product Hunt today too: [Product Hunt link]. I'd like to hear which Slack workflows burn the most executions for you.

**X / Bluesky / Threads:**

> n8n counts an execution every time a Slack Trigger fires. Every message, edit and bot post. Even the ones your workflow ignores.
>
> I made Not Today: a free Cloudflare Worker that says "not today" to the Slack requests no workflow needs. Open source, `npx nottoday`.
>
> On Product Hunt today: [Product Hunt link]

**LinkedIn:**

> Today I'm launching Not Today on Product Hunt: an open-source tool for anyone running Slack workflows on n8n.
>
> I built this after watching a Slack alert bot on n8n Cloud burn through its monthly executions on messages it threw away at the first check. It only cared about a few mentions, but every message in every channel it was in started a run.
>
> Not Today puts a small Cloudflare Worker in front of n8n that forwards only the Slack requests a workflow needs, so the rest never becomes an execution. It's free, runs in your own Cloudflare account, and sets up with one command.
>
> [Product Hunt link]

**Reddit** (r/n8n): use the forum post above. Lead with the problem, not the launch.

## After the launch

- Add the Product Hunt badge to the top of the README if the post does well.
- Reply to every comment, including on the forum and Reddit threads, for the first two days.
- Collect what people ask for. GitHub, Telegram and webhooks are already built; if people ask for them, that's the signal to switch them on.

## Optional: launch video

A 30 to 60 second screen recording works well as the first gallery item: a Slack channel filling with messages, the execution count in n8n climbing, then the same channel through Not Today with the console's squares turning green (dropped). Upload to YouTube or Loom and paste the link into the gallery's video field.
