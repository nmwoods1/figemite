// ── Phase 5 GATE (P5-T33), parts B + D — MCP AI-peer round-trip and ─────────
// convergence against LIVE mixed writes
//
// This is the explicit Phase-5 gate assertion for the MCP AI-peer: a real
// `@easel/server` (`startServer`), a real `BoardPeer` (real WebsocketProvider,
// real `ws` socket) driving every board-editing tool
// (`add_node`/`move_node`/`set_node_text`/`add_edge`/`add_drawing`), and a
// SECOND, independent provider on the same room proving live convergence.
// Reuses the P5-T28/T32 harness style from
// `packages/server/src/services/yjs-persistence.test.ts` and
// `packages/mcp/src/mcp-server-integration.test.ts` (consolidating into one
// explicit gate rather than duplicating those — see this repo's task note for
// P5-T33) and extends it with:
//
//   B. Every tool in the "AI peer round-trip" list (not just add_node, which
//      mcp-server-integration.test.ts already covers) — add_node, move_node,
//      set_node_text, add_edge, add_drawing — each asserted BOTH in a second
//      independent provider's live snapshot (in-memory convergence) AND, after
//      the server's persist debounce, in board.json on disk.
//   B. The MCP peer's awareness state carries `isAI: true` (and its
//      `agentClient` tag), matching what a human client's PresenceLayer would
//      read to render a distinct AI cursor/badge (hooks/usePresence.ts,
//      components/PresenceLayer.tsx in @easel/client).
//   D. After a MIX of MCP-peer writes AND a second, independent (non-MCP)
//      provider's writes on the SAME room, every peer's `getSnapshot()` is
//      byte-identical via the canonical `serialise()` (assembled into a full
//      BoardFile), and the persisted board.json matches too — re-asserting
//      the Phase-0 convergence guarantee against LIVE peer writes (not just
//      two bulk-loaded local Y.Docs, as crdt/cross-consumer.test.ts checks).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import {
  FORMAT_VERSION,
  emptyBoard,
  getSnapshot,
  roomNameFor,
  serialise,
  type BoardFile,
  type AwarenessState,
} from '@easel/shared';
import { BoardRepository, startServer, type StartedServer } from '@easel/server';
import { BoardPeer } from './peer.js';
import { addNode, moveNode, setNodeText, addEdge, addDrawing, getBoard } from './tools.js';

/** Polls `check` until it returns true or `timeoutMs` elapses. */
async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
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
const SLUG = 'gate-board';

interface Harness {
  handle: StartedServer;
  boardsRoot: string;
  repo: BoardRepository;
  wsUrl: string;
  httpUrl: string;
}

async function startHarness(): Promise<Harness> {
  const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-ai-peer-gate-'));
  const repo = new BoardRepository(boardsRoot);
  repo.write(SLUG, [], { ...emptyBoard('Gate Board'), nodes: [], edges: [] } as BoardFile);

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

/** Connects a second, independent (non-MCP) provider to the same room —
 * stands in for "a browser client's realtime provider" without pulling in
 * @easel/client, mirroring yjs-persistence.test.ts's `connectProvider`. */
function connectObserver(h: Harness, doc: Y.Doc): WebsocketProvider {
  return new WebsocketProvider(h.wsUrl, roomNameFor(SLUG, []), doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    connect: true,
  });
}

/** Wraps a doc snapshot into a full BoardFile so `serialise` applies —
 * boardLabel/viewport are fixed/shared across every peer in these tests
 * since none of them mutate metadata, only content. */
function assembleBoardFile(snapshot: {
  nodes: BoardFile['nodes'];
  edges: BoardFile['edges'];
}): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: 'Gate Board',
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

let harness: Harness | undefined;

afterEach(async () => {
  if (harness) {
    await stopHarness(harness);
    harness = undefined;
  }
});

describe('Phase 5 gate B: MCP AI-peer round-trip (every tool, live convergence + persistence)', () => {
  it(
    'add_node, move_node, set_node_text, add_edge, and add_drawing each converge to a second provider and persist to board.json',
    { retry: 2, timeout: 20_000 },
    async () => {
      harness = await startHarness();

      const peer = new BoardPeer({
        wsUrl: harness.wsUrl,
        slug: SLUG,
        name: 'Gate AI',
        agentClient: 'gate-test',
      });

      const observerDoc = new Y.Doc();
      const observerProvider = connectObserver(harness, observerDoc);

      try {
        await peer.waitForSync(15_000);
        await waitForProviderSynced(observerProvider);

        // ── add_node ──────────────────────────────────────────────────────
        const nodeId = addNode(peer, { type: 'sticky', pos: { x: 10, y: 20 }, color: '#fef3c7' });
        await waitFor(() => getSnapshot(observerDoc).nodes.some((n) => n.id === nodeId));
        expect(getSnapshot(observerDoc).nodes.find((n) => n.id === nodeId)).toMatchObject({
          type: 'sticky',
          pos: { x: 10, y: 20 },
        });

        // ── move_node ─────────────────────────────────────────────────────
        moveNode(peer, nodeId, { x: 111, y: 222 });
        await waitFor(() => {
          const n = getSnapshot(observerDoc).nodes.find((x) => x.id === nodeId);
          return !!n && n.pos.x === 111 && n.pos.y === 222;
        });

        // ── set_node_text ─────────────────────────────────────────────────
        setNodeText(peer, nodeId, 'Hello from the AI peer');
        await waitFor(() => {
          const n = getSnapshot(observerDoc).nodes.find((x) => x.id === nodeId) as
            { text?: string } | undefined;
          return n?.text === 'Hello from the AI peer';
        });

        // ── add_edge (needs a second node as target) ─────────────────────
        const secondNodeId = addNode(peer, {
          type: 'shape',
          pos: { x: 300, y: 300 },
          shape: 'rect',
          color: '#e2e8f0',
        });
        await waitFor(() => getSnapshot(observerDoc).nodes.some((n) => n.id === secondNodeId));

        const edgeId = addEdge(peer, { source: nodeId, target: secondNodeId, style: 'solid' });
        await waitFor(() => getSnapshot(observerDoc).edges.some((e) => e.id === edgeId));
        expect(getSnapshot(observerDoc).edges.find((e) => e.id === edgeId)).toMatchObject({
          source: nodeId,
          target: secondNodeId,
        });

        // ── add_drawing ───────────────────────────────────────────────────
        const drawingId = addDrawing(peer, {
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 20 },
            { x: 40, y: 0 },
          ],
          color: '#7c3aed',
          strokeWidth: 4,
        });
        await waitFor(() => getSnapshot(observerDoc).nodes.some((n) => n.id === drawingId));
        const observedDrawing = getSnapshot(observerDoc).nodes.find((n) => n.id === drawingId);
        expect(observedDrawing).toMatchObject({
          type: 'drawing',
          color: '#7c3aed',
          strokeWidth: 4,
        });

        // Also visible through the peer's own tool-level read (sanity check
        // the peer's local doc agrees with what converged to the observer).
        const peerBoard = getBoard(peer);
        expect(peerBoard.nodes.map((n) => n.id).sort()).toEqual(
          [nodeId, secondNodeId, drawingId].sort(),
        );
        expect(peerBoard.edges.map((e) => e.id)).toEqual([edgeId]);

        // ── Persistence: after the debounce, board.json reflects everything ──
        await waitFor(() => {
          try {
            const onDisk = harness!.repo.read(SLUG, []);
            return (
              onDisk.nodes.length === 3 &&
              onDisk.edges.length === 1 &&
              onDisk.nodes.find((n) => n.id === nodeId)?.pos.x === 111
            );
          } catch {
            return false;
          }
        });
        const onDisk = harness.repo.read(SLUG, []);
        expect(onDisk.nodes.find((n) => n.id === nodeId)).toMatchObject({
          pos: { x: 111, y: 222 },
          text: 'Hello from the AI peer',
        });
        expect(onDisk.nodes.find((n) => n.id === secondNodeId)).toMatchObject({ type: 'shape' });
        expect(onDisk.nodes.find((n) => n.id === drawingId)).toMatchObject({
          type: 'drawing',
          color: '#7c3aed',
        });
        expect(onDisk.edges[0]).toMatchObject({ source: nodeId, target: secondNodeId });
      } finally {
        peer.destroy();
        observerProvider.destroy();
        observerDoc.destroy();
      }
    },
  );

  it(
    'the MCP peer appears as an isAI:true presence in awareness, with its agentClient tag',
    { retry: 2, timeout: 20_000 },
    async () => {
      harness = await startHarness();

      const peer = new BoardPeer({
        wsUrl: harness.wsUrl,
        slug: SLUG,
        name: 'Gate AI',
        agentClient: 'gate-test',
      });

      const observerDoc = new Y.Doc();
      const observerProvider = connectObserver(harness, observerDoc);

      try {
        await peer.waitForSync(15_000);
        await waitForProviderSynced(observerProvider);

        // The peer publishes a cursor on construction is NOT guaranteed (only
        // connect_board's MCP-tool wrapper does that) — but BoardPeer's
        // constructor DOES set the full initial awareness state synchronously
        // (see peer.ts), which is what this asserts: a human browser's
        // PresenceLayer/ActiveUsersPanel reads exactly this awareness shape
        // (isAI, agentClient) to render the AI's distinct badge/cursor.
        await waitFor(() => observerProvider.awareness.getStates().size >= 1);

        const states = Array.from(
          observerProvider.awareness.getStates().values(),
        ) as AwarenessState[];
        const aiState = states.find((s) => s.isAI === true);
        expect(aiState, 'no isAI:true presence state observed for the MCP peer').toBeTruthy();
        expect(aiState!.agentClient).toBe('gate-test');
        expect(aiState!.user?.name).toBe('Gate AI');

        // Publishing a cursor/editing update (as add_node's cursor-lead does)
        // also carries isAI through — confirm the SAME entry stays isAI:true
        // after a live update, not just at initial bootstrap.
        peer.setCursor({ x: 5, y: 5 });
        await waitFor(() => {
          const s = Array.from(observerProvider.awareness.getStates().values()) as AwarenessState[];
          return s.some((x) => x.isAI === true && x.cursor?.x === 5);
        });
      } finally {
        peer.destroy();
        observerProvider.destroy();
        observerDoc.destroy();
      }
    },
  );
});

describe('Phase 5 gate D: convergence guarantee against LIVE mixed MCP + provider writes', () => {
  it(
    'after interleaved MCP-peer and independent-provider edits, every peer snapshot is byte-identical (canonical serialise) and matches the persisted board.json',
    { retry: 2, timeout: 20_000 },
    async () => {
      harness = await startHarness();

      const peer = new BoardPeer({ wsUrl: harness.wsUrl, slug: SLUG, name: 'Gate AI' });

      const providerDoc = new Y.Doc();
      const provider = connectObserver(harness, providerDoc);

      // A THIRD, purely-observing peer — proves convergence isn't an
      // artifact of only ever comparing the two WRITERS to each other.
      const thirdDoc = new Y.Doc();
      const thirdProvider = connectObserver(harness, thirdDoc);

      try {
        await peer.waitForSync(15_000);
        await waitForProviderSynced(provider);
        await waitForProviderSynced(thirdProvider);

        // Mixed writes: MCP peer adds a sticky + moves it; the independent
        // provider (standing in for a second human/browser client) adds its
        // own node directly via the shared ops (no MCP involved) — exactly
        // the "live peer writes" mix the Phase-0 convergence guarantee must
        // hold under, not just two independently-bulk-loaded local docs.
        const aiNodeId = addNode(peer, { type: 'sticky', pos: { x: 1, y: 1 }, color: '#fef3c7' });
        moveNode(peer, aiNodeId, { x: 50, y: 60 });

        const { addNode: addNodeOp, makeShapeNode } = await import('@easel/shared');
        const humanNodeId = 'human-shape-1';
        addNodeOp(
          providerDoc,
          makeShapeNode(
            humanNodeId,
            { x: 200, y: 200 },
            1,
            'ellipse',
            { width: 160, height: 100 },
            '#dbeafe',
          ),
        );

        setNodeText(peer, aiNodeId, 'from AI');

        // Wait for both writers' content to converge on ALL THREE docs.
        await waitFor(() => getSnapshot(peer.doc).nodes.length === 2);
        await waitFor(() => getSnapshot(providerDoc).nodes.length === 2);
        await waitFor(() => getSnapshot(thirdDoc).nodes.length === 2);

        const snapAI = getSnapshot(peer.doc);
        const snapProvider = getSnapshot(providerDoc);
        const snapThird = getSnapshot(thirdDoc);

        const serialisedAI = serialise(assembleBoardFile(snapAI));
        const serialisedProvider = serialise(assembleBoardFile(snapProvider));
        const serialisedThird = serialise(assembleBoardFile(snapThird));

        expect(serialisedProvider).toBe(serialisedAI);
        expect(serialisedThird).toBe(serialisedAI);

        // Persisted board.json (after the server's debounce) matches too.
        await waitFor(() => {
          try {
            return harness!.repo.read(SLUG, []).nodes.length === 2;
          } catch {
            return false;
          }
        });
        const onDisk = harness.repo.read(SLUG, []);
        const serialisedDisk = serialise(onDisk);
        expect(serialisedDisk).toBe(
          serialise({ ...onDisk, nodes: snapAI.nodes, edges: snapAI.edges }),
        );

        // Sanity: both writers' nodes are actually present (not just equal
        // counts by coincidence).
        expect(new Set(snapAI.nodes.map((n) => n.id))).toEqual(new Set([aiNodeId, humanNodeId]));
      } finally {
        peer.destroy();
        provider.destroy();
        providerDoc.destroy();
        thirdProvider.destroy();
        thirdDoc.destroy();
      }
    },
  );
});
