import type { GatewayConfig } from "@gw/shared";

/** Common ways to put a Slack-triggered workflow behind the gateway. IDs and URLs are made up. */
const config: GatewayConfig = {
  lists: {
    oncall: ["UONCALL01", "UONCALL02"],
    supportChannels: ["CSUPPORT01"],
  },
  apps: {
    workspace: {
      signingSecret: "SLACK_SIGNING_SECRET_WORKSPACE",
      routes: [
        {
          // Mirrors a workflow that acts when someone on the list is mentioned, by someone else, in a real message.
          name: "oncall-mentions",
          mode: "shadow",
          on: { type: "event", events: ["message"] },
          filters: { subtypes: ["", "thread_broadcast", "file_share"], ignoreBots: true, mentionIn: "@oncall", ignoreSelfMention: true },
          forwardTo: "https://n8n.test/webhook/oncall-alert",
        },
        {
          name: "assistant-dms",
          on: { type: "event", events: ["message"] },
          filters: { channelTypes: ["im"], subtypes: [""], ignoreBots: true },
          forwardTo: "https://n8n.test/webhook/assistant",
        },
        {
          name: "support-triage",
          on: { type: "event", events: ["message"] },
          filters: { channels: "@supportChannels", subtypes: ["", "file_share"], ignoreBots: true },
          forwardTo: "https://n8n.test/webhook/support-triage",
        },
        {
          name: "new-channel",
          enabled: false,
          on: { type: "event", events: ["channel_created"] },
          forwardTo: "https://n8n.test/webhook/new-channel",
        },
      ],
    },
  },
};

export default config;
