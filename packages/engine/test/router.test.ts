import { describe, expect, it } from "vitest";
import config from "./fixtures/routes.config";
import { decide } from "../src/router";
import type { SlackEvent, SlackInbound } from "../src/slack";
import type { AppConfig } from "@gw/shared";

const ONCALL = "UONCALL01";
const OTHER = "UNOTLISTED";
const SENDER = "USENDER01";

const shadowApp = config.apps.workspace;
const enforceApp: AppConfig = {
  ...shadowApp,
  routes: shadowApp.routes.map((r) => ({ ...r, mode: "enforce" as const })),
};

const event = (e: Partial<SlackEvent>): SlackInbound => ({
  kind: "event",
  event: { type: "message", user: SENDER, channel: "C123", channel_type: "channel", ...e },
});

function decision(app: AppConfig, inbound: SlackInbound, route: string) {
  return decide(app, inbound, config.lists).find((d) => d.route.name === route);
}

/**
 * Modeled on an alert workflow that acts when its first <@mention> is someone on
 * the list, the sender is not that person, there is no bot_id, and the subtype
 * is "", thread_broadcast or file_share. The gateway must forward every such message.
 */
describe("mention of someone on a list (enforce)", () => {
  const route = (inbound: SlackInbound) => decision(enforceApp, inbound, "oncall-mentions");

  it.each([
    ["plain message mentioning someone on the list", { text: `please check <@${ONCALL}>` }],
    ["thread broadcast", { text: `<@${ONCALL}>`, subtype: "thread_broadcast" }],
    ["file share", { text: `<@${ONCALL}> see file`, subtype: "file_share" }],
    ["listed person is the second mention (forwarding more than the workflow needs is safe)", { text: `<@${OTHER}> <@${ONCALL}>` }],
  ])("forwards: %s", (_label, e) => {
    expect(route(event(e))).toMatchObject({ forward: true, filter: "pass" });
  });

  it.each([
    ["message edit", { text: "", subtype: "message_changed" }, "subtypes"],
    ["message deleted", { subtype: "message_deleted" }, "subtypes"],
    ["bot post", { text: `<@${ONCALL}>`, bot_id: "B1" }, "ignoreBots"],
    ["no mention", { text: "lunch?" }, "requireMention"],
    ["only mentions someone not on the list", { text: `<@${OTHER}> hi` }, "mentionIn"],
    ["listed person mentions themself", { user: ONCALL, text: `<@${ONCALL}> note to self` }, "requireMention"],
  ])("drops: %s", (_label, e, reason) => {
    expect(route(event(e))).toMatchObject({ forward: false, filter: "fail", reason });
  });

  it("ignores events of other types", () => {
    expect(route(event({ type: "reaction_added" }))).toBeUndefined();
  });
});

describe("direct messages to the bot", () => {
  const route = (inbound: SlackInbound) => decision(enforceApp, inbound, "assistant-dms");

  it("forwards a DM", () => {
    expect(route(event({ channel_type: "im", text: "hi" }))).toMatchObject({ forward: true });
  });

  it.each([
    ["a channel message", { channel_type: "channel", text: "hi" }, "channelTypes"],
    ["the bot's own reply in the DM", { channel_type: "im", bot_id: "B1", text: "hello!" }, "ignoreBots"],
    ["an edit in the DM", { channel_type: "im", subtype: "message_changed" }, "subtypes"],
  ])("drops %s", (_label, e, reason) => {
    expect(route(event(e))).toMatchObject({ forward: false, reason });
  });
});

describe("messages in specific channels", () => {
  const route = (inbound: SlackInbound) => decision(enforceApp, inbound, "support-triage");

  it("forwards a new message in a listed channel", () => {
    expect(route(event({ channel: "CSUPPORT01", text: "the export is broken" }))).toMatchObject({ forward: true });
  });

  it("drops messages in other channels", () => {
    expect(route(event({ channel: "CRANDOM01", text: "the export is broken" }))).toMatchObject({ forward: false, reason: "channels" });
  });
});

describe("one message, several routes", () => {
  it("gives each matching route its own decision", () => {
    const decisions = decide(enforceApp, event({ channel: "CSUPPORT01", text: `<@${ONCALL}> can you look?` }), config.lists);
    expect(decisions.filter((d) => d.forward).map((d) => d.route.name)).toEqual(["oncall-mentions", "support-triage"]);
  });
});

describe("shadow mode", () => {
  it("forwards a message the filters reject, and records why", () => {
    expect(decision(shadowApp, event({ text: "lunch?" }), "oncall-mentions")).toMatchObject({
      forward: true,
      filter: "fail",
      reason: "requireMention",
    });
  });
});

describe("disabled routes", () => {
  it("never forward", () => {
    const decisions = decide(enforceApp, event({ type: "channel_created", channel: { id: "C9" } } as Partial<SlackEvent>), config.lists);
    expect(decisions.find((d) => d.route.name === "new-channel")).toBeUndefined();
  });
});

describe("interactivity and command triggers", () => {
  const app: AppConfig = {
    signingSecret: "X",
    routes: [
      { name: "approve", on: { type: "interactivity", actionIds: ["approve_request"] }, forwardTo: "https://n8n.test/a" },
      { name: "modal", on: { type: "interactivity", callbackIds: ["feedback_modal"] }, forwardTo: "https://n8n.test/b" },
      { name: "cmd", on: { type: "command", commands: ["/ask"] }, forwardTo: "https://n8n.test/c" },
    ],
  };
  const names = (inbound: SlackInbound) => decide(app, inbound, {}).map((d) => d.route.name);

  it("matches by action_id, callback_id and command", () => {
    expect(names({ kind: "interactivity", payload: { type: "block_actions", actions: [{ action_id: "approve_request" }] } })).toEqual(["approve"]);
    expect(names({ kind: "interactivity", payload: { type: "view_submission", view: { callback_id: "feedback_modal" } } })).toEqual(["modal"]);
    expect(names({ kind: "command", command: "/ask" })).toEqual(["cmd"]);
    expect(names({ kind: "command", command: "/other" })).toEqual([]);
  });
});
