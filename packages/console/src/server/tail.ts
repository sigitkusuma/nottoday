/**
 * Real-time view of the gateway's decisions, for the live check and the Live
 * tab. Analytics Engine lags 1–2 minutes; a tail session shows each request
 * within a second. One tail is kept open while anyone is watching and closed
 * when the last viewer leaves. The tail URL never leaves this process.
 */

export type LiveKind = "verified" | "bad_signature" | "unknown_app" | "missing_secret" | "event" | "error";

export interface LiveDecision {
  route: string;
  mode: string;
  filter: string;
  reason?: string;
  forwarded: boolean;
  status?: number;
}

export interface LiveEvent {
  /** ISO time the Worker handled the request. */
  time: string;
  kind: LiveKind;
  app?: string;
  /** slack, github, telegram or webhook. Absent on lines from engines before 0.3.0, which are all Slack. */
  source?: string;
  type?: string;
  subtype?: string;
  channel?: string;
  retry?: string;
  routes?: LiveDecision[];
  message?: string;
}

export interface LiveStatus {
  state: "connecting" | "live" | "unavailable";
  message?: string;
}

interface TailMessage {
  eventTimestamp?: number;
  outcome?: string;
  logs?: { message?: unknown[] }[];
  exceptions?: { name?: string; message?: string }[];
}

/** Turns one tail message into the events the console shows. Pure, so it's easy to test. */
export function parseTailMessage(text: string): LiveEvent[] {
  let msg: TailMessage;
  try {
    msg = JSON.parse(text) as TailMessage;
  } catch {
    return [];
  }
  const time = new Date(msg.eventTimestamp ?? Date.now()).toISOString();
  const out: LiveEvent[] = [];
  for (const log of msg.logs ?? []) {
    for (const part of log.message ?? []) {
      if (typeof part !== "string" || !part.startsWith("{")) continue;
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(part) as Record<string, unknown>;
      } catch {
        continue;
      }
      const app = typeof line.app === "string" ? line.app : undefined;
      const source = str(line.source);
      switch (line.message) {
        case "url_verification":
          out.push({ time, kind: "verified", app, source });
          break;
        case "bad slack signature":
        case "bad signature":
          out.push({ time, kind: "bad_signature", app, source });
          break;
        case "unknown app":
          out.push({ time, kind: "unknown_app", app });
          break;
        case "missing signing secret":
          out.push({ time, kind: "missing_secret", app });
          break;
        case "slack_request":
        case "request":
          out.push({
            time,
            kind: "event",
            app,
            source,
            type: str(line.type),
            subtype: str(line.subtype),
            channel: str(line.channel),
            retry: str(line.retry),
            routes: Array.isArray(line.routes) ? (line.routes as LiveDecision[]) : [],
            message: line.outcome === "duplicate retry skipped" ? "Skipped as a duplicate retry (older engine)." : undefined,
          });
          break;
      }
    }
  }
  for (const e of msg.exceptions ?? []) out.push({ time, kind: "error", message: `${e.name ?? "Error"}: ${e.message ?? ""}` });
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export interface TailSessions {
  open(): Promise<{ id: string; url: string; expiresAt: string }>;
  close(id: string): Promise<void>;
}

type Listener = { onEvent: (e: LiveEvent) => void; onStatus: (s: LiveStatus) => void };

/** Renew the session this long before Cloudflare stops delivering on it. */
const RENEW_BEFORE_MS = 60_000;

export class TailHub {
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private status: LiveStatus = { state: "connecting" };
  private generation = 0;

  constructor(
    private readonly sessions: TailSessions,
    private readonly WebSocketImpl: typeof WebSocket = globalThis.WebSocket,
  ) {}

  /** Starts the tail on the first subscriber; returns an unsubscribe function. */
  subscribe(onEvent: Listener["onEvent"], onStatus: Listener["onStatus"]): () => void {
    const listener = { onEvent, onStatus };
    this.listeners.add(listener);
    onStatus(this.status);
    if (this.listeners.size === 1) void this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) void this.stop();
    };
  }

  private setStatus(status: LiveStatus) {
    this.status = status;
    for (const l of this.listeners) l.onStatus(status);
  }

  private async connect(): Promise<void> {
    const gen = ++this.generation;
    this.setStatus({ state: "connecting" });
    if (!this.WebSocketImpl) {
      this.setStatus({ state: "unavailable", message: "This Node.js version has no WebSocket client. Use Node.js 22.4 or later for real-time checks." });
      return;
    }
    let session: { id: string; url: string; expiresAt: string };
    try {
      session = await this.sessions.open();
    } catch (err) {
      this.setStatus({ state: "unavailable", message: `Real-time logs aren't available: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (gen !== this.generation || this.listeners.size === 0) {
      void this.sessions.close(session.id).catch(() => {});
      return;
    }
    this.sessionId = session.id;

    const ws = new this.WebSocketImpl(session.url, "trace-v1");
    ws.binaryType = "arraybuffer";
    this.socket = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ debug: false }));
      this.setStatus({ state: "live" });
    });
    ws.addEventListener("message", (m) => {
      const text = typeof m.data === "string" ? m.data : new TextDecoder().decode(m.data as ArrayBuffer);
      for (const e of parseTailMessage(text)) for (const l of this.listeners) l.onEvent(e);
    });
    ws.addEventListener("close", () => {
      // Reconnect if it dropped while people are still watching.
      if (gen === this.generation && this.listeners.size > 0) setTimeout(() => void this.reconnect(gen), 2_000);
    });

    // Cloudflare silently stops delivering at expires_at, so start a new session before then.
    const renewIn = Math.max(30_000, Date.parse(session.expiresAt) - Date.now() - RENEW_BEFORE_MS);
    this.renewTimer = setTimeout(() => void this.reconnect(gen), renewIn);
  }

  private async reconnect(gen: number) {
    if (gen !== this.generation || this.listeners.size === 0) return;
    await this.teardown();
    await this.connect();
  }

  private async stop() {
    this.generation++;
    await this.teardown();
    this.status = { state: "connecting" };
  }

  private async teardown() {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    const socket = this.socket;
    const id = this.sessionId;
    this.socket = null;
    this.sessionId = null;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    if (id) await this.sessions.close(id).catch(() => {});
  }
}
