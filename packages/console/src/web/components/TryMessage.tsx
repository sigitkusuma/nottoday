/**
 * "Try a message": runs the engine's own routing decision in the browser, so
 * the preview can't disagree with what the gateway will do. The answer is shown
 * as a verdict as soon as there is something to test.
 */

import { useId, useState } from "react";
import { decide } from "@gw/engine/router";
import type { Route } from "@gw/shared";
import { REASON_TEXT } from "../routeSummary";
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
      const why = REASON_TEXT[d.reason ?? ""] ?? d.reason;
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
      <div id={`${id}-result`} role="status" className={`verdict ${result ? (result.forward ? "ok" : "drop") : ""}`}>
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
            <span className="muted small">The gateway's verdict appears here as you type.</span>
          )}
        </span>
      </div>
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
