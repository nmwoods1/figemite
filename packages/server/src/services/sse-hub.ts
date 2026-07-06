// ── SseHub ───────────────────────────────────────────────────────────────────
//
// Manages Server-Sent-Events subscribers per board/sub-board key. Ported from
// the figmalade prototype's `sseSubscribers` map + `broadcast()` helper
// embedded in the dev-server Vite plugin (vite.config.ts ~356-367, ~640-668)
// into a standalone, transport-testable service: it depends only on a small
// `write(chunk): void` + optional `on('close', ...)` shape (satisfied by
// Node's `http.ServerResponse`, and easy to fake in tests), never on
// `http`/HTTP routing directly. The API layer (P1-T12) is what actually
// creates `http.ServerResponse`s and calls `subscribe`/`broadcast`.
//
// Deviations from the legacy prototype:
//   - `subscribe()` now sends an initial `sync` event carrying the caller-
//     supplied current AiSessionState (`{ locked, epoch }`) instead of a bare
//     `:\n\n` comment. This lets a client — especially one reconnecting after
//     a dropped SSE connection — become consistent immediately with no extra
//     round-trip, addressing the epoch-reconciliation need called out in the
//     `/api/ai/status` fix in the phase plan. The legacy code separately sent
//     an ad hoc `event: locked` only if locked; `sync` generalises that to
//     always carry full state (locked or not) plus the epoch.
//   - Heartbeat is now a first-class, testable interval owned by the hub
//     (`start()`/`dispose()`), rather than a one-shot `:\n\n` written only at
//     connection time. Legacy never re-sent it periodically, so long-lived
//     idle connections could be silently dropped by proxies; this rewrite
//     sends `: ping\n\n` on a configurable interval (default 15s) to every
//     subscriber, keeping connections alive and surfacing dead ones (a dead
//     res's write throws and is now handled the same way broadcast handles
//     it — see `writeToSubscriber` below).

import { sessionKey } from './session-key.js';

/** The minimal shape SseHub needs from a subscriber's response object. */
export interface SseSubscriberResponse {
  write(chunk: string): void;
  /** Optional: if present, SseHub wires 'close' to auto-unsubscribe. */
  on?(event: 'close', handler: () => void): void;
}

export interface SseHubOptions {
  /** Heartbeat interval in ms. Defaults to 15 seconds. */
  heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseHub {
  private readonly heartbeatMs: number;
  private readonly subscribers = new Map<string, Set<SseSubscriberResponse>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SseHubOptions) {
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  /**
   * Registers `res` as a subscriber for `slug`/`subPath`, immediately sending
   * an initial `sync` event with `initialState`. Returns an unsubscribe
   * function; also wires `res.on('close', unsubscribe)` when available so a
   * dropped connection cleans itself up without the caller having to do so.
   */
  subscribe(
    slug: string,
    subPath: string[],
    res: SseSubscriberResponse,
    initialState: unknown,
  ): () => void {
    const key = sessionKey(slug, subPath);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(res);

    const unsubscribe = (): void => {
      const current = this.subscribers.get(key);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) this.subscribers.delete(key);
    };

    res.on?.('close', unsubscribe);

    this.writeToSubscriber(key, res, sseFrame('sync', initialState));

    return unsubscribe;
  }

  /** Writes a `event: <name>\ndata: <json>\n\n` frame to every subscriber on the key. */
  broadcast(slug: string, subPath: string[], event: string, data: unknown): void {
    const key = sessionKey(slug, subPath);
    const set = this.subscribers.get(key);
    if (!set || set.size === 0) return;
    const payload = sseFrame(event, data);
    for (const res of [...set]) {
      this.writeToSubscriber(key, res, payload);
    }
  }

  /** Writes `chunk` to `res`, evicting it from `key`'s subscriber set if the write throws. */
  private writeToSubscriber(key: string, res: SseSubscriberResponse, chunk: string): void {
    try {
      res.write(chunk);
    } catch {
      this.subscribers.get(key)?.delete(res);
    }
  }

  /** Starts the periodic `: ping\n\n` heartbeat to all subscribers. Idempotent. */
  start(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const [key, set] of this.subscribers) {
        for (const res of [...set]) {
          this.writeToSubscriber(key, res, ': ping\n\n');
        }
      }
    }, this.heartbeatMs);
  }

  /** Stops the heartbeat interval and forgets all subscribers. */
  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.subscribers.clear();
  }
}
