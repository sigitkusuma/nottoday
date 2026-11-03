/** Sends the request on to n8n, byte for byte, with the sender's own headers (Slack's signature, GitHub's event name, …). */

export interface ForwardRequest {
  url: string;
  body: string;
  contentType: string;
  /** Slack: only these two of Slack's headers are passed on, as before other sources existed. */
  slackSignature?: string;
  slackTimestamp?: string;
  /** Other sources: the original request headers, passed on minus the ones that describe the hop to the gateway. */
  passthrough?: Headers;
  appName: string;
  routeName: string;
  /** Optional shared secret for n8n Webhook nodes using Header Auth. */
  forwardSecret?: string;
  /** Abort after this many ms (used by proxy routes). */
  timeoutMs?: number;
  /** Extra attempts after a failure that happened before n8n ran the workflow. */
  retries?: number;
}

export interface ForwardResult {
  ok: boolean;
  status: number;
  attempts: number;
  response?: Response;
  error?: string;
}

// Only retry when n8n most likely never started the workflow, so a retry
// can't run it twice (and burn a second execution).
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const BACKOFF_MS = [500, 1500];

// Headers about the connection to the gateway, not about the request: never passed on.
const HOP_HEADERS = /^(host|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|accept-encoding|x-real-ip|true-client-ip|cdn-loop|cf-.*|x-forwarded-.*)$/i;

export function forwardHeaders(req: Pick<ForwardRequest, "contentType" | "slackSignature" | "slackTimestamp" | "passthrough" | "appName" | "routeName" | "forwardSecret">): Headers {
  const headers = new Headers();
  if (req.passthrough) {
    req.passthrough.forEach((value, name) => {
      if (!HOP_HEADERS.test(name)) headers.set(name, value);
    });
  } else {
    headers.set("x-slack-signature", req.slackSignature ?? "");
    headers.set("x-slack-request-timestamp", req.slackTimestamp ?? "");
    // Kept for workflows that check them; new installs can use the x-nottoday-* names.
    headers.set("x-slack-gateway-app", req.appName);
    headers.set("x-slack-gateway-route", req.routeName);
    if (req.forwardSecret) headers.set("x-slack-gateway-secret", req.forwardSecret);
  }
  headers.set("content-type", req.contentType);
  headers.set("x-nottoday-app", req.appName);
  headers.set("x-nottoday-route", req.routeName);
  if (req.forwardSecret) headers.set("x-nottoday-secret", req.forwardSecret);
  return headers;
}

export async function forward(req: ForwardRequest): Promise<ForwardResult> {
  const headers = forwardHeaders(req);

  const maxAttempts = 1 + (req.retries ?? 0);
  let last: ForwardResult = { ok: false, status: 0, attempts: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(req.url, {
        method: "POST",
        headers,
        body: req.body,
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      });
      last = { ok: response.ok, status: response.status, attempts: attempt, response };
      if (!RETRYABLE_STATUS.has(response.status)) return last;
    } catch (err) {
      last = { ok: false, status: 0, attempts: attempt, error: err instanceof Error ? err.message : String(err) };
      // A timed-out proxy call is not retried: Slack has already given up on it.
      if (req.timeoutMs) return last;
    }
    if (attempt < maxAttempts) await sleep(BACKOFF_MS.at(attempt - 1) ?? 1500);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
