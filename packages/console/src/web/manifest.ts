/**
 * Slack app manifest for a new app that sends its events to the gateway, and
 * the link that opens Slack's "Create app" page with it filled in. Pure.
 * Reference: https://docs.slack.dev/reference/app-manifest
 */

export const BOT_EVENTS = ["message.channels", "message.groups", "message.im", "app_mention"];
export const BOT_SCOPES = ["channels:history", "groups:history", "im:history", "app_mentions:read", "chat:write"];

export interface SlackManifest {
  display_information: { name: string; description?: string };
  features: { bot_user: { display_name: string; always_online: boolean }; app_home: { messages_tab_enabled: boolean; messages_tab_read_only_enabled: boolean } };
  oauth_config: { scopes: { bot: string[] } };
  settings: {
    event_subscriptions: { request_url: string; bot_events: string[] };
    org_deploy_enabled: boolean;
    socket_mode_enabled: boolean;
    token_rotation_enabled: boolean;
  };
}

export function buildManifest(appName: string, requestUrl: string, description?: string): SlackManifest {
  const name = appName.trim().slice(0, 35) || "Gateway bot";
  return {
    display_information: { name, ...(description?.trim() ? { description: description.trim().slice(0, 140) } : {}) },
    features: {
      bot_user: { display_name: botHandle(name), always_online: true },
      // Lets people DM the bot, for "direct messages" routes.
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    oauth_config: { scopes: { bot: BOT_SCOPES } },
    settings: {
      event_subscriptions: { request_url: requestUrl, bot_events: BOT_EVENTS },
      org_deploy_enabled: false,
      // With Socket Mode on, Slack never calls the Request URL.
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Slack allows a-z, 0-9, -, _ and . in the bot's display name. */
export function botHandle(name: string): string {
  const handle = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return handle || "gateway-bot";
}

export function createAppUrl(manifest: SlackManifest): string {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}
