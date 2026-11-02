/**
 * Describes a route in plain words, so people can check a route does what they
 * meant before saving it. Pure: also used by the tests.
 */

import type { EventFilters, ListRef, Route } from "@gw/shared";

const SUBTYPE_NAMES: Record<string, string> = {
  "": "new messages",
  thread_broadcast: "thread replies also sent to the channel",
  file_share: "messages with a file",
  bot_message: "bot messages",
  message_changed: "edits",
  message_deleted: "deletes",
};

const CHANNEL_TYPE_NAMES: Record<string, string> = {
  channel: "public channels",
  group: "private channels",
  im: "direct messages to the bot",
  mpim: "group DMs",
};

/** Why a message was dropped, in words. Keys are the router's filter names. */
export const REASON_TEXT: Record<string, string> = {
  subtypes: "it's a kind of message this route doesn't keep (for example an edit or a delete)",
  ignoreBots: "it was posted by a bot",
  channelTypes: "it's not in a kind of conversation this route keeps",
  channels: "it's not in one of the listed channels",
  excludeChannels: "it's in an excluded channel",
  users: "the sender isn't one of the listed users",
  excludeUsers: "the sender is excluded",
  requireMention: "it doesn't mention anyone (mentioning yourself doesn't count when that option is on)",
  mentionIn: "it doesn't mention anyone on the list",
  textMatches: "the text doesn't match the pattern",
};

export function summarizeRoute(route: Route): string[] {
  const on = route.on;
  if (on.type === "command") {
    const cmds = on.commands.length ? on.commands.join(", ") : "(no command set yet)";
    return [`Forwards the slash command ${cmds}${route.respond === "proxy" ? " and returns n8n's reply to Slack" : ""}.`];
  }
  if (on.type === "interactivity") {
    const ids = [...(on.actionIds ?? []), ...(on.callbackIds ?? [])];
    return [ids.length ? `Forwards button clicks and modal submissions with the IDs ${ids.join(", ")}.` : "Forwards every button click, menu choice and modal submission."];
  }

  const f: EventFilters = route.filters ?? {};
  const what = describeEvents(on.events, f);
  const where = describeWhere(f);
  const conditions = describeConditions(f);
  const first = `Forwards ${what}${where ? ` ${where}` : ""}${conditions.length ? ` ${conditions.join(" and ")}` : ""}.`;

  const dropped: string[] = [];
  if (f.subtypes) {
    const kept = new Set(f.subtypes);
    const notKept = Object.keys(SUBTYPE_NAMES).filter((s) => !kept.has(s)).map((s) => SUBTYPE_NAMES[s]);
    // Slack has more subtypes (joins, topic changes…) than the named ones; they're dropped too.
    dropped.push(joinWords([...notKept, "other message kinds such as joins"]));
  }
  if (f.ignoreBots) dropped.push("anything posted by a bot");
  if (f.excludeChannels) dropped.push(`messages in ${listText(f.excludeChannels, "channel")}`);
  if (f.excludeUsers) dropped.push(`messages from ${listText(f.excludeUsers, "user")}`);

  const sentences = [first];
  if (dropped.length) sentences.push(`Drops ${joinWords(dropped)}.`);
  if (!route.filters) sentences.push("No filters: every matching request reaches n8n, so this route saves nothing yet.");
  return sentences;
}

function describeEvents(events: string[], f: EventFilters): string {
  if (events.includes("*")) return "every event";
  const names = events.map((e) => {
    if (e === "message") {
      const kinds = f.subtypes?.map((s) => SUBTYPE_NAMES[s] ?? `"${s}" messages`);
      return kinds?.length ? joinWords(kinds) : "messages";
    }
    if (e === "app_mention") return "mentions of the bot";
    return `${e} events`;
  });
  return joinWords(names);
}

function describeWhere(f: EventFilters): string {
  const parts: string[] = [];
  if (f.channelTypes?.length) parts.push(`in ${joinWords(f.channelTypes.map((t) => CHANNEL_TYPE_NAMES[t] ?? t), "or")}`);
  if (f.channels) parts.push(`in ${listText(f.channels, "channel")}`);
  if (!parts.length) return "in any conversation the bot is in";
  return parts.join(", ");
}

function describeConditions(f: EventFilters): string[] {
  const out: string[] = [];
  if (f.users) out.push(`from ${listText(f.users, "user")}`);
  if (f.mentionIn) out.push(`that mention someone in ${listText(f.mentionIn, "user")}${f.ignoreSelfMention ? " (not counting people mentioning themselves)" : ""}`);
  else if (f.requireMention) out.push(`that mention someone${f.ignoreSelfMention ? " other than the sender" : ""}`);
  if (f.textMatches) out.push(`whose text matches ${f.textMatches}`);
  return out;
}

function listText(ref: ListRef, noun: string): string {
  if (typeof ref === "string") return `the list ${ref}`;
  if (ref.length === 0) return `no ${noun}s yet`;
  if (ref.length === 1) return ref[0];
  return `${ref.length} ${noun}s`;
}

function joinWords(items: string[], last = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;
}
