/** A request from any source other than Slack, after its signature was checked. */

import type { SourceType } from "@gw/shared";

export interface SourceInbound {
  kind: "source";
  source: Exclude<SourceType, "slack">;
  /** The source's own "is this URL right?" call, e.g. GitHub's ping. Answered and recorded, never forwarded. */
  handshake?: boolean;
  /** Event name: GitHub event, Telegram update type, or the webhook's eventField. "" when unknown. */
  type: string;
  /** Where it happened, for stats and Activity: repository, chat ID. Never message text. */
  channel?: string;
  /** Delivery or update ID, for logs. */
  id?: string;
  /** The parsed body plus the source's extra fields. What Route.match conditions read. */
  data: Record<string, unknown>;
}

/** Request headers as a plain object with lowercase names, so conditions can read "headers.x-foo". */
export function headerObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => (out[name.toLowerCase()] = value));
  return out;
}

export function parseBody(contentType: string, body: string): Record<string, unknown> | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(body);
    // GitHub's form-encoded deliveries put the JSON in "payload".
    const payload = form.get("payload");
    if (payload !== null) return asRecord(safeJson(payload));
    return Object.fromEntries(form);
  }
  return asRecord(safeJson(body));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
