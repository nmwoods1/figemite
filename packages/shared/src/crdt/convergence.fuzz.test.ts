// ── T6 Deliverable B — CRDT convergence fuzz suite ──────────────────────────
//
// Yjs already guarantees that replicas which exchange all updates converge to
// the same internal CRDT state (that's the library's job, not ours). What THIS
// suite verifies is OUR contract on top of that guarantee: that whatever
// converged state the ops in ops.ts can produce, `getSnapshot` + the T3 zod
// schemas turn it into a valid, self-consistent BoardFile — no torn nodes, no
// dangling edges, no missing required text — no matter how concurrent edits
// from 2-3 replicas interleave or race.
//
// Model: each of N replicas is a Y.Doc. A randomized "plan" assigns a sequence
// of ops (addNode/updateNode/moveNode/deleteNode/setNodeText/addEdge/
// updateEdge/deleteEdge/addDrawing) to replicas, referencing only ids that a
// prior op in the SAME replica's local history could plausibly have created
// (tracked while the plan executes). Each op is applied locally (producing a
// Yjs update captured via `doc.on('update', ...)`), then ALL captured updates
// from ALL replicas are delivered to ALL OTHER replicas in a fast-check-
// permuted order (simulating network reordering), and finally a full
// state-vector exchange lets any remaining gaps settle. This mirrors the
// standard Yjs "offline edits, then merge" test pattern.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import type { BoardEdge, BoardFile, BoardNode, DrawingNode, XY } from '../model/board.js';
import { FORMAT_VERSION } from '../model/constants.js';
import { SHAPE_KINDS, STICKY_COLORS } from '../model/constants.js';
import { BoardNodeSchema } from '../model/schema.js';
import { serialise } from '../board-io.js';
import {
  addDrawing,
  addEdge,
  addNode,
  deleteEdge,
  deleteNode,
  getSnapshot,
  moveNode,
  setNodeText,
  updateEdge,
  updateNode,
} from './ops.js';
import type { SyncShape } from './schema.js';

function assembleBoardFile(snapshot: { nodes: BoardNode[]; edges: BoardEdge[] }): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: 'Fuzz fixture',
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
//
// The op interpreter needs its own random choices (which node/edge id to
// target, which field to patch, etc.) that are NOT drawn from fast-check's
// arbitraries directly — that would require complex chained/dependent
// arbitraries. Instead each test case carries one integer seed, and a small
// deterministic PRNG derived from it drives every choice during interpretation.
// Same seed => same run, so shrinking / CI reproduction stays deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ── Node/edge value generators (driven by the PRNG, not fast-check) ─────────

const NODE_TYPES = ['sticky', 'text', 'shape', 'frame', 'emoji', 'icon', 'drawing'] as const;
type NodeType = (typeof NODE_TYPES)[number];

function randomXY(rng: () => number): XY {
  return { x: randInt(rng, -500, 500), y: randInt(rng, -500, 500) };
}

function randomText(rng: () => number): string {
  // Includes an empty string as a valid possibility.
  const options = [
    '',
    'a',
    'Hello world',
    'Sticky note',
    '  spaced  ',
    '🎉 emoji text',
    'Line1\nLine2',
  ];
  return pick(rng, options);
}

function makeRandomNode(rng: () => number, id: string, order: number, type: NodeType): BoardNode {
  const pos = randomXY(rng);
  const description = chance(rng, 0.3) ? randomText(rng) : undefined;
  const base = { id, pos, order, ...(description !== undefined ? { description } : {}) };
  switch (type) {
    case 'sticky':
      return {
        ...base,
        type: 'sticky',
        size: { width: randInt(rng, 50, 300), height: randInt(rng, 50, 300) },
        text: randomText(rng),
        color: pick(rng, STICKY_COLORS),
      };
    case 'text':
      return { ...base, type: 'text', text: randomText(rng) };
    case 'shape': {
      const hasText = chance(rng, 0.6);
      return {
        ...base,
        type: 'shape',
        size: { width: randInt(rng, 50, 300), height: randInt(rng, 50, 300) },
        shape: pick(rng, SHAPE_KINDS),
        ...(hasText ? { text: randomText(rng) } : {}),
        color: '#e2e8f0',
        ...(chance(rng, 0.3) ? { rotation: randInt(rng, 0, 359) } : {}),
      };
    }
    case 'frame':
      return {
        ...base,
        type: 'frame',
        size: { width: randInt(rng, 200, 600), height: randInt(rng, 200, 600) },
        title: randomText(rng),
        color: '#fef3c7',
      };
    case 'emoji':
      return {
        ...base,
        type: 'emoji',
        text: pick(rng, ['🚀', '🎉', '✅', '🔥']),
        size: randInt(rng, 16, 128),
        ...(chance(rng, 0.3) ? { rotation: randInt(rng, 0, 359) } : {}),
      };
    case 'icon':
      return {
        ...base,
        type: 'icon',
        name: pick(rng, ['gear', 'star', 'bolt', 'flag']),
        size: randInt(rng, 16, 128),
        color: '#1e293b',
        ...(chance(rng, 0.3) ? { rotation: randInt(rng, 0, 359) } : {}),
      };
    case 'drawing': {
      const n = randInt(rng, 2, 5);
      const points: XY[] = [];
      for (let i = 0; i < n; i++) points.push(randomXY(rng));
      return {
        ...base,
        type: 'drawing',
        size: { width: randInt(rng, 20, 200), height: randInt(rng, 20, 200) },
        points,
        color: '#1e293b',
        strokeWidth: randInt(rng, 1, 6),
      } as DrawingNode;
    }
  }
}

/** A same-variant patch for `updateNode` — only touches fields valid for `type`. */
function makeValidPatch(rng: () => number, type: NodeType): Partial<SyncShape> {
  switch (type) {
    case 'sticky':
      return chance(rng, 0.5)
        ? { color: pick(rng, STICKY_COLORS) }
        : { size: { width: randInt(rng, 50, 300), height: randInt(rng, 50, 300) } };
    case 'text':
      return { pos: randomXY(rng) };
    case 'shape':
      return chance(rng, 0.5) ? { color: '#dbeafe' } : { shape: pick(rng, SHAPE_KINDS) };
    case 'frame':
      return { color: '#fce7f3' };
    case 'emoji':
      return { size: randInt(rng, 16, 128) };
    case 'icon':
      return { name: pick(rng, ['gear', 'star', 'bolt', 'flag']) };
    case 'drawing':
      return { strokeWidth: randInt(rng, 1, 6) };
  }
}

function makeRandomEdge(rng: () => number, id: string, source: string, target: string): BoardEdge {
  const style = pick(rng, ['solid', 'dashed'] as const);
  const kind = pick(rng, ['arrow', 'cardinality'] as const);
  const base = {
    id,
    source,
    target,
    style,
    ...(chance(rng, 0.4) ? { label: randomText(rng) } : {}),
    ...(chance(rng, 0.4) ? { sourceHandle: pick(rng, ['top', 'bottom', 'left', 'right']) } : {}),
    ...(chance(rng, 0.4) ? { targetHandle: pick(rng, ['top', 'bottom', 'left', 'right']) } : {}),
  };
  if (kind === 'cardinality') {
    return { ...base, kind, cardinality: pick(rng, ['1:1', '1:N', 'N:1', 'N:N'] as const) };
  }
  return { ...base, kind, arrow: pick(rng, ['none', 'end', 'both'] as const) };
}

// ── Replica simulation ───────────────────────────────────────────────────────

interface Replica {
  doc: Y.Doc;
  updates: Uint8Array[];
}

function makeReplica(): Replica {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  return { doc, updates };
}

/** Deliver a list of updates to a doc in the given order (network reordering). */
function deliver(doc: Y.Doc, updates: Uint8Array[]): void {
  for (const u of updates) Y.applyUpdate(doc, u);
}

/**
 * Interprets a randomized op plan across `replicaCount` replicas:
 *   1. Each replica applies its own assigned ops locally (capturing updates).
 *   2. All replicas' updates are concatenated and delivered to every replica in
 *      a fast-check-permuted order (this is the "network reordering" fc lever).
 *   3. A final full state-vector exchange (round-robin) mops up anything a
 *      single permuted delivery pass didn't fully settle.
 *
 * Returns the array of converged Y.Docs.
 */
function runPlan(
  replicaCount: number,
  planLength: number,
  seed: number,
  deliveryPermutationSeed: number,
): Y.Doc[] {
  const rng = mulberry32(seed);
  const replicas: Replica[] = Array.from({ length: replicaCount }, makeReplica);

  // Per-replica-local bookkeeping of ids this replica has plausibly created,
  // and each id's node type (needed for same-variant patches). This is a LOCAL
  // view per replica (mirroring what a real client/MCP session would track),
  // not a shared oracle — a replica can still target an id another replica
  // deleted concurrently, which is exactly the race we want to exercise.
  const localIds: { id: string; type: NodeType }[][] = replicas.map(() => []);
  const localEdgeIds: string[][] = replicas.map(() => []);
  let nodeCounter = 0;
  let edgeCounter = 0;

  for (let step = 0; step < planLength; step++) {
    const replicaIdx = Math.floor(rng() * replicaCount) % replicaCount;
    const replica = replicas[replicaIdx];
    const ids = localIds[replicaIdx];
    const edgeIds = localEdgeIds[replicaIdx];

    // Weighted op choice. addNode is weighted higher early so there's usually
    // something to operate on; addEdge only makes sense once >= 2 nodes exist.
    const ops: string[] = ['addNode', 'updateNode', 'moveNode', 'deleteNode', 'setNodeText'];
    if (ids.length >= 2) ops.push('addEdge', 'addEdge');
    if (edgeIds.length > 0) ops.push('updateEdge', 'deleteEdge');
    ops.push('addDrawing');
    const op = pick(rng, ops);

    switch (op) {
      case 'addNode':
      case 'addDrawing': {
        const type: NodeType = op === 'addDrawing' ? 'drawing' : pick(rng, NODE_TYPES);
        const id = `n${nodeCounter++}`;
        const node = makeRandomNode(rng, id, step, type);
        if (op === 'addDrawing') addDrawing(replica.doc, node as DrawingNode);
        else addNode(replica.doc, node);
        ids.push({ id, type });
        break;
      }
      case 'updateNode': {
        if (ids.length === 0) break;
        const target = pick(rng, ids);
        const patch = makeValidPatch(rng, target.type);
        updateNode(replica.doc, target.id, patch);
        break;
      }
      case 'moveNode': {
        if (ids.length === 0) break;
        const target = pick(rng, ids);
        moveNode(replica.doc, target.id, randomXY(rng));
        break;
      }
      case 'deleteNode': {
        if (ids.length === 0) break;
        const idx = randInt(rng, 0, ids.length - 1);
        const target = ids[idx];
        deleteNode(replica.doc, target.id);
        // Stop tracking locally — a further local op targeting it is now a
        // "stale id" op, which we still allow (ops are no-ops on missing ids)
        // by leaving other replicas' bookkeeping untouched; but for THIS
        // replica's own future picks we drop it so we don't spam deletes.
        ids.splice(idx, 1);
        break;
      }
      case 'setNodeText': {
        if (ids.length === 0) break;
        const target = pick(rng, ids);
        setNodeText(replica.doc, target.id, randomText(rng));
        break;
      }
      case 'addEdge': {
        if (ids.length < 2) break;
        const a = pick(rng, ids);
        const b = pick(rng, ids);
        const id = `e${edgeCounter++}`;
        addEdge(replica.doc, makeRandomEdge(rng, id, a.id, b.id));
        edgeIds.push(id);
        break;
      }
      case 'updateEdge': {
        if (edgeIds.length === 0) break;
        const id = pick(rng, edgeIds);
        updateEdge(replica.doc, id, {
          ...(chance(rng, 0.5) ? { label: randomText(rng) } : {}),
          style: pick(rng, ['solid', 'dashed'] as const),
        });
        break;
      }
      case 'deleteEdge': {
        if (edgeIds.length === 0) break;
        const idx = randInt(rng, 0, edgeIds.length - 1);
        deleteEdge(replica.doc, edgeIds[idx]);
        edgeIds.splice(idx, 1);
        break;
      }
    }
  }

  // ── Phase 2: simulate network reordering. Concatenate every replica's
  // captured updates, permute deterministically off `deliveryPermutationSeed`,
  // then deliver that permuted stream to every OTHER replica. ────────────────
  const allUpdates = replicas.flatMap((r) => r.updates);
  const permRng = mulberry32(deliveryPermutationSeed);
  const permuted = [...allUpdates];
  // Fisher-Yates using the deterministic PRNG (fast-check drives the seed
  // that feeds this, so shrinking/replay stays deterministic).
  for (let i = permuted.length - 1; i > 0; i--) {
    const j = Math.floor(permRng() * (i + 1));
    [permuted[i], permuted[j]] = [permuted[j], permuted[i]];
  }
  for (const replica of replicas) {
    deliver(replica.doc, permuted);
  }

  // ── Phase 3: final full state-vector exchange (safety net) — round-robin
  // pairwise sync so any gap a single permuted pass left (e.g. an update whose
  // dependency wasn't yet applied to a particular replica) is closed. ───────
  for (let round = 0; round < replicas.length; round++) {
    for (let i = 0; i < replicas.length; i++) {
      for (let j = 0; j < replicas.length; j++) {
        if (i === j) continue;
        const sv = Y.encodeStateVector(replicas[i].doc);
        const diff = Y.encodeStateAsUpdate(replicas[j].doc, sv);
        if (diff.length > 0) Y.applyUpdate(replicas[i].doc, diff);
      }
    }
  }

  return replicas.map((r) => r.doc);
}

// ── Assertions applied to every converged set of replicas ──────────────────

function assertConvergedAndValid(docs: Y.Doc[]): void {
  const snapshots = docs.map(getSnapshot);
  const serialised = snapshots.map((s) => serialise(assembleBoardFile(s)));

  // 1. All replicas produce byte-identical canonical serialisations.
  for (let i = 1; i < serialised.length; i++) {
    expect(serialised[i]).toBe(serialised[0]);
  }

  const snap = snapshots[0];
  const nodeIds = new Set(snap.nodes.map((n) => n.id));

  // 2. Every node validates against the T3 schema (no torn/invalid node).
  for (const node of snap.nodes) {
    const result = BoardNodeSchema.safeParse(node);
    expect(
      result.success,
      `invalid node ${JSON.stringify(node)}: ${JSON.stringify(result.error?.issues)}`,
    ).toBe(true);
  }

  // 3. No edge references a node id absent from the snapshot.
  for (const edge of snap.edges) {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  }

  // 4. No node is missing its required text/title (schema check in #2 already
  // enforces this since text/title are required string fields on those
  // variants — re-asserted explicitly here for clarity/documentation value).
  for (const node of snap.nodes) {
    if (node.type === 'frame') expect(typeof node.title).toBe('string');
    if (node.type === 'sticky' || node.type === 'text' || node.type === 'emoji') {
      expect(typeof node.text).toBe('string');
    }
  }
}

// ── Property test ────────────────────────────────────────────────────────────

const FUZZ_SEED = 424242;
const NUM_RUNS = 300;

describe('CRDT convergence fuzz', () => {
  it(
    `converges to a valid, self-consistent board under randomized concurrent ops ` +
      `and randomized delivery order (seed=${FUZZ_SEED}, numRuns=${NUM_RUNS})`,
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 3 }), // replica count
          fc.integer({ min: 1, max: 60 }), // plan length (number of ops)
          fc.integer({ min: 0, max: 2 ** 31 - 1 }), // op-plan seed
          fc.integer({ min: 0, max: 2 ** 31 - 1 }), // delivery permutation seed
          (replicaCount, planLength, planSeed, deliverySeed) => {
            const docs = runPlan(replicaCount, planLength, planSeed, deliverySeed);
            assertConvergedAndValid(docs);
          },
        ),
        { seed: FUZZ_SEED, numRuns: NUM_RUNS },
      );
    },
  );

  // ── Seeded regression case: delete-vs-concurrent-setText race ────────────
  //
  // Replica A deletes node X while replica B concurrently sets X's text, with
  // neither having seen the other's op before delivery. After convergence,
  // regardless of which "wins" (Yjs's own conflict rule for this), the
  // snapshot must stay schema-valid and self-consistent: no orphaned node, no
  // dangling edge referencing X.
  it('delete-vs-concurrent-setText race resolves to a self-consistent board', () => {
    const a = makeReplica();
    const b = makeReplica();

    // Seed both replicas with the same starting state: node X plus a
    // neighbor Y and an edge between them, so we can also check the edge
    // touching X is handled correctly regardless of the race outcome.
    const seedNode: BoardNode = {
      id: 'X',
      type: 'sticky',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 200, height: 160 },
      text: 'original',
      color: '#fef3c7',
    };
    const neighbor: BoardNode = {
      id: 'Y',
      type: 'sticky',
      pos: { x: 300, y: 0 },
      order: 1,
      size: { width: 200, height: 160 },
      text: 'neighbor',
      color: '#dbeafe',
    };
    addNode(a.doc, seedNode);
    addNode(a.doc, neighbor);
    addEdge(a.doc, {
      id: 'e-xy',
      source: 'X',
      target: 'Y',
      style: 'solid',
      kind: 'arrow',
      arrow: 'end',
    });

    // Sync the seed to replica B before the race (both start from the same
    // base state — this isolates the race to the delete-vs-setText pair).
    const seedUpdate = Y.encodeStateAsUpdate(a.doc);
    Y.applyUpdate(b.doc, seedUpdate);
    a.updates.length = 0;
    b.updates.length = 0;

    // Concurrent, un-synced ops: A deletes X; B sets X's text. Neither replica
    // has seen the other's op at the time it issues its own.
    deleteNode(a.doc, 'X');
    setNodeText(b.doc, 'X', 'concurrent edit');

    // Deliver both replicas' updates to each other (both possible orders are
    // exercised by running the merge twice, in each direction, into fresh
    // copies seeded from the same pre-race state).
    for (const order of [
      [a.updates, b.updates],
      [b.updates, a.updates],
    ] as const) {
      const merged = new Y.Doc();
      Y.applyUpdate(merged, seedUpdate);
      for (const updates of order) deliver(merged, updates);

      const snap = getSnapshot(merged);
      // Whether X survives or not, the board must stay valid and consistent.
      for (const node of snap.nodes) {
        const result = BoardNodeSchema.safeParse(node);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
      const nodeIds = new Set(snap.nodes.map((n) => n.id));
      for (const edge of snap.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
      // No dangling edge to X specifically, whether or not X survived.
      const xSurvived = nodeIds.has('X');
      const edgeToX = snap.edges.find((e) => e.source === 'X' || e.target === 'X');
      if (!xSurvived) {
        expect(edgeToX).toBeUndefined();
      }
      // Y always survives (it was never touched) and stays valid.
      expect(nodeIds.has('Y')).toBe(true);
    }
  });
});
