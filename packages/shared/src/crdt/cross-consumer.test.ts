// ── T6 Deliverable A — cross-consumer round-trip ────────────────────────────
//
// The #1 correctness guarantee of the rewrite: the browser client (which
// bulk-loads a board via `loadBoardIntoDoc`) and the MCP server (which issues
// granular ops one at a time — addNode/setNodeText/addEdge/...) MUST produce
// IDENTICAL Y.Doc state for the same logical board. If they ever silently
// diverge, multiplayer sync corrupts boards without anyone noticing.
//
// This test builds one board covering all 7 node types + several edge
// variations, loads it into two independent Y.Docs via the two different
// write paths, and asserts the results are byte-identical at every level:
// canonical serialise() string, raw Y.Map contents, and schema validity.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { BoardEdge, BoardFile, BoardNode, ShapeNode, StickyNode } from '../model/board.js';
import { FORMAT_VERSION } from '../model/constants.js';
import { BoardEdgeSchema, BoardNodeSchema } from '../model/schema.js';
import { serialise } from '../board-io.js';
import { EDGE_DATA, NODE_DATA, NODE_TEXTS } from './schema.js';
import { syncShapeEqual } from './accessors.js';
import { addEdge, addNode, getSnapshot, loadBoardIntoDoc, setNodeText } from './ops.js';

/** Wrap a {nodes, edges} snapshot into a full BoardFile so `serialise` applies. */
function assembleBoardFile(snapshot: { nodes: BoardNode[]; edges: BoardEdge[] }): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: 'Cross-consumer fixture',
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// A sticky carrying text at construction (built as a narrow StickyNode so
// setting `text`/`description` doesn't trip the BoardNode union's excess-
// property check — same pattern as ops.test.ts).
function stickyWithText(
  id: string,
  pos: { x: number; y: number },
  order: number,
  text: string,
  description?: string,
): StickyNode {
  return {
    id,
    type: 'sticky',
    pos,
    order,
    size: { width: 200, height: 160 },
    text,
    color: '#fef3c7',
    ...(description !== undefined ? { description } : {}),
  };
}

function shapeWithoutText(id: string, pos: { x: number; y: number }, order: number): ShapeNode {
  return {
    id,
    type: 'shape',
    pos,
    order,
    size: { width: 160, height: 100 },
    shape: 'diamond',
    color: '#e2e8f0',
    // deliberately no `text` — a text-less shape.
  };
}

// ── The fixture board: all 7 node types, some with `description`, an
// empty-text sticky, a text-less shape, plus several edge variations. ────────

const nodes: BoardNode[] = [
  stickyWithText('sticky-1', { x: 0, y: 0 }, 0, 'Sticky note text', 'a description'),
  stickyWithText('sticky-empty', { x: 20, y: 0 }, 1, ''), // empty-text sticky
  {
    id: 'text-1',
    type: 'text',
    pos: { x: 40, y: 0 },
    order: 2,
    text: 'A label',
    description: 'text node description',
  },
  shapeWithoutText('shape-no-text', { x: 60, y: 0 }, 3), // text-less shape
  {
    id: 'shape-1',
    type: 'shape',
    pos: { x: 80, y: 0 },
    order: 4,
    size: { width: 160, height: 100 },
    shape: 'hexagon',
    text: 'Shape label',
    color: '#dbeafe',
    rotation: 45,
  },
  {
    id: 'frame-1',
    type: 'frame',
    pos: { x: 100, y: 0 },
    order: 5,
    size: { width: 480, height: 320 },
    title: 'Frame title',
    color: '#fef3c7',
    description: 'frame description',
  },
  {
    id: 'emoji-1',
    type: 'emoji',
    pos: { x: 120, y: 0 },
    order: 6,
    text: '🚀',
    size: 64,
    rotation: 15,
  },
  {
    id: 'icon-1',
    type: 'icon',
    pos: { x: 140, y: 0 },
    order: 7,
    name: 'gear',
    size: 48,
    color: '#1e293b',
  },
  {
    id: 'drawing-1',
    type: 'drawing',
    pos: { x: 160, y: 0 },
    order: 8,
    size: { width: 60, height: 60 },
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
      { x: 60, y: 0 },
    ],
    color: '#1e293b',
    strokeWidth: 3,
  },
];

const edges: BoardEdge[] = [
  // Plain arrow edge, default style.
  {
    id: 'edge-1',
    source: 'sticky-1',
    target: 'text-1',
    style: 'solid',
    kind: 'arrow',
    arrow: 'end',
  },
  // Dashed, both-arrowheads, with a label and explicit handles.
  {
    id: 'edge-2',
    source: 'shape-1',
    target: 'frame-1',
    style: 'dashed',
    kind: 'arrow',
    arrow: 'both',
    label: 'relates to',
    sourceHandle: 'right',
    targetHandle: 'left',
  },
  // Arrow with no arrowhead.
  {
    id: 'edge-3',
    source: 'emoji-1',
    target: 'icon-1',
    style: 'solid',
    kind: 'arrow',
    arrow: 'none',
  },
  // Cardinality edge (ER-style), with handles.
  {
    id: 'edge-4',
    source: 'shape-no-text',
    target: 'drawing-1',
    style: 'solid',
    kind: 'cardinality',
    cardinality: '1:N',
    sourceHandle: 'bottom',
    targetHandle: 'top',
  },
  // Cardinality N:N, no handles, with a label.
  {
    id: 'edge-5',
    source: 'sticky-empty',
    target: 'sticky-1',
    style: 'dashed',
    kind: 'cardinality',
    cardinality: 'N:N',
    label: 'many-to-many',
  },
];

/** Whatever text a node carries per the nodeText contract (frame→title, sticky/text/emoji/shape→text). */
function nodeTextOf(node: BoardNode): string | undefined {
  switch (node.type) {
    case 'frame':
      return node.title;
    case 'sticky':
    case 'text':
    case 'emoji':
      return node.text;
    case 'shape':
      return node.text;
    case 'icon':
    case 'drawing':
      return undefined;
  }
}

describe('cross-consumer round-trip: bulk load vs granular ops', () => {
  it('produces identical Y.Doc state via loadBoardIntoDoc and via granular ops', () => {
    // Path 1: client-style bulk load.
    const docA = new Y.Doc();
    loadBoardIntoDoc(docA, { nodes, edges });

    // Path 2: MCP-style granular ops — addNode per node (in order), then
    // setNodeText for nodes carrying text, then addEdge per edge. This is
    // exactly the op sequence a real MCP client issues: create the node bare,
    // then push its text/title in a follow-up call.
    const docB = new Y.Doc();
    for (const node of nodes) {
      addNode(docB, node);
    }
    for (const node of nodes) {
      const text = nodeTextOf(node);
      if (text !== undefined) setNodeText(docB, node.id, text);
    }
    for (const edge of edges) {
      addEdge(docB, edge);
    }

    const snapA = getSnapshot(docA);
    const snapB = getSnapshot(docB);

    const serialisedA = serialise(assembleBoardFile(snapA));
    const serialisedB = serialise(assembleBoardFile(snapB));

    expect(serialisedB).toBe(serialisedA);

    // ── Underlying Y.Maps: same keys, same values ─────────────────────────
    const ndmA = docA.getMap(NODE_DATA);
    const ndmB = docB.getMap(NODE_DATA);
    expect(new Set(ndmB.keys())).toEqual(new Set(ndmA.keys()));
    for (const key of ndmA.keys()) {
      expect(syncShapeEqual(ndmA.get(key), ndmB.get(key))).toBe(true);
    }

    const ntmA = docA.getMap(NODE_TEXTS);
    const ntmB = docB.getMap(NODE_TEXTS);
    expect(new Set(ntmB.keys())).toEqual(new Set(ntmA.keys()));
    for (const key of ntmA.keys()) {
      expect(ntmB.get(key)).toBe(ntmA.get(key));
    }

    const edmA = docA.getMap(EDGE_DATA);
    const edmB = docB.getMap(EDGE_DATA);
    expect(new Set(edmB.keys())).toEqual(new Set(edmA.keys()));
    for (const key of edmA.keys()) {
      expect(edmB.get(key)).toEqual(edmA.get(key));
    }
  });

  it('reconstructed nodes and edges (from both paths) validate against the T3 schemas', () => {
    const docA = new Y.Doc();
    loadBoardIntoDoc(docA, { nodes, edges });

    const docB = new Y.Doc();
    for (const node of nodes) addNode(docB, node);
    for (const node of nodes) {
      const text = nodeTextOf(node);
      if (text !== undefined) setNodeText(docB, node.id, text);
    }
    for (const edge of edges) addEdge(docB, edge);

    for (const doc of [docA, docB]) {
      const snap = getSnapshot(doc);
      expect(snap.nodes.length).toBe(nodes.length);
      expect(snap.edges.length).toBe(edges.length);
      for (const node of snap.nodes) {
        const result = BoardNodeSchema.safeParse(node);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
      for (const edge of snap.edges) {
        const result = BoardEdgeSchema.safeParse(edge);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
    }
  });

  it('also matches when the granular path adds edges before all node text is set', () => {
    // A slightly different, still-plausible MCP op ordering: add all nodes,
    // interleave text-setting and edge-adding rather than strictly batching
    // them. The end state must still match the bulk-load path exactly —
    // convergence must not depend on op ordering within a single replica.
    const docA = new Y.Doc();
    loadBoardIntoDoc(docA, { nodes, edges });

    const docC = new Y.Doc();
    for (const node of nodes) addNode(docC, node);
    for (const edge of edges) addEdge(docC, edge);
    for (const node of nodes) {
      const text = nodeTextOf(node);
      if (text !== undefined) setNodeText(docC, node.id, text);
    }

    expect(serialise(assembleBoardFile(getSnapshot(docC)))).toBe(
      serialise(assembleBoardFile(getSnapshot(docA))),
    );
  });
});
