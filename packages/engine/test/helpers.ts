export const SECRET = "test-signing-secret";

export async function sign(body: string, timestamp: number, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${body}`));
  return "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function slackRequest(
  path: string,
  body: string,
  opts: { contentType?: string; headers?: Record<string, string>; secret?: string; timestamp?: number } = {},
): Promise<Request> {
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return new Request(`https://gateway.test${path}`, {
    method: "POST",
    headers: {
      "content-type": opts.contentType ?? "application/json",
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": await sign(body, ts, opts.secret),
      ...opts.headers,
    },
    body,
  });
}

export function eventBody(event: Record<string, unknown>): string {
  return JSON.stringify({ type: "event_callback", event_id: "Ev1", event });
}

export function testCtx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  } as Partial<ExecutionContext> as ExecutionContext;
  return { ctx, settle: async () => void (await Promise.all(pending)) };
}
