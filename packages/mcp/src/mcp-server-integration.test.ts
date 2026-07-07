// ── MCP peer -> room -> server-persist integration test ─────────────────────
//
// Starts a REAL `@easel/server` (`startServer`) against a temp boards dir
// with a seeded board, connects a REAL `BoardPeer` (real WebsocketProvider,
// real `ws` socket — no fakes) to its Yjs room, and calls `add_node` via the
// peer. Asserts:
//   (a) a second, independent provider connected to the same room sees the
//       new node (room-level convergence, proving the peer is a real
//       multiplayer participant, not just a local doc mutation), AND
//   (b) after the server's persist debounce, board.json on disk reflects the
//       new node (proving MCP -> room -> server-persist works end-to-end,
//       with NO client-side flush — see peer.ts's module doc).
//
// Reuses the P5-T28 integration-test harness style from
// packages/server/src/services/yjs-persistence.test.ts, but drives the edit
// through this package's own BoardPeer + tools rather than raw shared ops.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { getSnapshot, roomNameFor, type BoardFile, emptyBoard } from '@easel/shared';
import { BoardRepository, startServer, type StartedServer } from '@easel/server';
import { BoardPeer } from './peer.js';
import { addNode, getBoard } from './tools.js';

/** Polls `check` until it returns true or `timeoutMs` elapses. */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForProviderSynced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return;
  await new Promise<void>((resolve) => {
    provider.on('sync', function handler(isSynced: boolean) {
      if (!isSynced) return;
      provider.off('sync', handler);
      resolve();
    });
  });
}

const DEBOUNCE_MS = 50;

interface Harness {
  handle: StartedServer;
  boardsRoot: string;
  repo: BoardRepository;
  wsUrl: string;
  httpUrl: string;
}

async function startHarness(): Promise<Harness> {
  const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-mcp-integration-'));
  const repo = new BoardRepository(boardsRoot);
  repo.write('spend', [], { ...emptyBoard('Spend'), nodes: [], edges: [] } as BoardFile);

  const handle = await startServer({ boardsRoot, port: 0, yjsPersistDebounceMs: DEBOUNCE_MS });
  return {
    handle,
    boardsRoot,
    repo,
    wsUrl: handle.url.replace('http://', 'ws://') + '/yjs',
    httpUrl: handle.url,
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.handle.close();
  await fs.rm(h.boardsRoot, { recursive: true, force: true });
}

let harness: Harness | undefined;

afterEach(async () => {
  if (harness) {
    await stopHarness(harness);
    harness = undefined;
  }
});

describe('BoardPeer -> real Yjs room -> real server (integration)', () => {
  it(
    'a node added via a real BoardPeer is visible to a second provider on the same room, and lands in board.json after the persist debounce',
    { retry: 2, timeout: 20_000 },
    async () => {
      harness = await startHarness();

      const peer = new BoardPeer({ wsUrl: harness.wsUrl, slug: 'spend', name: 'Integration AI' });

      // A second, independent client on the same room — proves the peer's
      // write reaches the server (and other peers), not just its own doc.
      const observerDoc = new Y.Doc();
      const observerProvider = new WebsocketProvider(
        harness.wsUrl,
        roomNameFor('spend', []),
        observerDoc,
        {
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
          connect: true,
        },
      );

      try {
        await peer.waitForSync(15_000);
        await waitForProviderSynced(observerProvider);

        const id = addNode(peer, { type: 'sticky', pos: { x: 12, y: 34 }, color: '#fef3c7' });

        // (a) The second provider on the same room sees the new node.
        await waitFor(() => getSnapshot(observerDoc).nodes.length === 1);
        const observedNode = getSnapshot(observerDoc).nodes[0];
        expect(observedNode).toMatchObject({ id, type: 'sticky', pos: { x: 12, y: 34 } });

        // Also visible through the peer's own tool-level read.
        expect(getBoard(peer).nodes).toHaveLength(1);

        // (b) After the server's persist debounce, board.json on disk reflects it.
        await waitFor(() => {
          try {
            return harness!.repo.read('spend', []).nodes.length === 1;
          } catch {
            return false;
          }
        });
        const onDisk = harness.repo.read('spend', []);
        expect(onDisk.nodes[0]).toMatchObject({ id, type: 'sticky', pos: { x: 12, y: 34 } });
      } finally {
        peer.destroy();
        observerProvider.destroy();
        observerDoc.destroy();
      }
    },
  );

  it(
    'the peer never POSTs to /api/board — the server persists the room, the peer does not flush',
    { retry: 2, timeout: 20_000 },
    async () => {
      harness = await startHarness();
      const calledPaths: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calledPaths.push(String(input));
        return realFetch(input, init);
      }) as typeof fetch;

      const peer = new BoardPeer({ wsUrl: harness.wsUrl, slug: 'spend', name: 'Integration AI' });
      try {
        await peer.waitForSync(15_000);
        addNode(peer, { type: 'sticky', pos: { x: 1, y: 1 } });

        // Give the server's debounce window (and then some) time to elapse —
        // if anything client-side were POSTing, it would have fired by now.
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 4));

        expect(calledPaths.some((p) => p.includes('/api/board'))).toBe(false);
      } finally {
        globalThis.fetch = realFetch;
        peer.destroy();
      }
    },
  );
});
