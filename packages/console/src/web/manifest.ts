/**
 * Slack app manifest for a new app that sends its events to the gateway, and
 * the link that opens Slack's "Create app" page with it filled in. Pure.
 * Reference: https://docs.slack.dev/reference/app-manifest
 */

export type ListenId = "mentions" | "channels" | "private" | "dms";

export interface ListenOption {
  id: ListenId;
  label: string;
  hint: string;
  /** Slack bot events to subscribe to. */
  events: string[];
  /** Permissions those events need. */
  scopes: string[];
}

/**
 * What the bot can listen to. Slack only sends the events an app subscribes to, so each
 * one ticked here is traffic to the gateway (a Worker request each), and each one left
 * out is traffic that never happens. Subscribe to what at least one route uses.
 */
export const LISTEN_OPTIONS: ListenOption[] = [
  { id: "mentions", label: "@mentions of the bot", hint: "Someone writes @bot in a channel the bot is in. Quiet: only what is aimed at the bot.", events: ["app_mention"], scopes: ["app_mentions:read"] },
  { id: "channels", label: "Messages in public channels", hint: "Every message in the public channels the bot has joined. The busiest choice.", events: ["message.channels"], scopes: ["channels:history"] },
  { id: "private", label: "Messages in private channels", hint: "Every message in the private channels the bot has been added to.", events: ["message.groups"], scopes: ["groups:history"] },
  { id: "dms", label: "Direct messages to the bot", hint: "Messages people send to the bot privately.", events: ["message.im"], scopes: ["im:history"] },
];

/** Everything, so any route can work. The wizard starts here and lets people take away what they don't need. */
export const DEFAULT_LISTEN: ListenId[] = LISTEN_OPTIONS.map((o) => o.id);

const chosen = (listen: readonly ListenId[]) => LISTEN_OPTIONS.filter((o) => listen.includes(o.id));
export const listenEvents = (listen: readonly ListenId[]): string[] => chosen(listen).flatMap((o) => o.events);
/** The permissions for the chosen events, plus chat:write so the workflow can reply. */
export const listenScopes = (listen: readonly ListenId[]): string[] => [...chosen(listen).flatMap((o) => o.scopes), "chat:write"];
/** True when the bot hears ordinary messages, not only @mentions. */
export const hearsMessages = (listen: readonly ListenId[]): boolean => listen.some((id) => id !== "mentions");

export const BOT_EVENTS = listenEvents(DEFAULT_LISTEN);
export const BOT_SCOPES = listenScopes(DEFAULT_LISTEN);

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

export function buildManifest(appName: string, requestUrl: string, description?: string, listen: readonly ListenId[] = DEFAULT_LISTEN): SlackManifest {
  const name = appName.trim().slice(0, 35) || "Gateway bot";
  return {
    display_information: { name, ...(description?.trim() ? { description: description.trim().slice(0, 140) } : {}) },
    features: {
      bot_user: { display_name: botHandle(name), always_online: true },
      // Lets people DM the bot, for "direct messages" routes.
      app_home: { messages_tab_enabled: listen.includes("dms"), messages_tab_read_only_enabled: false },
    },
    oauth_config: { scopes: { bot: listenScopes(listen) } },
    settings: {
      event_subscriptions: { request_url: requestUrl, bot_events: listenEvents(listen) },
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
