// ── createServer — service composition (P1-T13) ─────────────────────────────
//
// Instantiates and wires every `@figemite/server` service into a single runnable
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
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { BoardRepository } from './repository/board-repo.js';
import { SnapshotHistoryService } from './services/snapshot-history.js';
import { AiSessionManager } from './services/ai-session.js';
import { SseHub } from './services/sse-hub.js';
import { FileWatcher } from './services/file-watcher.js';
import { YjsWebsocketService } from './services/yjs-ws.js';
import { MdnsService } from './services/mdns.js';
import { SERVER_VERSION, type ServerConfig } from './config.js';
import { createRequestHandler, type InstanceIdentity, type RequestContext } from './api/router.js';
import { makeAiBroadcast } from './api/ai-broadcast.js';

export interface ServerHandle {
  /** The composed `(req, res)` handler — mount on any `http.Server`. */
  requestHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /** Registers the Yjs `/yjs/*` websocket upgrade handler on `httpServer`. */
  attachUpgrade(httpServer: http.Server): void;
  /**
   * This instance's identity (id/name/version, and `url` once advertised). The
   * same object surfaced by `GET /api/instance`.
   */
  instance: InstanceIdentity;
  /**
   * Records the server's real bound URL/port (known only after
   * `http.Server#listen()`) and (re)publishes the mDNS advertisement with them.
   * `startServer` and the dev-server plugin call this once bound. Setting the
   * URL also makes `GET /api/instance` report the true address; the mDNS
   * re-publish is a no-op when mDNS is disabled.
   */
  advertise(runtime: { url: string; port: number }): void;
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

  // Server-side Yjs-doc persistence (P5-T28): seeds a cold room from disk and
  // debounce-persists edits back, via the SAME repo/history/watcher instances
  // the HTTP API uses — one `BoardRepository` write path, one snapshot
  // history, one suppression map, regardless of whether a write originated
  // from POST /api/board or from a Yjs room's debounced flush.
  const yjsWs = new YjsWebsocketService({
    repo,
    history,
    suppress: (slug, subPath, draftId) => watcher.suppress(slug, subPath, draftId),
    debounceMs: config.yjsPersistDebounceMs,
  });

  // Instance identity: a per-process id disambiguates multiple servers on one
  // host (the mDNS name defaults to os.hostname()). `url` is filled in later by
  // `advertise(...)` once the real bound address is known.
  const instance: InstanceIdentity = {
    id: config.instanceId ?? randomUUID(),
    name: config.instanceName ?? os.hostname(),
    version: config.version ?? SERVER_VERSION,
    url: '',
  };

  const mdns = new MdnsService({
    enabled: config.mdns ?? false,
    port: config.port,
    id: instance.id,
    name: instance.name,
    version: instance.version,
    getBoards: () => repo.listSlugs(),
  });
  // Not published here: the real bound port isn't known until listen(). The
  // caller (startServer / dev plugin) calls `advertise(...)` to publish.

  const ctx: RequestContext = { repo, history, ai, sse, watcher, config, instance, yjs: yjsWs };
  const requestHandler = createRequestHandler(ctx);

  return {
    requestHandler,
    instance,
    advertise({ url, port }: { url: string; port: number }): void {
      instance.url = url;
      mdns.start({ url, port });
    },
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
