/** Decides, per route, whether a Slack request is forwarded. Pure functions, no I/O. */

import { channelId, mentionedUsers, type SlackEvent, type SlackInbound } from "./slack";
import type { AppConfig, EventFilters, ListRef, Route, Trigger } from "@gw/shared";

export interface Decision {
  route: Route;
  forward: boolean;
  /** "none" when the route has no filters or the request is not an event. */
  filter: "pass" | "fail" | "none";
  /** Why the filters failed. */
  reason?: string;
}

/** Decisions for every enabled route whose trigger matches. Routes that don't match are left out. */
export function decide(app: AppConfig, inbound: SlackInbound, lists: Record<string, string[]>): Decision[] {
  const out: Decision[] = [];
  for (const route of app.routes) {
    if (route.enabled === false || !triggerMatches(route.on, inbound)) continue;

    if (inbound.kind !== "event" || !route.filters) {
      out.push({ route, forward: true, filter: "none" });
      continue;
    }

    const reason = failedFilter(route.filters, inbound.event, lists);
    const shadow = route.mode === "shadow";
    out.push(
      reason === undefined
        ? { route, forward: true, filter: "pass" }
        : { route, forward: shadow, filter: "fail", reason },
    );
  }
  return out;
}

export function triggerMatches(on: Trigger, inbound: SlackInbound): boolean {
  switch (on.type) {
    case "event":
      return inbound.kind === "event" && (on.events.includes("*") || on.events.includes(inbound.event.type));
    case "command":
      return inbound.kind === "command" && on.commands.includes(inbound.command);
    case "interactivity": {
      if (inbound.kind !== "interactivity") return false;
      const p = inbound.payload;
      if (on.payloadTypes && !on.payloadTypes.includes(p.type ?? "")) return false;
      if (on.actionIds && !(p.actions ?? []).some((a) => on.actionIds!.includes(a.action_id ?? ""))) return false;
      if (on.callbackIds && !on.callbackIds.includes(p.view?.callback_id ?? p.callback_id ?? "")) return false;
      return true;
    }
  }
}

/** Returns the name of the first failing filter, or undefined when all pass. */
export function failedFilter(f: EventFilters, event: SlackEvent, lists: Record<string, string[]>): string | undefined {
  const list = (ref: ListRef) => resolveList(ref, lists);
  const channel = channelId(event) ?? "";
  const user = event.user ?? "";

  if (f.subtypes && !f.subtypes.includes(event.subtype ?? "")) return "subtypes";
  if (f.ignoreBots && event.bot_id) return "ignoreBots";
  if (f.channelTypes && !f.channelTypes.includes(event.channel_type ?? "")) return "channelTypes";
  if (f.channels && !list(f.channels).includes(channel)) return "channels";
  if (f.excludeChannels && list(f.excludeChannels).includes(channel)) return "excludeChannels";
  if (f.users && !list(f.users).includes(user)) return "users";
  if (f.excludeUsers && list(f.excludeUsers).includes(user)) return "excludeUsers";

  if (f.requireMention || f.mentionIn) {
    let mentions = mentionedUsers(event.text);
    if (f.ignoreSelfMention) mentions = mentions.filter((m) => m !== user);
    if (mentions.length === 0) return "requireMention";
    if (f.mentionIn) {
      const allowed = list(f.mentionIn);
      if (!mentions.some((m) => allowed.includes(m))) return "mentionIn";
    }
  }

  if (f.textMatches && !new RegExp(f.textMatches).test(event.text ?? "")) return "textMatches";
  return undefined;
}

export function resolveList(ref: ListRef, lists: Record<string, string[]>): string[] {
  if (Array.isArray(ref)) return ref;
  const values = lists[ref.slice(1)];
  if (!values) throw new Error(`Unknown list ${ref}`);
  return values;
}
