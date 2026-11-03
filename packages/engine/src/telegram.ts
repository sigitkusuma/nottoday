/** Telegram bot webhooks: secret-token check and parsing. https://core.telegram.org/bots/api#update */

import { tokensEqual } from "./crypto";
import { headerObject, parseBody, type SourceInbound } from "./inbound";

/** setWebhook's secret_token comes back in this header on every update. */
export function verifyTelegramToken(secret: string, header: string | null): boolean {
  return tokensEqual(header, secret);
}

const MESSAGE_KEYS = ["message", "edited_message", "channel_post", "edited_channel_post", "business_message", "edited_business_message"];

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : undefined);

export function parseTelegramRequest(headers: Headers, body: string): SourceInbound {
  const json = parseBody(headers.get("content-type") ?? "application/json", body) ?? {};
  // An update has update_id plus exactly one field saying what happened.
  const type = Object.keys(json).find((k) => k !== "update_id" && rec(json[k])) ?? "";
  const inner = rec(json[type]);
  const callback = rec(json.callback_query);
  const msg = MESSAGE_KEYS.map((k) => rec(json[k])).find(Boolean) ?? rec(callback?.message);
  const chat = rec(msg?.chat) ?? rec(inner?.chat);
  const text = typeof msg?.text === "string" ? msg.text : typeof msg?.caption === "string" ? msg.caption : typeof callback?.data === "string" ? callback.data : undefined;
  // "/start@my_bot hello" → "/start".
  const command = text?.startsWith("/") ? text.split(/\s/)[0].split("@")[0] : undefined;
  return {
    kind: "source",
    source: "telegram",
    type,
    channel: chat?.id !== undefined ? String(chat.id) : undefined,
    id: json.update_id !== undefined ? String(json.update_id) : undefined,
    data: { ...json, headers: headerObject(headers), msg, chat, from: inner?.from ?? msg?.from, text, command },
  };
}
