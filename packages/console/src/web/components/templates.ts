/** Starting points for common Slack-triggered workflows. Each sets the trigger and filters; name and target stay as typed. */

import type { EventFilters, Trigger } from "../types";

export interface RouteTemplate {
  id: string;
  label: string;
  /** What the workflow does, so people recognise their case. */
  example: string;
  on: Trigger;
  filters?: EventFilters;
  respond?: "proxy";
  /** What the user still has to fill in. */
  todo?: string;
}

const REAL_MESSAGES = ["", "thread_broadcast", "file_share"];

export const ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    id: "mention-list",
    label: "Messages that mention someone on a list",
    example: "Alert someone when an on-call person, a manager or a key account owner is mentioned.",
    on: { type: "event", events: ["message"] },
    filters: { subtypes: REAL_MESSAGES, ignoreBots: true, requireMention: true, ignoreSelfMention: true },
    todo: "Under “Must mention someone in”, choose a saved list, create a new one, or type user IDs.",
  },
  {
    id: "dm",
    label: "Direct messages to the bot",
    example: "An assistant or helpdesk bot that answers what people send it privately.",
    on: { type: "event", events: ["message"] },
    filters: { channelTypes: ["im"], subtypes: [""], ignoreBots: true },
  },
  {
    id: "bot-mention",
    label: "Mentions of the bot",
    example: "A bot that replies when someone writes @bot in a channel. Slack sends app_mention only when the bot is mentioned.",
    on: { type: "event", events: ["app_mention"] },
    filters: { ignoreBots: true },
  },
  {
    id: "channels",
    label: "New messages in specific channels",
    example: "Triage every new post in #support, or log announcements from #releases.",
    on: { type: "event", events: ["message"] },
    filters: { subtypes: ["", "file_share"], ignoreBots: true },
    todo: "Add the channel IDs (or a list) under “Only these channels”.",
  },
  {
    id: "keyword",
    label: "Messages containing a keyword",
    example: "Open a ticket when someone writes “bug” or “outage”.",
    on: { type: "event", events: ["message"] },
    filters: { subtypes: REAL_MESSAGES, ignoreBots: true, textMatches: "\\b([Bb]ug|[Oo]utage)\\b" },
    todo: "Adjust the pattern under “Text must match”.",
  },
  {
    id: "command",
    label: "A slash command",
    example: "/ask, /report or /standup handled by a workflow that answers in Slack.",
    on: { type: "command", commands: [] },
    respond: "proxy",
    todo: "Type the command, e.g. /ask.",
  },
  {
    id: "buttons",
    label: "Button clicks and modal submissions",
    example: "Approve/deny buttons, forms in a modal.",
    on: { type: "interactivity" },
    todo: "Optionally limit it to your action or callback IDs.",
  },
];
