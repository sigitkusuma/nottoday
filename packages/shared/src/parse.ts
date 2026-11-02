/**
 * Turns the stored JSON into a GatewayConfig. The JSON comes from KV, where it
 * can be edited by hand, so its shape is checked before validateConfig(), which
 * assumes the types are right.
 */

import type { GatewayConfig } from "./types";
import { validateConfig } from "./validate";

export type ParseResult = { ok: true; config: GatewayConfig } | { ok: false; errors: string[] };

export function parseConfig(json: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["config is not valid JSON"] };
  }
  const errors = shapeErrors(data);
  if (errors.length > 0) return { ok: false, errors };
  const config = data as GatewayConfig;
  const invalid = validateConfig(config);
  return invalid.length > 0 ? { ok: false, errors: invalid } : { ok: true, config };
}

const TRIGGER_TYPES = ["event", "interactivity", "command"];
const STRING_ARRAY_FIELDS: Record<string, string[]> = {
  event: ["events"],
  interactivity: ["payloadTypes", "actionIds", "callbackIds"],
  command: ["commands"],
};

function shapeErrors(data: unknown): string[] {
  if (!isObject(data)) return ["config must be an object"];
  const errors: string[] = [];

  if (!isObject(data.lists)) errors.push("lists must be an object");
  else {
    for (const [name, values] of Object.entries(data.lists)) {
      if (!isStringArray(values)) errors.push(`lists.${name} must be an array of strings`);
    }
  }

  if (data.listSources !== undefined) {
    if (!isObject(data.listSources)) errors.push("listSources must be an object");
    else {
      for (const [name, src] of Object.entries(data.listSources)) {
        const ok = isObject(src) && src.type === "n8n-data-table" && typeof src.tableId === "string" && typeof src.column === "string";
        if (!ok) errors.push(`listSources.${name} must be { type: "n8n-data-table", tableId, tableName, column }`);
      }
    }
  }

  if (!isObject(data.apps)) return [...errors, "apps must be an object"];
  for (const [appName, app] of Object.entries(data.apps)) {
    const at = `apps.${appName}`;
    if (!isObject(app)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (typeof app.signingSecret !== "string") errors.push(`${at}.signingSecret must be a string`);
    if (!Array.isArray(app.routes)) {
      errors.push(`${at}.routes must be an array`);
      continue;
    }
    app.routes.forEach((route: unknown, i) => {
      const r = `${at}.routes[${i}]`;
      if (!isObject(route)) return void errors.push(`${r} must be an object`);
      if (typeof route.name !== "string") errors.push(`${r}.name must be a string`);
      if (typeof route.forwardTo !== "string") errors.push(`${r}.forwardTo must be a string`);
      if (route.filters !== undefined) errors.push(...filterShapeErrors(`${r}.filters`, route.filters));
      const on = route.on;
      if (!isObject(on) || typeof on.type !== "string" || !TRIGGER_TYPES.includes(on.type)) {
        return void errors.push(`${r}.on.type must be one of ${TRIGGER_TYPES.join(", ")}`);
      }
      for (const field of STRING_ARRAY_FIELDS[on.type]) {
        const required = on.type !== "interactivity";
        if ((required || on[field] !== undefined) && !isStringArray(on[field])) {
          errors.push(`${r}.on.${field} must be an array of strings`);
        }
      }
    });
  }
  return errors;
}

const LIST_FILTERS = ["channels", "excludeChannels", "users", "excludeUsers", "mentionIn"];
const BOOLEAN_FILTERS = ["ignoreBots", "requireMention", "ignoreSelfMention"];
const STRING_ARRAY_FILTERS = ["subtypes", "channelTypes"];

function filterShapeErrors(at: string, filters: unknown): string[] {
  if (!isObject(filters)) return [`${at} must be an object`];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (LIST_FILTERS.includes(key)) {
      const ok = isStringArray(value) || (typeof value === "string" && value.startsWith("@"));
      if (!ok) errors.push(`${at}.${key} must be an array of strings or "@listName"`);
    } else if (BOOLEAN_FILTERS.includes(key)) {
      if (typeof value !== "boolean") errors.push(`${at}.${key} must be true or false`);
    } else if (STRING_ARRAY_FILTERS.includes(key)) {
      if (!isStringArray(value)) errors.push(`${at}.${key} must be an array of strings`);
    } else if (key === "textMatches") {
      if (typeof value !== "string") errors.push(`${at}.textMatches must be a string`);
    } else {
      errors.push(`${at}.${key} is not a known filter`);
    }
  }
  return errors;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
