/** Any webhook: checks the request the way the app is configured to, and reads the event name. */

import type { AppConfig, WebhookVerify } from "@gw/shared";
import { base64ToBytes, hexToBytes, tokensEqual, verifyHmacSha256 } from "./crypto";
import { headerObject, parseBody, type SourceInbound } from "./inbound";
import { lookup } from "./match";

export async function verifyWebhook(verify: WebhookVerify, secret: string, request: Request, body: string): Promise<boolean> {
  switch (verify.type) {
    case "hmac": {
      let sig = request.headers.get(verify.header);
      if (!sig) return false;
      if (verify.prefix) {
        if (!sig.startsWith(verify.prefix)) return false;
        sig = sig.slice(verify.prefix.length);
      }
      const bytes = verify.encoding === "hex" ? hexToBytes(sig.trim()) : base64ToBytes(sig);
      return bytes ? verifyHmacSha256(secret, bytes, body) : false;
    }
    case "header-token":
      return tokensEqual(request.headers.get(verify.header), secret);
    case "url-token":
      return tokensEqual(new URL(request.url).searchParams.get(verify.param), secret);
    default:
      return false;
  }
}

export function parseWebhookRequest(app: AppConfig, headers: Headers, body: string): SourceInbound {
  const json = parseBody(headers.get("content-type") ?? "application/json", body) ?? {};
  const data = { ...json, headers: headerObject(headers) };
  return { kind: "source", source: "webhook", type: eventName(app.eventField, data), data };
}

function eventName(field: string | undefined, data: Record<string, unknown>): string {
  if (!field) return "";
  const path = field.startsWith("header:") ? `headers.${field.slice(7).toLowerCase()}` : field;
  const first = lookup(data, path)[0];
  return typeof first === "string" || typeof first === "number" ? String(first) : "";
}
