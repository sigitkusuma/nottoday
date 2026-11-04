/**
 * Everything the console shows that depends on where an app's requests come
 * from: names, events, the fields routes can filter on, starting templates and
 * webhook signature presets. Components read from here instead of assuming Slack.
 */

import type { Condition, SourceType, Trigger, WebhookVerify } from "@gw/shared";
import type { IconName } from "./components/icons";

export interface FieldInfo {
  path: string;
  label: string;
  /** Values people usually compare against, offered as suggestions. */
  suggestions?: string[];
}

export interface SourceTemplate {
  id: string;
  label: string;
  example: string;
  on: Trigger;
  match?: Condition[];
  respond?: "proxy";
  todo?: string;
}

export interface SourceInfo {
  id: SourceType;
  label: string;
  icon: IconName;
  /** One line for the "Connect an app" tile. */
  tagline: string;
  /** False: shown in "Connect an app" as coming soon, and can't be picked. Apps already connected keep working. */
  available: boolean;
  /** What one incoming request is called. */
  noun: string;
  /** Who sends the requests, for sentences: "Waiting for GitHub", "the service's requests fail…". */
  sender: string;
  /** Common event names, offered as chips in the route editor. */
  events: { value: string; label: string }[];
  fields: FieldInfo[];
  templates: SourceTemplate[];
}

const BOT_OR_USER = ["User", "Bot"];

export const SOURCES: Record<SourceType, SourceInfo> = {
  slack: {
    id: "slack",
    label: "Slack",
    icon: "hash",
    tagline: "Messages, mentions, slash commands and buttons from a Slack app.",
    available: true,
    noun: "event",
    sender: "Slack",
    // A message that @mentions the app arrives as two events, "message" and "app_mention"; routes pick which the workflow needs.
    events: [
      { value: "message", label: "Messages" },
      { value: "app_mention", label: "@mentions of the app" },
      { value: "reaction_added", label: "Reactions added" },
      { value: "reaction_removed", label: "Reactions removed" },
      { value: "member_joined_channel", label: "Someone joined a channel" },
      { value: "channel_created", label: "Channels created" },
      { value: "file_shared", label: "Files shared" },
      { value: "app_home_opened", label: "App Home opened" },
      { value: "team_join", label: "New workspace members" },
    ],
    fields: [],
    templates: [],
  },
  github: {
    id: "github",
    label: "GitHub",
    icon: "branch",
    tagline: "Pushes, pull requests, issues, releases and workflow runs from a repository or organization.",
    available: false,
    noun: "event",
    sender: "GitHub",
    events: [
      { value: "push", label: "Pushes" },
      { value: "pull_request", label: "Pull requests" },
      { value: "pull_request_review", label: "Reviews" },
      { value: "issues", label: "Issues" },
      { value: "issue_comment", label: "Comments" },
      { value: "release", label: "Releases" },
      { value: "workflow_run", label: "Workflow runs" },
    ],
    fields: [
      { path: "action", label: "Action", suggestions: ["opened", "closed", "reopened", "edited", "created", "submitted", "completed", "published", "synchronize"] },
      { path: "branch", label: "Branch (pushes)", suggestions: ["main", "master"] },
      { path: "tag", label: "Tag (pushes)" },
      { path: "repository.full_name", label: "Repository (owner/name)" },
      { path: "sender.login", label: "Sender's username" },
      { path: "sender.type", label: "Sender type", suggestions: BOT_OR_USER },
      { path: "pull_request.base.ref", label: "Pull request target branch", suggestions: ["main"] },
      { path: "pull_request.merged", label: "Pull request merged", suggestions: ["true", "false"] },
      { path: "pull_request.draft", label: "Draft pull request", suggestions: ["true", "false"] },
      { path: "pull_request.labels.name", label: "Pull request label" },
      { path: "issue.labels.name", label: "Issue label" },
      { path: "workflow_run.conclusion", label: "Workflow run result", suggestions: ["success", "failure", "cancelled", "timed_out"] },
      { path: "workflow_run.name", label: "Workflow name" },
      { path: "head_commit.message", label: "Commit message" },
      { path: "comment.body", label: "Comment text" },
    ],
    templates: [
      {
        id: "gh-push",
        label: "Pushes to a branch",
        example: "Deploy, or post a note, when someone pushes to main. Bot pushes are ignored.",
        on: { type: "event", events: ["push"] },
        match: [
          { field: "branch", op: "is", value: "main" },
          { field: "sender.type", op: "isNot", value: "Bot" },
        ],
        todo: "Change the branch below if yours isn't main.",
      },
      {
        id: "gh-pr",
        label: "Pull requests opened or merged",
        example: "Ask for a review when a pull request opens, announce it when it's merged. Edits and label changes are ignored.",
        on: { type: "event", events: ["pull_request"] },
        match: [{ field: "action", op: "in", value: ["opened", "reopened", "closed"] }],
      },
      {
        id: "gh-issue",
        label: "New issues",
        example: "Triage or label every new issue.",
        on: { type: "event", events: ["issues"] },
        match: [{ field: "action", op: "is", value: "opened" }],
      },
      {
        id: "gh-comment",
        label: "Comments from people, not bots",
        example: "React to new comments on issues and pull requests, without CI bots setting it off.",
        on: { type: "event", events: ["issue_comment"] },
        match: [
          { field: "action", op: "is", value: "created" },
          { field: "sender.type", op: "isNot", value: "Bot" },
        ],
      },
      {
        id: "gh-failed-run",
        label: "Failed workflow runs",
        example: "Alert someone when a GitHub Actions run fails. Successful runs never reach n8n.",
        on: { type: "event", events: ["workflow_run"] },
        match: [
          { field: "action", op: "is", value: "completed" },
          { field: "workflow_run.conclusion", op: "is", value: "failure" },
        ],
      },
      {
        id: "gh-release",
        label: "Published releases",
        example: "Announce a release, or start a deploy.",
        on: { type: "event", events: ["release"] },
        match: [{ field: "action", op: "is", value: "published" }],
      },
    ],
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    icon: "send",
    tagline: "Messages, commands and button presses sent to a Telegram bot.",
    available: false,
    noun: "update",
    sender: "Telegram",
    events: [
      { value: "message", label: "Messages" },
      { value: "edited_message", label: "Edits" },
      { value: "callback_query", label: "Button presses" },
      { value: "channel_post", label: "Channel posts" },
      { value: "my_chat_member", label: "Bot added or removed" },
    ],
    fields: [
      { path: "text", label: "Message text" },
      { path: "command", label: "Bot command", suggestions: ["/start", "/help"] },
      { path: "chat.id", label: "Chat ID" },
      { path: "chat.type", label: "Chat type", suggestions: ["private", "group", "supergroup", "channel"] },
      { path: "from.id", label: "Sender ID" },
      { path: "from.username", label: "Sender's username" },
      { path: "from.is_bot", label: "Sender is a bot", suggestions: ["true", "false"] },
      { path: "callback_query.data", label: "Button data" },
    ],
    templates: [
      {
        id: "tg-private",
        label: "Messages to the bot",
        example: "An assistant that answers what people send it in a private chat. Group chatter is ignored.",
        on: { type: "event", events: ["message"] },
        match: [
          { field: "chat.type", op: "is", value: "private" },
          { field: "from.is_bot", op: "isNot", value: "true" },
        ],
      },
      {
        id: "tg-command",
        label: "A bot command",
        example: "/deploy, /report or /status handled by a workflow. Every other message is ignored.",
        on: { type: "event", events: ["message"] },
        match: [{ field: "command", op: "is", value: "/start" }],
        todo: "Change /start below to your command.",
      },
      {
        id: "tg-group-mention",
        label: "Group messages that mention the bot",
        example: "A bot in a busy group that only acts when someone writes @your_bot.",
        on: { type: "event", events: ["message"] },
        match: [
          { field: "chat.type", op: "in", value: ["group", "supergroup"] },
          { field: "text", op: "matches", value: "@your_bot" },
        ],
        todo: "Replace @your_bot with your bot's username.",
      },
      {
        id: "tg-buttons",
        label: "Button presses",
        example: "Approve/deny buttons under a bot message.",
        on: { type: "event", events: ["callback_query"] },
      },
    ],
  },
  webhook: {
    id: "webhook",
    label: "Any webhook",
    icon: "link",
    tagline: "Shopify, Linear, Typeform, GitLab, or your own service: anything that sends a signed request.",
    available: false,
    noun: "request",
    sender: "the service",
    events: [],
    fields: [],
    templates: [
      {
        id: "hook-fields",
        label: "Only when a field matches",
        example: "Forward only the requests your workflow acts on, e.g. paid orders or high-priority issues.",
        on: { type: "event", events: ["*"] },
        match: [{ field: "", op: "is", value: "" }],
        todo: "Set the field and value below. Paste a sample request into Try a payload to see the field names.",
      },
      {
        id: "hook-all",
        label: "Everything",
        example: "Forward every verified request. The gateway still drops anything with a bad signature.",
        on: { type: "event", events: ["*"] },
      },
    ],
  },
};

export interface VerifyPreset {
  id: string;
  label: string;
  /** Where to find the secret in that service. */
  hint: string;
  verify: WebhookVerify;
  eventField?: string;
  /** The service makes the secret; the console can't generate it. */
  serviceSecret?: boolean;
}

export const VERIFY_PRESETS: VerifyPreset[] = [
  {
    id: "github-style",
    label: "GitHub-style signature",
    hint: "X-Hub-Signature-256: sha256=… Used by GitHub, Gitea, Forgejo, Jira and others.",
    verify: { type: "hmac", header: "x-hub-signature-256", prefix: "sha256=", encoding: "hex" },
    eventField: "header:x-github-event",
  },
  {
    id: "shopify",
    label: "Shopify",
    hint: "Settings → Notifications → Webhooks shows the signing secret.",
    verify: { type: "hmac", header: "x-shopify-hmac-sha256", encoding: "base64" },
    eventField: "header:x-shopify-topic",
    serviceSecret: true,
  },
  {
    id: "linear",
    label: "Linear",
    hint: "Settings → API → Webhooks shows the signing secret after you create the webhook.",
    verify: { type: "hmac", header: "linear-signature", encoding: "hex" },
    eventField: "type",
    serviceSecret: true,
  },
  {
    id: "typeform",
    label: "Typeform",
    hint: "In the form's Connect → Webhooks, edit the webhook and set a secret.",
    verify: { type: "hmac", header: "typeform-signature", prefix: "sha256=", encoding: "base64" },
    eventField: "event_type",
  },
  {
    id: "gitlab",
    label: "GitLab",
    hint: "Settings → Webhooks has a Secret token field.",
    verify: { type: "header-token", header: "x-gitlab-token" },
    eventField: "header:x-gitlab-event",
  },
  {
    id: "custom-hmac",
    label: "Other HMAC signature",
    hint: "HMAC-SHA256 of the request body, in a header.",
    verify: { type: "hmac", header: "x-signature", encoding: "hex" },
  },
  {
    id: "header-token",
    label: "A secret in a header",
    hint: "The service sends a fixed secret in a header you choose.",
    verify: { type: "header-token", header: "x-webhook-token" },
  },
  {
    id: "url-token",
    label: "A secret in the URL",
    hint: "For services that can't set headers or sign requests. The secret becomes part of the URL you paste.",
    verify: { type: "url-token", param: "token" },
  },
];

export const sourceInfo = (s: SourceType | undefined) => SOURCES[s ?? "slack"];

/** "Branch (pushes)" for a known path, the path itself otherwise. */
export function fieldLabel(source: SourceType | undefined, path: string): string {
  return sourceInfo(source).fields.find((f) => f.path === path)?.label ?? path;
}
