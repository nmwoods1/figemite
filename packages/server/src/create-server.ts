// ── createServer — service composition (P1-T13) ─────────────────────────────
//
// Instantiates and wires every `@easel/server` service into a single runnable
// unit: a plain `(req, res)` request handler plus an `attachUpgrade(httpServer)`
// hook for the Yjs relay, and a `dispose()` that tears everything down cleanly
// (no open timers/handles keep the process alive after this returns).
//
// This module owns NO `http.Server` itself — it is deliberately transport-
// agnostic at the top level, matching `createRequestHandler`'s existing
// contract, so it can be mounted by `startServer` (a real `http.Server`) or,
// later, by the Phase-2 Vite dev-server middleware chain, exactly like
// `createRequestHandler` already documents itself as being mountable by both.
//
// Wiring mirrors `api/test-server.ts`'s harness (which composition now
// supersedes for production use — the test harness predates this module and
// was written as "assemble a full ctx exactly as composition will"):
//   - `ai.onChange` -> `makeAiBroadcast(sse, repo)`, the SINGLE broadcaster of
//     `locked`/`unlocked` frames (begin, end, and the auto-end timer all flow
//     through this one bridge — see api/ai-broadcast.ts's module doc).
//   - `watcher.onExternalChange` -> reads the fresh board (if it still exists)
//     and broadcasts `external-change` over SSE.
//   - `mdns.getBoards` -> `repo.listSlugs()`, so the TXT record reflects
//     whatever boards exist at the moment `start()` publishes.

import type http from 'node:http';
import { BoardRepository } from './repository/board-repo.js';
import { SnapshotHistoryService } from './services/snapshot-history.js';
import { AiSessionManager } from './services/ai-session.js';
import { SseHub } from './services/sse-hub.js';
import { FileWatcher } from './services/file-watcher.js';
import { YjsWebsocketService } from './services/yjs-ws.js';
import { MdnsService } from './services/mdns.js';
import type { ServerConfig } from './config.js';
import { createRequestHandler, type RequestContext } from './api/router.js';
import { makeAiBroadcast } from './api/ai-broadcast.js';

export interface ServerHandle {
  /** The composed `(req, res)` handler — mount on any `http.Server`. */
  requestHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /** Registers the Yjs `/yjs/*` websocket upgrade handler on `httpServer`. */
  attachUpgrade(httpServer: http.Server): void;
  /** Tears down every service: watcher, SSE heartbeat, Yjs sockets, mDNS, AI timers. */
  dispose(): void;
}

/**
 * Builds and wires every service from `config`, returning a `ServerHandle`.
 * Starts the SSE heartbeat, the file watcher, and (if `config.mdns` is true)
 * the mDNS advertisement immediately — this function returns a live,
 * request-ready composition, not a lazy builder.
 */
export function createServer(config: ServerConfig): ServerHandle {
  const repo = new BoardRepository(config.boardsRoot);
  const history = new SnapshotHistoryService(config.boardsRoot);

  const sse = new SseHub({ heartbeatMs: config.heartbeatMs });
  sse.start();

  // ai.onChange -> the single locked/unlocked SSE broadcaster, covering
  // begin/end/auto-end uniformly. Reuse the existing bridge rather than
  // reinventing it here.
  const ai = new AiSessionManager({
    autoEndMs: config.autoEndMs,
    onChange: makeAiBroadcast(sse, repo),
  });

  // watcher.onExternalChange -> read the fresh board (best-effort) and
  // broadcast external-change. Mirrors api/test-server.ts's wiring exactly.
  const watcher = new FileWatcher({
    boardsRoot: config.boardsRoot,
    isLocked: (slug, subPath) => ai.isLocked(slug, subPath),
    onExternalChange: (slug, subPath) => {
      let board: unknown;
      try {
        if (repo.exists(slug, subPath)) board = repo.read(slug, subPath);
      } catch {
        board = undefined; // unreadable/corrupt — broadcast without it
      }
      sse.broadcast(slug, subPath, 'external-change', board === undefined ? {} : { board });
    },
    debounceMs: config.debounceMs,
    suppressMs: config.suppressMs,
  });
  watcher.start();

  const yjsWs = new YjsWebsocketService();

  const mdns = new MdnsService({
    enabled: config.mdns ?? false,
    port: config.port ?? 0,
    getBoards: () => repo.listSlugs(),
  });
  mdns.start();

  const ctx: RequestContext = { repo, history, ai, sse, watcher, config };
  const requestHandler = createRequestHandler(ctx);

  return {
    requestHandler,
    attachUpgrade(httpServer: http.Server): void {
      yjsWs.attachUpgrade(httpServer);
    },
    dispose(): void {
      watcher.dispose();
      sse.dispose();
      yjsWs.dispose();
      mdns.dispose();
      ai.dispose();
    },
  };
}
