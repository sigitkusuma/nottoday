/**
 * Config checks the type system can't express. The console runs them before
 * every save and the engine runs them on load, so a bad config never goes live.
 */

import type { EventFilters, GatewayConfig, ListRef } from "./types";

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
    if (app.source !== undefined && app.source !== "slack") errors.push(`${at}.source must be "slack"`);

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
      if (route.filters && route.on.type !== "event") errors.push(`${r}: filters only apply to event routes`);
      if (route.filters) errors.push(...checkFilters(r, route.filters, cfg.lists));
    }
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
