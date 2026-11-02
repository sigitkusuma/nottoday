/** Calls the local console API with the session token from the link the CLI opened. */

const TOKEN_KEY = "gw-session";

function sessionToken(): string {
  const fromHash = /(?:^#|&)t=([^&]+)/.exec(location.hash)?.[1];
  if (fromHash) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromHash);
    } catch {
      // Storage unavailable: keep the token in the URL instead.
      return fromHash;
    }
    history.replaceState(null, "", location.pathname + location.search);
    return fromHash;
  }
  try {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // Fall through.
  }
  return import.meta.env.DEV ? "dev" : "";
}

const token = sessionToken();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "x-session-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the console. Is `nottoday` still running in your terminal?", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (HTTP ${res.status})`, res.status, data.errors);
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads a Server-Sent Events stream from the console API. EventSource can't send
 * the session header, so this uses fetch and parses the stream itself.
 */
export async function openStream(path: string, onEvent: (event: string, data: string) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api${path}`, { headers: { "x-session-token": token, accept: "text/event-stream" }, signal });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `Stream failed (HTTP ${res.status})`, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, data.join("\n"));
    }
  }
}
