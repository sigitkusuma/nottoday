/** GitHub webhooks: signature check and parsing. https://docs.github.com/en/webhooks */

import { hexToBytes, verifyHmacSha256 } from "./crypto";
import { headerObject, parseBody, type SourceInbound } from "./inbound";

/** X-Hub-Signature-256 is "sha256=" + hex HMAC-SHA256 of the raw body under the webhook secret. */
export async function verifyGithubSignature(secret: string, signature: string | null, body: string): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const bytes = hexToBytes(signature.slice(7));
  return bytes ? verifyHmacSha256(secret, bytes, body) : false;
}

export function parseGithubRequest(headers: Headers, body: string): SourceInbound {
  const type = headers.get("x-github-event") ?? "";
  const json = parseBody(headers.get("content-type") ?? "application/json", body) ?? {};
  const ref = typeof json.ref === "string" ? json.ref : "";
  const repo = json.repository as { full_name?: string } | undefined;
  const org = json.organization as { login?: string } | undefined;
  return {
    kind: "source",
    source: "github",
    handshake: type === "ping",
    type,
    channel: repo?.full_name ?? org?.login,
    id: headers.get("x-github-delivery") ?? undefined,
    data: {
      ...json,
      headers: headerObject(headers),
      event: type,
      // "refs/heads/main" → "main", "refs/tags/v1" → tag "v1".
      branch: ref.startsWith("refs/heads/") ? ref.slice(11) : undefined,
      tag: ref.startsWith("refs/tags/") ? ref.slice(10) : undefined,
    },
  };
}
