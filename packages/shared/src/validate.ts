/**
 * Config checks the type system can't express. The console runs them before
 * every save and the engine runs them on load, so a bad config never goes live.
 */

import { CONDITION_OPS, SOURCE_TYPES, type Condition, type EventFilters, type GatewayConfig, type ListRef, type WebhookVerify } from "./types";

const LIST_FILTERS = ["channels", "excludeChannels", "users", "excludeUsers", "mentionIn"] as const;

export function validateConfig(cfg: GatewayConfig): string[] {
  const errors: string[] = [];

  for (const [name, values] of Object.entries(cfg.lists)) {
    if (values.some((v) => v.trim() === "")) errors.push(`lists.${name} contains an empty value`);
    if (new Set(values).size !== values.length) errors.push(`lists.${name} contains duplicates`);
  }

  for (const name of Object.keys(cfg.listSources ?? {})) {
    if (!Object.hasOwn(cfg.lists, name)) errors.push(`listSources.${name} has no matching list`);
  }

  for (const [appName, app] of Object.entries(cfg.apps)) {
    const at = `apps.${appName}`;
    if (!/^[a-z0-9_-]+$/.test(appName)) errors.push(`${at}: app key must be lowercase letters, digits, - or _`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(app.signingSecret)) errors.push(`${at}.signingSecret must be a secret NAME like SLACK_SIGNING_SECRET_X, not the secret itself`);
    if (app.source !== undefined && !SOURCE_TYPES.includes(app.source)) errors.push(`${at}.source must be one of ${SOURCE_TYPES.join(", ")}`);
    const source = app.source ?? "slack";
    if (source === "webhook") {
      if (!app.verify) errors.push(`${at}.verify is required for a webhook: say how requests prove they're genuine`);
      else errors.push(...checkVerify(`${at}.verify`, app.verify));
      if (app.eventField !== undefined && !app.eventField.trim()) errors.push(`${at}.eventField is empty`);
    } else {
      if (app.verify !== undefined) errors.push(`${at}.verify only applies to webhook apps`);
      if (app.eventField !== undefined) errors.push(`${at}.eventField only applies to webhook apps`);
    }

    const seen = new Set<string>();
    for (const route of app.routes) {
      const r = `${at}.routes[${route.name || "?"}]`;
      if (!route.name) errors.push(`${r}: name is required`);
      if (seen.has(route.name)) errors.push(`${r}: duplicate route name`);
      seen.add(route.name);

      try {
        if (new URL(route.forwardTo).protocol !== "https:") errors.push(`${r}.forwardTo must be https`);
      } catch {
        errors.push(`${r}.forwardTo is not a valid URL`);
      }

      // A misspelled "shadow" must not silently act as enforce.
      if (route.mode !== undefined && route.mode !== "enforce" && route.mode !== "shadow") {
        errors.push(`${r}.mode must be "enforce" or "shadow"`);
      }
      if (route.respond !== undefined && route.respond !== "ack" && route.respond !== "proxy") {
        errors.push(`${r}.respond must be "ack" or "proxy"`);
      }
      if (route.enabled !== undefined && typeof route.enabled !== "boolean") errors.push(`${r}.enabled must be true or false`);

      if (route.on.type === "event" && route.on.events.length === 0) errors.push(`${r}.on.events is empty`);
      if (route.on.type === "command") {
        if (route.on.commands.length === 0) errors.push(`${r}.on.commands is empty`);
        for (const c of route.on.commands) if (!c.startsWith("/")) errors.push(`${r}: command ${c} must start with /`);
      }
      if (source !== "slack" && route.on.type !== "event") errors.push(`${r}.on.type must be "event" for ${source} apps`);
      if (source !== "slack" && route.filters) errors.push(`${r}.filters only apply to Slack apps; use match`);
      if (route.filters && route.on.type !== "event") errors.push(`${r}: filters only apply to event routes`);
      if (route.match) route.match.forEach((c, i) => errors.push(...checkCondition(`${r}.match[${i}]`, c, cfg.lists)));
      if (route.filters) errors.push(...checkFilters(r, route.filters, cfg.lists));
    }
  }
  return errors;
}

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

function checkVerify(at: string, v: WebhookVerify): string[] {
  switch (v.type) {
    case "hmac": {
      const errors: string[] = [];
      if (!HEADER_NAME.test(v.header)) errors.push(`${at}.header must be a header name`);
      if (v.encoding !== "hex" && v.encoding !== "base64") errors.push(`${at}.encoding must be "hex" or "base64"`);
      return errors;
    }
    case "header-token":
      return HEADER_NAME.test(v.header) ? [] : [`${at}.header must be a header name`];
    case "url-token":
      return /^[\w-]+$/.test(v.param) ? [] : [`${at}.param must be letters, digits, - or _`];
    default:
      return [`${at}.type must be "hmac", "header-token" or "url-token"`];
  }
}

const NEEDS_VALUE: Condition["op"][] = ["is", "isNot", "in", "notIn", "matches"];

function checkCondition(at: string, c: Condition, lists: Record<string, string[]>): string[] {
  const errors: string[] = [];
  if (!c.field?.trim()) errors.push(`${at}.field is empty`);
  if (!CONDITION_OPS.includes(c.op)) return [...errors, `${at}.op must be one of ${CONDITION_OPS.join(", ")}`];
  if (NEEDS_VALUE.includes(c.op) && (c.value === undefined || (typeof c.value === "string" && c.value === "" && c.op !== "is" && c.op !== "isNot"))) {
    errors.push(`${at}.value is required for ${c.op}`);
  }
  if ((c.op === "exists" || c.op === "missing") && c.value !== undefined) errors.push(`${at}.value is not used by ${c.op}`);
  if (c.op === "matches") {
    try {
      new RegExp(String(c.value ?? ""));
    } catch {
      errors.push(`${at}.value is not a valid regular expression`);
    }
  }
  if ((c.op === "in" || c.op === "notIn") && typeof c.value === "string") {
    if (!c.value.startsWith("@")) errors.push(`${at}.value must be a list: "@name" or an array`);
    else if (!Object.hasOwn(lists, c.value.slice(1))) errors.push(`${at}.value uses unknown list ${c.value}`);
  }
  return errors;
}

function checkFilters(at: string, f: EventFilters, lists: Record<string, string[]>): string[] {
  const errors: string[] = [];
  for (const key of LIST_FILTERS) {
    const ref: ListRef | undefined = f[key];
    if (typeof ref === "string" && !Object.hasOwn(lists, ref.slice(1))) {
      errors.push(`${at}.filters.${key} uses unknown list ${ref}`);
    }
  }
  if (f.textMatches !== undefined) {
    try {
      new RegExp(f.textMatches);
    } catch {
      errors.push(`${at}.filters.textMatches is not a valid regular expression`);
    }
  }
  return errors;
}
