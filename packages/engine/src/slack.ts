/** Slack request verification and parsing. */

const MAX_AGE_SECONDS = 60 * 5;

/**
 * Checks X-Slack-Signature against the raw body, as Slack documents:
 * v0=hex(HMAC_SHA256(signingSecret, "v0:" + timestamp + ":" + body)).
 * crypto.subtle.verify compares in constant time.
 */
export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!timestamp || !signature?.startsWith("v0=")) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_AGE_SECONDS) return false;

  const sigBytes = hexToBytes(signature.slice(3));
  if (!sigBytes) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(`v0:${timestamp}:${body}`));
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  /** A channel ID for message events, an object for channel_* events. */
  channel?: string | { id?: string };
  channel_type?: string;
}

export interface InteractivityPayload {
  type?: string;
  callback_id?: string;
  actions?: { action_id?: string }[];
  view?: { callback_id?: string };
}

export type SlackInbound =
  | { kind: "url_verification"; challenge: string }
  | { kind: "event"; eventId?: string; event: SlackEvent }
  | { kind: "interactivity"; payload: InteractivityPayload }
  | { kind: "command"; command: string }
  | { kind: "unknown"; detail: string };

export function parseSlackRequest(contentType: string | null, body: string): SlackInbound {
  const ct = (contentType ?? "").toLowerCase();

  if (ct.includes("application/json")) {
    const json = safeJson(body);
    if (!isRecord(json)) return { kind: "unknown", detail: "invalid json" };
    if (json.type === "url_verification" && typeof json.challenge === "string") {
      return { kind: "url_verification", challenge: json.challenge };
    }
    if (json.type === "event_callback" && isSlackEvent(json.event)) {
      return {
        kind: "event",
        eventId: typeof json.event_id === "string" ? json.event_id : undefined,
        event: json.event,
      };
    }
    return { kind: "unknown", detail: `json type ${String(json.type)}` };
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(body);
    const payload = form.get("payload");
    if (payload !== null) {
      const json = safeJson(payload);
      if (!isRecord(json)) return { kind: "unknown", detail: "invalid interactivity payload" };
      return { kind: "interactivity", payload: json as InteractivityPayload };
    }
    const command = form.get("command");
    if (command !== null) return { kind: "command", command };
    return { kind: "unknown", detail: "form without payload or command" };
  }

  return { kind: "unknown", detail: `content-type ${ct || "missing"}` };
}

/** Channel ID for both message events (string) and channel_* events (object). */
export function channelId(event: SlackEvent): string | undefined {
  if (typeof event.channel === "string") return event.channel;
  return event.channel?.id;
}

/** User IDs mentioned as <@U123> or <@U123|name>, in order. */
export function mentionedUsers(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isSlackEvent(v: unknown): v is SlackEvent {
  return isRecord(v) && typeof v.type === "string";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
