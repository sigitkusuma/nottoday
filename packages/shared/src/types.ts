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
  /** One entry per connected app. The key is the last part of its URL: see requestPath(). */
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

/** Where an app's requests come from. Configs from before other sources existed have none: they are Slack. */
export type SourceType = "slack" | "github" | "telegram" | "webhook";
export const SOURCE_TYPES: SourceType[] = ["slack", "github", "telegram", "webhook"];

/** URL prefix per source. An app is reached at https://<gateway>/<prefix>/<key>. */
export const SOURCE_PREFIX: Record<SourceType, string> = { slack: "slack", github: "github", telegram: "telegram", webhook: "hook" };

export function sourceOf(app: Pick<AppConfig, "source">): SourceType {
  return app.source ?? "slack";
}

/** Path of an app's endpoint on the gateway, e.g. /github/my-repo. */
export function requestPath(source: SourceType, key: string): string {
  return `/${SOURCE_PREFIX[source]}/${key}`;
}

export interface AppConfig {
  /** Defaults to "slack". */
  source?: SourceType;
  description?: string;
  /**
   * Name of the Worker secret that proves requests are genuine: Slack's signing
   * secret, GitHub's webhook secret, Telegram's secret token, or a webhook's
   * signing secret or token.
   */
  signingSecret: string;
  /** webhook only: how the sender proves a request is genuine. */
  verify?: WebhookVerify;
  /** webhook only: where the event name is, "header:<name>" or a JSON path. Used by `on.events` and stats. */
  eventField?: string;
  routes: Route[];
}

export type WebhookVerify =
  /** HMAC-SHA256 of the raw body, in a header, e.g. GitHub-style "sha256=<hex>" or Shopify's base64. */
  | { type: "hmac"; header: string; prefix?: string; encoding: "hex" | "base64" }
  /** The secret itself, sent in a header (GitLab, Telegram-style). */
  | { type: "header-token"; header: string }
  /** The secret in a query parameter of the URL, for senders that can't set headers. */
  | { type: "url-token"; param: string };

/**
 * A condition on a field of the request body. Fields are dot paths such as
 * "pull_request.user.login"; when a path holds an array, any element may match.
 * Values compare as strings.
 */
export interface Condition {
  field: string;
  op: ConditionOp;
  /** Not used by exists/missing. A list ("@name" or inline) for in/notIn, a regular expression for matches. */
  value?: string | ListRef;
}
export type ConditionOp = "is" | "isNot" | "in" | "notIn" | "matches" | "exists" | "missing";
export const CONDITION_OPS: ConditionOp[] = ["is", "isNot", "in", "notIn", "matches", "exists", "missing"];

/**
 * enforce: only events that pass `filters` are forwarded.
 * shadow: everything matching `on` is forwarded (same as no gateway), and the
 * log records what enforce mode would have dropped. Use it to measure savings
 * before switching a route to enforce.
 */
export type RouteMode = "enforce" | "shadow";

export interface Route {
  /** Unique within the app; shows up in logs and the x-nottoday-route header. */
  name: string;
  description?: string;
  /** Defaults to true. */
  enabled?: boolean;
  /** Defaults to "enforce". */
  mode?: RouteMode;
  /** Which kind of Slack request this route handles. Always applied, in every mode. */
  on: Trigger;
  /** Slack only: extra conditions for event routes. These are what save executions. */
  filters?: EventFilters;
  /** Conditions on fields of the request, for any source. All must pass. */
  match?: Condition[];
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
  /**
   * Events. `events` holds event names; "*" matches any. Slack: event types
   * (message, app_mention). GitHub: the X-GitHub-Event header (push,
   * pull_request). Telegram: the update type (message, callback_query).
   * Webhook: the value of the app's eventField.
   */
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
