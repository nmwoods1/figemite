// ── Test harness: a real http.Server mounting createRequestHandler ───────────
//
// NOT shipped in the public surface — this lives beside the tests as the shared
// "assemble a full ctx and listen on an ephemeral port" helper. It wires the
// services together exactly as the composition layer (P1-T13) will: `ai.onChange`
// -> `makeAiBroadcast(sse, repo)`, and the file watcher's `onExternalChange`
// -> an `external-change` SSE broadcast carrying the fresh board. Tests drive it
// with `fetch` against `harness.url`.

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BoardRepository } from '../repository/board-repo.js';
import { SnapshotHistoryService } from '../services/snapshot-history.js';
import { AiSessionManager } from '../services/ai-session.js';
import { SseHub } from '../services/sse-hub.js';
import { FileWatcher } from '../services/file-watcher.js';
import type { ServerConfig } from '../config.js';
import { createRequestHandler, type RequestContext } from './router.js';
import { makeAiBroadcast } from './ai-broadcast.js';

export interface TestHarness {
  url: string;
  ctx: RequestContext;
  boardsRoot: string;
  close(): Promise<void>;
}

export interface TestHarnessOptions {
  /** File-watcher debounce window; tiny by default so external-change tests are fast. */
  debounceMs?: number;
  /** File-watcher self-write suppression window. */
  suppressMs?: number;
  /** AI auto-end timeout; long by default so it never fires mid-test. */
  autoEndMs?: number;
  /** SSE heartbeat interval; long by default so heartbeats don't interleave with assertions. */
  heartbeatMs?: number;
}

/** Builds a fresh temp boards dir, wires all services, and starts listening. */
export async function startTestServer(options: TestHarnessOptions = {}): Promise<TestHarness> {
  const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-api-'));
  const config: ServerConfig = { boardsRoot };

  const repo = new BoardRepository(boardsRoot);
  const history = new SnapshotHistoryService(boardsRoot);
  const sse = new SseHub({ heartbeatMs: options.heartbeatMs ?? 60_000 });

  // ai.onChange -> SSE lock-state broadcasts (locked/unlocked), exactly as
  // composition will wire it.
  const ai = new AiSessionManager({
    autoEndMs: options.autoEndMs ?? 60_000,
    onChange: makeAiBroadcast(sse, repo),
  });

  // Watcher fires external-change; the composition-level wiring reads the fresh
  // board and broadcasts it over SSE. Guarded so a corrupt/missing board
  // doesn't crash the callback.
  const watcher = new FileWatcher({
    boardsRoot,
    isLocked: (slug, subPath) => ai.isLocked(slug, subPath),
    onExternalChange: (slug, subPath) => {
      let board: unknown;
      try {
        if (repo.exists(slug, subPath)) board = repo.read(slug, subPath);
      } catch {
        board = undefined;
      }
      sse.broadcast(slug, subPath, 'external-change', board === undefined ? {} : { board });
    },
    debounceMs: options.debounceMs ?? 30,
    suppressMs: options.suppressMs ?? 200,
  });

  sse.start();
  watcher.start();

  const ctx: RequestContext = { repo, history, ai, sse, watcher, config };
  const server = http.createServer(createRequestHandler(ctx));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to bind test server to an ephemeral port');
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    ctx,
    boardsRoot,
    async close() {
      watcher.dispose();
      sse.dispose();
      // Force-close lingering keep-alive sockets (Node's fetch keeps the socket
      // open by default) so `server.close()` resolves immediately instead of
      // waiting out the idle timeout.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(boardsRoot, { recursive: true, force: true });
    },
  };
}
