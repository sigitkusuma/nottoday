/**
 * Watches the gateway in real time while someone connects an app, and says
 * which step is confirmed and what to check when nothing arrives. For Slack
 * these are the mistakes from real setups: Socket Mode on, URL not verified,
 * bot not in the channel, wrong signing secret, wrong app name in the URL.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { SourceType } from "@gw/shared";
import { sourceInfo } from "../sources";
import { useLive, type LiveEvent } from "../useLive";
import { timeAgo } from "./ui";

const HINT_AFTER_MS = 45_000;

export function LiveCheck({ appKey, botHandle, compact, source = "slack" }: { appKey: string; botHandle?: string; compact?: boolean; source?: SourceType }) {
  const live = useLive();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const mine = live.events.filter((e) => e.app === appKey);
  const verified = mine.some((e) => e.kind === "verified");
  const firstEvent = mine.find((e) => e.kind === "event");
  const badSignature = mine.find((e) => e.kind === "bad_signature");
  const missingSecret = mine.some((e) => e.kind === "missing_secret");
  const unknown = live.events.find((e) => e.kind === "unknown_app");
  const waitedLong = now - startedAt > HINT_AFTER_MS;

  if (source !== "slack" && live.state !== "unavailable") {
    return <SourceLiveCheck appKey={appKey} source={source} botHandle={botHandle} compact={compact} mine={mine} waitedLong={waitedLong} liveState={live.state} unknown={unknown} />;
  }

  if (live.state === "unavailable") {
    return (
      <div className="notice warn small" role="status">
        Real-time check isn't available: {live.message} Status on this page updates from stats instead, 1–2 minutes after Slack sends something.
      </div>
    );
  }

  return (
    <div className="live-check" aria-live="polite">
      <div className="spread">
        <strong>{verified && firstEvent && !badSignature ? "Live check: Slack is connected" : compact ? "Live check" : "Live check: waiting for Slack"}</strong>
        <span className={live.state === "live" ? "status-ok small" : "muted small"}>{live.state === "live" ? "Connected, watching the gateway" : "Connecting…"}</span>
      </div>
      <ul className="checklist compact">
        <Check ok={verified} label="Slack verified the Request URL" pending="Click Verify (or Retry) next to the Request URL in Slack." />
        <Check
          ok={Boolean(firstEvent)}
          label={firstEvent ? `First event arrived (${firstEvent.type ?? "event"}, ${timeAgo(firstEvent.time)})` : "First event arrives"}
          pending={botHandle ? `Post a message in a channel the bot is in (invite it with /invite @${botHandle}).` : "Post a message in a channel the bot is in."}
        />
        <Check ok={!badSignature && (verified || Boolean(firstEvent))} failed={Boolean(badSignature)} label={badSignature ? "Signature check failed" : "Signatures check out"} pending="Confirmed with the first request." />
      </ul>

      {badSignature && (
        <div className="notice error small" role="alert">
          Slack's requests don't match the signing secret stored for <code>{appKey}</code>. Copy the Signing Secret again (Basic Information → App
          Credentials → Show; not the Client Secret) and use "Replace signing secret".
        </div>
      )}
      {missingSecret && (
        <div className="notice error small" role="alert">
          The gateway has no signing secret for <code>{appKey}</code>. Add it with "Replace signing secret".
        </div>
      )}
      {unknown && unknown.app !== appKey && (
        <div className="notice warn small" role="alert">
          Slack is calling <code>/slack/{unknown.app}</code>, which the gateway doesn't know. Check the Request URL ends in <code>/slack/{appKey}</code>.
        </div>
      )}
      {waitedLong && !firstEvent && !badSignature && (
        <div className="notice warn small">
          <strong>{verified ? "Verified, but no events yet." : "Nothing from Slack yet."}</strong> Check, in this order:
          <ol className="steps" style={{ marginTop: 6 }}>
            {!verified && <li>In Slack, the Request URL shows Verified (click Verify or Retry next to it).</li>}
            <li>
              <strong>Socket Mode is off</strong> (Settings → Socket Mode). With it on, Slack never calls the URL, even when it says Verified.
            </li>
            <li>Event Subscriptions are on, the bot events are listed, and you clicked Save Changes.</li>
            <li>The app is installed (or reinstalled after changes) to the workspace.</li>
            <li>The bot is in the channel you're posting in{botHandle ? <> (<code>/invite @{botHandle}</code>)</> : null}.</li>
          </ol>
        </div>
      )}

      {mine.length > 0 && !compact && <RecentForApp events={mine} />}
    </div>
  );
}

function Check({ ok, failed, label, pending }: { ok: boolean; failed?: boolean; label: string; pending: string }) {
  return (
    <li className={`check-item ${failed ? "failed" : ok ? "done" : "todo"}`}>
      <span className="check-mark" aria-hidden="true">
        {failed ? "!" : ok ? "✓" : "…"}
      </span>
      <div className="check-body">
        <div className="check-title">
          {label}
          <span className="visually-hidden">{failed ? " (failed)" : ok ? " (done)" : " (waiting)"}</span>
        </div>
        {!ok && !failed && <div className="muted small">{pending}</div>}
      </div>
    </li>
  );
}

function RecentForApp({ events }: { events: LiveEvent[] }) {
  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div className="muted">Latest from Slack for this app:</div>
      <ul className="plain-list">
        {events.slice(0, 5).map((e, i) => (
          <li key={`${e.time}-${i}`}>
            <span className="muted">{new Date(e.time).toLocaleTimeString()}</span> {describe(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function describe(e: LiveEvent): string {
  switch (e.kind) {
    case "verified":
      return e.source === "github" ? "GitHub sent its ping: verified." : "Slack checked the Request URL: verified.";
    case "bad_signature":
      return e.source && e.source !== "slack" ? "Rejected: bad signature (wrong secret?)." : "Rejected: bad signature (wrong signing secret?).";
    case "unknown_app":
      return `Rejected: unknown app name "${e.app}".`;
    case "missing_secret":
      return "Rejected: no signing secret stored for this app.";
    case "error":
      return `Gateway error: ${e.message}`;
    case "event": {
      const what = [e.type, e.subtype].filter(Boolean).join(" / ") || "event";
      const routes = e.routes ?? [];
      if (routes.length === 0) return `${what}: no route for it yet.`;
      return `${what}: ${routes
        .map((r) =>
          r.forwarded
            ? r.filter === "fail"
              ? `${r.route} forwarded (shadow, would drop: ${r.reason})`
              : `${r.route} forwarded${r.status ? ` (n8n ${r.status})` : ""}`
            : `${r.route} dropped (${r.reason})`,
        )
        .join("; ")}.`;
    }
  }
}

const STEPS: Record<Exclude<SourceType, "slack">, { ping?: [string, string]; first: [string, (bot?: string) => string]; hints: ReactNode[] }> = {
  github: {
    ping: ["GitHub sent its ping", "GitHub sends a ping when the webhook is added. Webhooks → your webhook → Recent Deliveries can redeliver it."],
    first: ["First event arrived", () => "Do whatever the webhook sends: push a commit, open an issue or a pull request."],
    hints: [
      <>
        The <b>Payload URL</b> ends in the address above, and the webhook is <b>Active</b>.
      </>,
      <>
        The <b>Secret</b> was pasted exactly. A wrong one shows as a red "bad signature" here.
      </>,
      <>
        In <b>Recent Deliveries</b>, GitHub shows each delivery and the gateway's response.
      </>,
    ],
  },
  telegram: {
    first: ["First update arrived", (bot) => (bot ? `Send /start, or any message, to @${bot} in Telegram.` : "Send /start, or any message, to the bot in Telegram.")],
    hints: [
      "You messaged the bot you connected, not another one.",
      <>
        Nothing pointed the bot elsewhere since: an <b>active n8n workflow with a Telegram Trigger</b> for this bot takes the webhook back when it starts. Use a Webhook node instead, then reconnect the bot on its app page.
      </>,
      "In a group, the bot only sees messages if it was added and privacy mode allows it (BotFather → /setprivacy).",
    ],
  },
  webhook: {
    first: ["First request arrived", () => "Trigger something in the service, or use its \"send a test\" button."],
    hints: [
      "The service sends to the exact URL above, as a POST.",
      "The secret matches what the service uses. A wrong one shows as a red \"bad signature\" here.",
      "Most services keep a delivery log in their webhook settings, with the response they got.",
    ],
  },
};

function SourceLiveCheck({
  appKey,
  source,
  botHandle,
  compact,
  mine,
  waitedLong,
  liveState,
  unknown,
}: {
  appKey: string;
  source: Exclude<SourceType, "slack">;
  botHandle?: string;
  compact?: boolean;
  mine: LiveEvent[];
  waitedLong: boolean;
  liveState: string;
  unknown?: LiveEvent;
}) {
  const info = sourceInfo(source);
  const steps = STEPS[source];
  const verified = mine.some((e) => e.kind === "verified");
  const firstEvent = mine.find((e) => e.kind === "event");
  const badSignature = mine.find((e) => e.kind === "bad_signature");
  const done = Boolean(firstEvent) && !badSignature;
  return (
    <div className="live-check" aria-live="polite">
      <div className="spread">
        <strong>{done ? `Live check: ${info.label} is connected` : compact ? "Live check" : `Live check: waiting for ${info.sender}`}</strong>
        <span className={liveState === "live" ? "status-ok small" : "muted small"}>{liveState === "live" ? "Connected, watching the gateway" : "Connecting…"}</span>
      </div>
      <ul className="checklist compact">
        {steps.ping && <Check ok={verified || Boolean(firstEvent)} label={steps.ping[0]} pending={steps.ping[1]} />}
        <Check
          ok={Boolean(firstEvent)}
          label={firstEvent ? `${steps.first[0]} (${firstEvent.type || info.noun}, ${timeAgo(firstEvent.time)})` : steps.first[0]}
          pending={steps.first[1](botHandle)}
        />
        <Check ok={!badSignature && (verified || Boolean(firstEvent))} failed={Boolean(badSignature)} label={badSignature ? "Signature check failed" : "Signatures check out"} pending="Confirmed with the first request." />
      </ul>
      {badSignature && (
        <div className="notice error small" role="alert">
          {info.sender === "the service" ? "The service's" : `${info.sender}'s`} requests don't match the secret stored for <code>{appKey}</code>. {source === "telegram" ? "Reconnect the bot on its app page." : "Check the secret, or replace it on the app page."}
        </div>
      )}
      {unknown && unknown.app !== appKey && (
        <div className="notice warn small" role="alert">
          A request came in for <code>{unknown.app}</code>, which the gateway doesn't know. Check the URL ends in <code>/{appKey}</code>.
        </div>
      )}
      {waitedLong && !firstEvent && !badSignature && (
        <div className="notice warn small">
          <strong>Nothing from {info.sender} yet.</strong> Check, in this order:
          <ol className="steps" style={{ marginTop: 6 }}>
            {steps.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </div>
      )}
      {mine.length > 0 && !compact && <RecentForApp events={mine} />}
    </div>
  );
}
