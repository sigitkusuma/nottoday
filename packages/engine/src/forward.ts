/** Sends the Slack request on to n8n, byte for byte, with Slack's signature headers. */

export interface ForwardRequest {
  url: string;
  body: string;
  contentType: string;
  slackSignature: string;
  slackTimestamp: string;
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

export async function forward(req: ForwardRequest): Promise<ForwardResult> {
  const headers = new Headers({
    "content-type": req.contentType,
    "x-slack-signature": req.slackSignature,
    "x-slack-request-timestamp": req.slackTimestamp,
    "x-slack-gateway-app": req.appName,
    "x-slack-gateway-route": req.routeName,
  });
  if (req.forwardSecret) headers.set("x-slack-gateway-secret", req.forwardSecret);

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
