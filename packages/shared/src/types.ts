/**
 * Gateway config types. The config is a JSON document stored in the gateway's
 * KV namespace (key `config:current`). The console writes it; the engine reads it.
 * Both run validateConfig() on it.
 */

/** Inline values, or "@name" to use an entry from `lists`. */
export type ListRef = string[] | `@${string}`;

export interface GatewayConfig {
  /** Reusable value lists (user IDs, channel IDs), referenced as "@name". */
  lists: Record<string, string[]>;
  /** One entry per Slack app. The key is the URL path: /slack/<key>. */
  apps: Record<string, AppConfig>;
  /** Lists copied from an n8n data table, keyed by list name, so the console can refresh them. */
  listSources?: Record<string, ListSource>;
}

export interface ListSource {
  type: "n8n-data-table";
  tableId: string;
  tableName: string;
  column: string;
  /** ISO time of the last refresh. */
  syncedAt?: string;
}

export interface AppConfig {
  /** Where requests come from. Only "slack" exists today; defaults to "slack". */
  source?: "slack";
  description?: string;
  /** Name of the Worker secret holding this Slack app's signing secret. */
  signingSecret: string;
  routes: Route[];
}

/**
 * enforce: only events that pass `filters` are forwarded.
 * shadow: everything matching `on` is forwarded (same as no gateway), and the
 * log records what enforce mode would have dropped. Use it to measure savings
 * before switching a route to enforce.
 */
export type RouteMode = "enforce" | "shadow";

export interface Route {
  /** Unique within the app; shows up in logs and the x-slack-gateway-route header. */
  name: string;
  description?: string;
  /** Defaults to true. */
  enabled?: boolean;
  /** Defaults to "enforce". */
  mode?: RouteMode;
  /** Which kind of Slack request this route handles. Always applied, in every mode. */
  on: Trigger;
  /** Extra conditions for event routes. These are what save executions. */
  filters?: EventFilters;
  /** n8n URL that receives the Slack request unchanged (a Slack Trigger or Webhook node). */
  forwardTo: string;
  /**
   * ack (default): reply 200 to Slack at once, forward in the background.
   * proxy: wait for n8n (up to 2.5s) and return its reply to Slack. Needed when
   * the workflow answers Slack directly, e.g. a slash command reply or a modal
   * validation error. At most one proxy route should match a request.
   */
  respond?: "ack" | "proxy";
}

export type Trigger =
  /** Events API. `events` holds Slack event types; "*" matches any type. */
  | { type: "event"; events: string[] }
  /** Button clicks, menus, modals, shortcuts. Omitted lists match everything. */
  | { type: "interactivity"; payloadTypes?: string[]; actionIds?: string[]; callbackIds?: string[] }
  /** Slash commands, e.g. ["/ask"]. */
  | { type: "command"; commands: string[] };

/**
 * Every filter you set must pass. Keep each one at least as loose as the
 * workflow's own checks: the gateway may forward too much, never too little.
 */
export interface EventFilters {
  /** Allowed message subtypes. Use "" for a plain message (no subtype). */
  subtypes?: string[];
  /** Drop events posted by bots (events that carry a bot_id). */
  ignoreBots?: boolean;
  /** channel, group, im, mpim. */
  channelTypes?: string[];
  /** Only these channel IDs. */
  channels?: ListRef;
  /** Never these channel IDs. */
  excludeChannels?: ListRef;
  /** Only events from these user IDs. */
  users?: ListRef;
  /** Never events from these user IDs. */
  excludeUsers?: ListRef;
  /** The text must contain at least one <@USER> mention. */
  requireMention?: boolean;
  /** At least one mentioned user must be in this list (implies requireMention). */
  mentionIn?: ListRef;
  /** Mentions of the sender themself don't count toward requireMention/mentionIn. */
  ignoreSelfMention?: boolean;
  /** JavaScript regular expression the text must match. */
  textMatches?: string;
}

export function defineConfig(config: GatewayConfig): GatewayConfig {
  return config;
}
