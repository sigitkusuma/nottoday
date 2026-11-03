/** Conditions on fields of a request (Route.match). Pure functions, no I/O. */

import type { Condition, ListRef } from "@gw/shared";

/**
 * Every value at a dot path. Arrays along the way fan out, so
 * "pull_request.labels.name" gives every label's name. Missing parts, null and
 * undefined give nothing.
 */
export function lookup(data: unknown, path: string): unknown[] {
  let current: unknown[] = [data];
  for (const part of path.split(".").filter(Boolean)) {
    const next: unknown[] = [];
    for (const value of current) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "object" && item !== null && Object.hasOwn(item, part)) next.push((item as Record<string, unknown>)[part]);
      }
    }
    current = next;
  }
  return current.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== null && v !== undefined);
}

const asText = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined);

/** Returns "match:<field>" for the first condition that fails, or undefined when all pass. */
export function failedCondition(conditions: Condition[], data: unknown, lists: Record<string, string[]>): string | undefined {
  for (const c of conditions) {
    if (!passes(c, data, lists)) return `match:${c.field}`;
  }
  return undefined;
}

function passes(c: Condition, data: unknown, lists: Record<string, string[]>): boolean {
  const found = lookup(data, c.field);
  const texts = found.map(asText).filter((t): t is string => t !== undefined);
  switch (c.op) {
    case "exists":
      return found.length > 0;
    case "missing":
      return found.length === 0;
    case "is":
      return texts.includes(String(c.value ?? ""));
    case "isNot":
      return !texts.includes(String(c.value ?? ""));
    case "in": {
      const allowed = values(c.value, lists);
      return texts.some((t) => allowed.includes(t));
    }
    case "notIn": {
      const blocked = values(c.value, lists);
      return !texts.some((t) => blocked.includes(t));
    }
    case "matches": {
      const re = new RegExp(String(c.value ?? ""));
      return texts.some((t) => re.test(t));
    }
  }
}

function values(ref: Condition["value"], lists: Record<string, string[]>): string[] {
  if (ref === undefined) return [];
  if (Array.isArray(ref)) return ref;
  if (ref.startsWith("@")) {
    const list = lists[ref.slice(1)];
    if (!list) throw new Error(`Unknown list ${ref as ListRef}`);
    return list;
  }
  return [ref];
}
