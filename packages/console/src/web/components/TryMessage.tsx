/**
 * "Try a message": runs the engine's own routing decision in the browser, so
 * the preview can't disagree with what the gateway will do. The answer is shown
 * as a verdict as soon as there is something to test.
 */

import { useId, useState } from "react";
import { decide, parseGithubRequest, parseTelegramRequest, parseWebhookRequest } from "@gw/engine/router";
import { sourceOf, type AppConfig, type Route } from "@gw/shared";
import { reasonText } from "../routeSummary";
import { sourceInfo } from "../sources";
import { Icon } from "./icons";

const KINDS: [string, string][] = [
  ["", "New message"],
  ["thread_broadcast", "Thread reply also sent to channel"],
  ["file_share", "Message with a file"],
  ["message_changed", "Edit"],
  ["channel_join", "Someone joins the channel"],
];
const WHERE: [string, string][] = [
  ["channel", "Public channel"],
  ["group", "Private channel"],
  ["im", "Direct message to the bot"],
  ["mpim", "Group DM"],
];

interface Verdict {
  forward: boolean;
  title: string;
  detail: string;
}

export function TryMessage({ route, lists }: { route: Route; lists: Record<string, string[]> }) {
  const id = useId();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const [where, setWhere] = useState("channel");
  const [channel, setChannel] = useState("");
  const [sender, setSender] = useState("");
  const [fromBot, setFromBot] = useState(false);

  const events = route.on.type === "event" ? route.on.events : [];
  const type = events.includes("message") || events.includes("*") || events.length === 0 ? "message" : events[0];
  const result = run();

  function run(): Verdict | null {
    if (!text.trim() && kind === "") return null;
    // People type "@U123"; Slack sends "<@U123>".
    const slackText = text.replace(/(^|\s)@([UW][A-Z0-9]{2,})\b/g, "$1<@$2>");
    try {
      const [d] = decide(
        { signingSecret: "X", routes: [{ ...route, mode: "enforce", enabled: true }] },
        {
          kind: "event",
          event: {
            type,
            subtype: kind || undefined,
            user: sender.trim() || "UTESTSENDER",
            bot_id: fromBot ? "BTEST" : undefined,
            text: slackText,
            channel: channel.trim() || "CTESTCHANNEL",
            channel_type: where,
          },
        },
        lists,
      );
      if (!d) return { forward: false, title: "Not matched", detail: `This route only handles ${events.join(", ") || "no"} events.` };
      if (d.forward) return { forward: true, title: "Forwarded to n8n", detail: "This would use one execution." };
      const why = reasonText(d.reason);
      return { forward: false, title: "Dropped", detail: `Because ${why}. No execution used.` };
    } catch (err) {
      return { forward: false, title: "Can't test yet", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  return (
    <div className="try">
      <label className="field" style={{ marginBottom: 10 }}>
        <span className="label">Try a message</span>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. deploying v2 now, cc @U123ABC" aria-describedby={`${id}-result`} />
        <span className="hint">Type one the workflow should act on, then one it should ignore. Write a mention as @U123ABC.</span>
      </label>
      <VerdictBox id={`${id}-result`} result={result} empty="The gateway's verdict appears here as you type." />
      <details className="more">
        <summary>More options</summary>
        <div className="try-grid">
          <label className="field">
            <span className="label">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([v, l]) => (
                <option key={v || "new"} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Where</span>
            <select value={where} onChange={(e) => setWhere(e.target.value)}>
              {WHERE.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Channel ID</span>
            <input type="text" className="mono" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="C0123ABCD" />
          </label>
          <label className="field">
            <span className="label">Sender ID</span>
            <input type="text" className="mono" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="U0123ABCD" />
          </label>
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={fromBot} onChange={(e) => setFromBot(e.target.checked)} /> Posted by a bot
        </label>
      </details>
    </div>
  );
}

function VerdictBox({ id, result, empty }: { id: string; result: Verdict | null; empty: string }) {
  return (
    <div id={id} role="status" className={`verdict ${result ? (result.forward ? "ok" : "drop") : ""}`}>
      <span className="verdict-icon" aria-hidden="true">
        {result && <Icon name={result.forward ? "check" : "x"} size={13} />}
      </span>
      <span>
        {result ? (
          <>
            <b>{result.title}</b>
            <span className="muted small"> {result.detail}</span>
          </>
        ) : (
          <span className="muted small">{empty}</span>
        )}
      </span>
    </div>
  );
}

const EXAMPLES: Record<string, { event?: string; json: object }> = {
  github: { event: "push", json: { ref: "refs/heads/main", repository: { full_name: "acme/api" }, sender: { login: "ana", type: "User" }, head_commit: { message: "Fix login" } } },
  telegram: { json: { update_id: 1, message: { message_id: 7, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false, username: "ana" }, text: "/start" } } },
};

/**
 * "Try a payload": for GitHub, Telegram and webhooks. Parses a pasted request
 * body with the engine's own parser and runs its routing decision, so the
 * preview can't disagree with the gateway.
 */
export function TryPayload({ route, app, lists }: { route: Route; app: AppConfig; lists: Record<string, string[]> }) {
  const id = useId();
  const source = sourceOf(app);
  const info = sourceInfo(source);
  const events = route.on.type === "event" ? route.on.events.filter((e) => e !== "*") : [];
  // Where the event name comes from when it isn't in the body.
  const eventHeader = source === "github" ? "x-github-event" : app.eventField?.startsWith("header:") ? app.eventField.slice(7) : undefined;
  const [event, setEvent] = useState(events[0] ?? "");
  const [json, setJson] = useState("");
  const result = run();

  function run(): Verdict | null {
    if (!json.trim()) return null;
    try {
      JSON.parse(json);
    } catch {
      return { forward: false, title: "Not valid JSON", detail: "Paste the request body exactly as the app sends it." };
    }
    const headers = new Headers({ "content-type": "application/json" });
    if (eventHeader && event) headers.set(eventHeader, event);
    const inbound = source === "github" ? parseGithubRequest(headers, json) : source === "telegram" ? parseTelegramRequest(headers, json) : parseWebhookRequest(app, headers, json);
    try {
      const [d] = decide({ ...app, routes: [{ ...route, mode: "enforce", enabled: true }] }, inbound, lists);
      if (!d) return { forward: false, title: "Not matched", detail: `This route handles ${events.join(", ") || "no"} ${info.noun}s; this one is "${inbound.type || "unnamed"}".` };
      if (d.forward) return { forward: true, title: "Forwarded to n8n", detail: "This would use one execution." };
      return { forward: false, title: "Dropped", detail: `Because ${reasonText(d.reason, source)}. No execution used.` };
    } catch (err) {
      return { forward: false, title: "Can't test yet", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  const example = EXAMPLES[source];
  return (
    <div className="try">
      <div className="spread" style={{ marginBottom: 6 }}>
        <label className="label" htmlFor={`${id}-json`} style={{ fontWeight: 600, fontSize: 13.5 }}>
          Try a payload
        </label>
        {example && (
          <button
            type="button"
            className="btn link small"
            onClick={() => {
              setJson(JSON.stringify(example.json, null, 2));
              if (example.event && !events.length) setEvent(example.event);
            }}
          >
            Insert an example
          </button>
        )}
      </div>
      {eventHeader && (
        <label className="field" style={{ marginBottom: 8 }}>
          <span className="label">Event ({eventHeader})</span>
          <input type="text" className="mono" value={event} onChange={(e) => setEvent(e.target.value)} placeholder={events[0] ?? "push"} />
        </label>
      )}
      <textarea id={`${id}-json`} className="payload" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{ "action": "opened", … }' aria-describedby={`${id}-result`} spellCheck={false} />
      <span className="hint" style={{ marginBottom: 10 }}>
        Paste a real request body. {source === "github" ? "In GitHub, Settings → Webhooks → Recent Deliveries shows them." : source === "telegram" ? "Telegram's update format is in its Bot API docs." : "Most services show recent deliveries in their webhook settings."}
      </span>
      <VerdictBox id={`${id}-result`} result={result} empty={`Paste a ${info.noun} to see what the gateway would do with it.`} />
    </div>
  );
}
