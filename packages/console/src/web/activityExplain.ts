/**
 * What happened to one request, in words, and what to do about it. Pure, for the
 * details that open under a row in Activity. Message text is never recorded, so
 * none of this can show it.
 */

import { statusHint } from "./botHealth";
import { reasonText } from "./routeSummary";
import { sourceInfo } from "./sources";
import type { SourceType } from "@gw/shared";
import type { LiveDecision, LiveEvent } from "./useLive";

export interface Explanation {
  headline: string;
  /** One or more sentences, one per entry. */
  why: string[];
  /** A place to go to act on it. */
  action?: { label: string; path: string };
}

const sourceOfEvent = (e: LiveEvent): SourceType => (e.source === "github" || e.source === "telegram" || e.source === "webhook" ? e.source : "slack");

/** The engine counts a forward as failed unless n8n answered with a status below 400. */
export const forwardFailed = (r: LiveDecision) => r.forwarded && !(r.status && r.status < 400);

/** "Sent to n8n (HTTP 200)", "Dropped before n8n", "n8n didn't accept it (HTTP 502) after 3 tries"… */
export function routeResult(r: LiveDecision): string {
  if (!r.forwarded) return "Dropped, never sent to n8n";
  if (forwardFailed(r)) {
    const tries = r.attempts && r.attempts > 1 ? ` after ${r.attempts} tries` : "";
    return `n8n didn't accept it (${r.status ? `HTTP ${r.status}` : "no answer"})${tries}`;
  }
  const sent = `Sent to n8n (HTTP ${r.status})`;
  return r.mode === "shadow" && r.filter === "fail" ? `${sent}, because the route is in shadow mode` : sent;
}

export function explainEvent(e: LiveEvent, ctx: { appHasRoutes: boolean }): Explanation {
  const info = sourceInfo(sourceOfEvent(e));
  const open = e.app ? { label: `Open ${e.app}`, path: `apps/${e.app}` } : undefined;
  switch (e.kind) {
    case "verified":
      return {
        headline: `${info.sender} checked the address`,
        why: [`${info.sender} sends this when the address is saved or retried. The gateway answered it correctly, so the address and the secret work.`],
      };
    case "bad_signature":
      return {
        headline: "Rejected: the signature didn't match",
        why: [
          `The request said it came from ${info.sender}, but its signature doesn't match the secret stored for this app. Either the secret is wrong, or the request didn't come from ${info.sender}. Nothing was forwarded.`,
          sourceOfEvent(e) === "slack" ? "If it keeps happening for real messages, copy the Signing Secret again and use “Replace signing secret”." : "If it keeps happening for real requests, replace the secret.",
        ],
        action: open && { ...open, label: `Open ${e.app} to replace the secret` },
      };
    case "unknown_app":
      return { headline: "Rejected: no app has this name", why: [`The address ended in "${e.app}", and the gateway has no app with that name. Check the address in the sender's settings.`], action: { label: "Open Apps", path: "apps" } };
    case "missing_secret":
      return { headline: "Rejected: no secret stored", why: ["The gateway has no secret for this app, so it can't check the signature and refuses the request."], action: open && { ...open, label: `Open ${e.app} to add the secret` } };
    case "error":
      return { headline: "Gateway error", why: [e.message ?? "The gateway reported an error."] };
  }

  const type = e.type ?? "event";
  const routes = e.routes ?? [];

  if (routes.length === 0) {
    return {
      headline: `Not routed: no route lists ${type}`,
      why: [
        ctx.appHasRoutes
          ? `Nothing was sent to n8n. None of this app's routes lists "${type}" among its event types, so the gateway dropped it, even in shadow mode.`
          : "Nothing was sent to n8n. This app has no routes yet, so everything it receives is dropped.",
        ctx.appHasRoutes
          ? `If a workflow should get these, add "${type}" to a route's event types. If none should, you can stop ${info.sender} sending them: remove the matching event under its Event Subscriptions.`
          : "Add a route to choose what reaches your workflow.",
      ],
      action: open && { ...open, label: ctx.appHasRoutes ? `Open ${e.app}'s routes` : "Add a route" },
    };
  }

  const failed = routes.filter(forwardFailed);
  if (failed.length > 0) {
    const first = failed[0];
    const hint = first.status ? statusHint(first.status) : "n8n didn't answer, or the connection failed. Check that n8n is up and the workflow is active.";
    return {
      headline: "Forwarded, but n8n didn't accept it",
      why: [`${failed.map((r) => `${r.route}: ${r.status ? `HTTP ${r.status}` : "no answer"}`).join("; ")}. The workflow didn't run for it.`, ...(hint ? [hint] : []), ...(first.error ? [`Error: ${first.error}`] : [])],
      action: open,
    };
  }

  const shadow = routes.filter((r) => r.forwarded && r.filter === "fail");
  if (shadow.length > 0) {
    return {
      headline: "Forwarded in shadow mode: it would be dropped",
      why: [
        `${shadow.map((r) => `${r.route}: ${reasonText(r.reason, sourceOfEvent(e)) || "a filter would drop it"}`).join("; ")}. The route is in shadow mode, so it was sent to n8n anyway.`,
        "When these are the ones you want dropped, switch the route to enforce and n8n stops getting them.",
      ],
      action: open,
    };
  }

  const sent = routes.filter((r) => r.forwarded);
  if (sent.length > 0) {
    return { headline: "Sent to n8n", why: [`${sent.map((r) => r.route).join(", ")} passed the filters, and n8n accepted it.`] };
  }
  return {
    headline: "Dropped: one n8n execution saved",
    why: [`${routes.map((r) => `${r.route}: ${reasonText(r.reason, sourceOfEvent(e)) || "a filter dropped it"}`).join("; ")}.`, "It never reached n8n, so it didn't count as an execution."],
  };
}

/** One line per request, for Activity rows and an app's latest events. */
export function describe(e: LiveEvent): string {
  switch (e.kind) {
    case "verified":
      return e.source === "github" ? "GitHub sent its ping: verified." : "Slack checked the Request URL: verified.";
    case "bad_signature":
      return e.source && e.source !== "slack" ? "Rejected: bad signature (wrong secret?)." : "Rejected: bad signature (wrong signing secret?).";
    case "unknown_app":
      return `Rejected: unknown app name "${e.app}".`;
    case "missing_secret":
      return "Rejected: no signing secret stored for this app.";
    case "error":
      return `Gateway error: ${e.message}`;
    case "event": {
      const what = [e.type, e.subtype].filter(Boolean).join(" / ") || "event";
      const routes = e.routes ?? [];
      if (routes.length === 0) return `${what}: no route lists this event, so it was dropped.`;
      const because = (reason?: string) => {
        const why = reasonText(reason, sourceOfEvent(e));
        return why ? ` because ${why}` : "";
      };
      return `${what}: ${routes
        .map((r) =>
          r.forwarded
            ? r.filter === "fail"
              ? `${r.route} would drop it${because(r.reason)} (shadow mode: forwarded)`
              : `${r.route} forwarded${r.status ? ` (n8n ${r.status})` : ""}`
            : `${r.route} dropped it${because(r.reason)}`,
        )
        .join("; ")}.`;
    }
  }
}
