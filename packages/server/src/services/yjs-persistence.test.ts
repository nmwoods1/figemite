// ── YjsWebsocketService persistence tests ────────────────────────────────────
//
// Exercises the server-side seed (bindState) / persist-on-update (debounced)
// wiring end-to-end: a real http.Server, real y-websocket WebsocketProvider
// clients (Node `ws`), and a real BoardRepository/SnapshotHistoryService
// against a temp boards dir. No client-side loadBoardIntoDoc is used anywhere
// here — if a doc syncs seeded content, it's because the SERVER put it there.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import {
  emptyBoard,
  getSnapshot,
  makeStickyNode,
  roomNameFor,
  serialise,
  addNode,
  moveNode,
  type BoardFile,
} from '@figemite/shared';
import { YjsWebsocketService } from './yjs-ws.js';
import { BoardRepository } from '../repository/board-repo.js';
import { SnapshotHistoryService } from '../services/snapshot-history.js';

interface Harness {
  server: http.Server;
  service: YjsWebsocketService;
  boardsRoot: string;
  repo: BoardRepository;
  history: SnapshotHistoryService;
  url: string;
  suppressed: Array<{ slug: string; subPath: string[] }>;
}

const DEBOUNCE_MS = 50;

async function startHarness(): Promise<Harness> {
  const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-yjs-persist-'));
  const repo = new BoardRepository(boardsRoot);
  const history = new SnapshotHistoryService(boardsRoot);
  const suppressed: Array<{ slug: string; subPath: string[] }> = [];

  const service = new YjsWebsocketService({
    repo,
    history,
    suppress: (slug, subPath) => suppressed.push({ slug, subPath }),
    debounceMs: DEBOUNCE_MS,
  });

  const server = http.createServer();
  service.attachUpgrade(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    service,
    boardsRoot,
    repo,
    history,
    url: `ws://127.0.0.1:${port}/yjs/`,
    suppressed,
  };
}

async function stopHarness(h: Harness): Promise<void> {
  h.service.dispose();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  await fs.rm(h.boardsRoot, { recursive: true, force: true });
}

function connectProvider(h: Harness, room: string, doc: Y.Doc): WebsocketProvider {
  return new WebsocketProvider(h.url, room, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    connect: true,
  });
}

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

async function waitForSynced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return;
  await new Promise<void>((resolve) => {
    provider.on('sync', function handler(isSynced: boolean) {
      if (!isSynced) return;
      provider.off('sync', handler);
      resolve();
    });
  });
}

let harness: Harness | undefined;

afterEach(async () => {
  if (harness) {
    await stopHarness(harness);
    harness = undefined;
  }
});

// ── Cold-room seed ───────────────────────────────────────────────────────────

describe('cold-room seed (bindState)', () => {
  it('seeds a brand-new room doc from the on-disk board.json', async () => {
    harness = await startHarness();
    const board: BoardFile = {
      ...emptyBoard('Seeded Board'),
      nodes: [makeStickyNode('s1', { x: 10, y: 20 }, '#fef3c7', 0)],
    };
    harness.repo.write('my-board', [], board);

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      await waitFor(() => getSnapshot(doc).nodes.length === 1);
      const snapshot = getSnapshot(doc);
      expect(snapshot.nodes).toEqual(board.nodes);
      expect(snapshot.edges).toEqual(board.edges);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  it('leaves a brand-new room doc empty when no board.json exists yet', async () => {
    harness = await startHarness();
    const room = roomNameFor('nonexistent-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      // Give any (incorrect) async seed a moment to (wrongly) land.
      await new Promise((r) => setTimeout(r, 100));
      expect(getSnapshot(doc).nodes).toEqual([]);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  it('seeds a nested sub-board room from its own dotted board file', async () => {
    harness = await startHarness();
    harness.repo.seedBoard('my-board', 'Root');
    const subBoard: BoardFile = {
      ...emptyBoard('Sub Board'),
      nodes: [makeStickyNode('sub1', { x: 0, y: 0 }, '#dbeafe', 0)],
    };
    harness.repo.write('my-board', ['frame1', 'inner1'], subBoard);

    const room = roomNameFor('my-board', ['frame1', 'inner1']);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      await waitFor(() => getSnapshot(doc).nodes.length === 1);
      expect(getSnapshot(doc).nodes).toEqual(subBoard.nodes);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

// ── Persist-on-edit ───────────────────────────────────────────────────────────

describe('persist-on-edit (debounced writeback)', () => {
  it('writes the edited doc back to board.json (via repo.write + suppress) after the debounce, and takes a save snapshot', async () => {
    harness = await startHarness();
    harness.repo.seedBoard('my-board', 'My Board');

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);

      addNode(doc, makeStickyNode('s1', { x: 5, y: 5 }, '#fef3c7', 0));

      await waitFor(() => {
        try {
          return harness!.repo.read('my-board', []).nodes.length === 1;
        } catch {
          return false;
        }
      });

      const onDisk = harness.repo.read('my-board', []);
      expect(onDisk.nodes).toEqual([makeStickyNode('s1', { x: 5, y: 5 }, '#fef3c7', 0)]);

      // The watcher was suppressed for this write.
      expect(harness.suppressed.some((s) => s.slug === 'my-board' && s.subPath.length === 0)).toBe(
        true,
      );

      // A 'save' snapshot was taken.
      const snaps = harness.history.list('my-board', []);
      expect(snaps.some((s) => s.trigger === 'save')).toBe(true);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  it('debounces multiple rapid edits into a single settled write', async () => {
    harness = await startHarness();
    harness.repo.seedBoard('my-board', 'My Board');

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);

      addNode(doc, makeStickyNode('s1', { x: 0, y: 0 }, '#fef3c7', 0));
      moveNode(doc, 's1', { x: 1, y: 1 });
      moveNode(doc, 's1', { x: 2, y: 2 });
      moveNode(doc, 's1', { x: 3, y: 3 });

      await waitFor(() => {
        try {
          const board = harness!.repo.read('my-board', []);
          return board.nodes[0]?.pos.x === 3;
        } catch {
          return false;
        }
      });

      const onDisk = harness.repo.read('my-board', []);
      expect(onDisk.nodes[0].pos).toEqual({ x: 3, y: 3 });
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

// ── Two peers converge + file matches ────────────────────────────────────────

describe('two peers converge and the persisted file matches', () => {
  it('interleaved edits from two providers converge in-memory and on disk', async () => {
    harness = await startHarness();
    harness.repo.seedBoard('my-board', 'My Board');

    const room = roomNameFor('my-board', []);
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const providerA = connectProvider(harness, room, docA);
    const providerB = connectProvider(harness, room, docB);
    try {
      await waitForSynced(providerA);
      await waitForSynced(providerB);

      addNode(docA, makeStickyNode('a1', { x: 0, y: 0 }, '#fef3c7', 0));
      addNode(docB, makeStickyNode('b1', { x: 100, y: 100 }, '#dbeafe', 1));

      await waitFor(() => getSnapshot(docA).nodes.length === 2);
      await waitFor(() => getSnapshot(docB).nodes.length === 2);

      const snapA = getSnapshot(docA);
      const snapB = getSnapshot(docB);
      expect(new Set(snapA.nodes.map((n) => n.id))).toEqual(new Set(['a1', 'b1']));
      expect(snapA.nodes.sort((x, y) => x.id.localeCompare(y.id))).toEqual(
        snapB.nodes.sort((x, y) => x.id.localeCompare(y.id)),
      );

      await waitFor(() => {
        try {
          return harness!.repo.read('my-board', []).nodes.length === 2;
        } catch {
          return false;
        }
      });

      const persisted = harness.repo.read('my-board', []);
      expect(new Set(persisted.nodes.map((n) => n.id))).toEqual(new Set(['a1', 'b1']));
      // The persisted file matches BOTH docs' snapshots (order-insensitive).
      expect(serialise({ ...persisted })).toEqual(
        serialise({ ...persisted, nodes: snapA.nodes, edges: snapA.edges }),
      );
    } finally {
      providerA.destroy();
      providerB.destroy();
      docA.destroy();
      docB.destroy();
    }
  });
});

// ── Metadata preserved ────────────────────────────────────────────────────────

describe('metadata (boardLabel/viewport) preserved across a doc-driven persist', () => {
  it('a doc-driven persist keeps the on-disk boardLabel and viewport intact', async () => {
    harness = await startHarness();
    const board: BoardFile = {
      ...emptyBoard('Custom Label'),
      viewport: { x: 42, y: -7, zoom: 2.5 },
    };
    harness.repo.write('my-board', [], board);

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      await waitFor(() => getSnapshot(doc).nodes.length === 0); // just ensure seeded/synced

      addNode(doc, makeStickyNode('s1', { x: 0, y: 0 }, '#fef3c7', 0));

      await waitFor(() => {
        try {
          return harness!.repo.read('my-board', []).nodes.length === 1;
        } catch {
          return false;
        }
      });

      const onDisk = harness.repo.read('my-board', []);
      expect(onDisk.boardLabel).toBe('Custom Label');
      expect(onDisk.viewport).toEqual({ x: 42, y: -7, zoom: 2.5 });
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

// ── Dispose flushes a pending write ──────────────────────────────────────────

describe('dispose flushes a pending write', () => {
  it('flushes a debounced write immediately on dispose, before the debounce would have fired', async () => {
    const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-yjs-persist-dispose-'));
    const repo = new BoardRepository(boardsRoot);
    const history = new SnapshotHistoryService(boardsRoot);
    repo.seedBoard('my-board', 'My Board');

    // A long debounce so we can prove dispose() flushes synchronously/promptly
    // rather than waiting for the timer.
    const service = new YjsWebsocketService({
      repo,
      history,
      suppress: () => {},
      debounceMs: 60_000,
    });
    const server = http.createServer();
    service.attachUpgrade(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/yjs/`;

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider({ url } as Harness, room, doc);
    try {
      await waitForSynced(provider);
      addNode(doc, makeStickyNode('s1', { x: 9, y: 9 }, '#fef3c7', 0));
      // Give the update a tick to reach the server-side doc (over the socket)
      // without waiting anywhere near the 60s debounce.
      await new Promise((r) => setTimeout(r, 150));

      service.dispose();
      // dispose() should have flushed synchronously (or near-immediately) —
      // no need to wait out the debounce window.
      const onDisk = repo.read('my-board', []);
      expect(onDisk.nodes).toEqual([makeStickyNode('s1', { x: 9, y: 9 }, '#fef3c7', 0)]);
    } finally {
      provider.destroy();
      doc.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(boardsRoot, { recursive: true, force: true });
    }
  });
});

// ── Draft rooms (slug~<draftId>) seed/persist into .drafts/, not prod ─────────

describe('draft rooms', () => {
  it('seeds a draft room from the draft board file, not prod', async () => {
    harness = await startHarness();
    harness.repo.write('my-board', [], { ...emptyBoard('Prod'), nodes: [] });
    harness.repo.write(
      'my-board',
      [],
      { ...emptyBoard('Draft'), nodes: [makeStickyNode('draftNode', { x: 1, y: 2 }, '#fef3c7', 0)] },
      'd1',
    );

    const room = roomNameFor('my-board', [], 'd1');
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      await waitFor(() => getSnapshot(doc).nodes.length === 1);
      expect(getSnapshot(doc).nodes.map((n) => n.id)).toEqual(['draftNode']);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  it('persists a draft room edit into .drafts/<id>/board.json, leaving prod untouched', async () => {
    harness = await startHarness();
    harness.repo.seedBoard('my-board', 'Prod');
    harness.repo.write('my-board', [], emptyBoard('Draft'), 'd1');

    const room = roomNameFor('my-board', [], 'd1');
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      addNode(doc, makeStickyNode('addedInDraft', { x: 5, y: 5 }, '#fef3c7', 0));
      await waitFor(() => harness!.repo.read('my-board', [], 'd1').nodes.length === 1);

      expect(harness.repo.read('my-board', [], 'd1').nodes.map((n) => n.id)).toEqual([
        'addedInDraft',
      ]);
      // Prod stays empty.
      expect(harness.repo.read('my-board', []).nodes).toEqual([]);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

// ── replaceRoomContent (promotion into a live prod room) ─────────────────────

describe('replaceRoomContent', () => {
  it('returns false when no room is live for the target', async () => {
    harness = await startHarness();
    expect(harness.service.replaceRoomContent('my-board', [], { nodes: [], edges: [] })).toBe(false);
  });

  it('converges a connected prod doc and persists the replacement to disk', async () => {
    harness = await startHarness();
    harness.repo.write(
      'my-board',
      [],
      { ...emptyBoard('Prod'), nodes: [makeStickyNode('old', { x: 0, y: 0 }, '#fef3c7', 0)] },
    );

    const room = roomNameFor('my-board', []);
    const doc = new Y.Doc();
    const provider = connectProvider(harness, room, doc);
    try {
      await waitForSynced(provider);
      await waitFor(() => getSnapshot(doc).nodes.length === 1);

      const applied = harness.service.replaceRoomContent('my-board', [], {
        nodes: [makeStickyNode('new', { x: 9, y: 9 }, '#fef3c7', 0)],
        edges: [],
      });
      expect(applied).toBe(true);

      // The connected client converges on the replacement...
      await waitFor(() => getSnapshot(doc).nodes.map((n) => n.id).join() === 'new');
      // ...and the room's own debounce persists it to prod board.json.
      await waitFor(() => harness!.repo.read('my-board', []).nodes.map((n) => n.id).join() === 'new');
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});
