import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { BoardEdge, BoardNode, DrawingNode, StickyNode } from '../model/board.js';
import {
  makeTextNode,
  makeShapeNode,
  makeFrameNode,
  makeEmojiNode,
  makeIconNode,
  makeDrawingNode,
  makeEdge,
} from '../board-io.js';
import { EDGE_DATA, NODE_DATA, NODE_TEXTS } from './schema.js';
import {
  LOCAL_ORIGIN,
  addNode,
  updateNode,
  moveNode,
  deleteNode,
  setNodeText,
  addEdge,
  updateEdge,
  deleteEdge,
  addDrawing,
  getSnapshot,
  loadBoardIntoDoc,
} from './ops.js';

// A sticky carrying text at construction time. Built as a narrow StickyNode so
// setting `text` doesn't trip the BoardNode union's excess-property check.
function stickyWithText(
  id: string,
  pos: { x: number; y: number },
  order: number,
  text: string,
): StickyNode {
  return {
    id,
    type: 'sticky',
    pos,
    order,
    size: { width: 200, height: 160 },
    text,
    color: '#fef3c7',
  };
}

function findNode(doc: Y.Doc, id: string): BoardNode | undefined {
  return getSnapshot(doc).nodes.find((n) => n.id === id);
}
function findEdge(doc: Y.Doc, id: string): BoardEdge | undefined {
  return getSnapshot(doc).edges.find((e) => e.id === id);
}

describe('addNode / getSnapshot', () => {
  it('stores a sticky node and reconstructs it with text merged in', () => {
    const doc = new Y.Doc();
    const node = stickyWithText('s1', { x: 10, y: 20 }, 0, 'Hello');
    addNode(doc, node);

    expect(findNode(doc, 's1')).toEqual(node);
  });

  it('stores a frame title in nodeTexts, not as text in nodeData', () => {
    const doc = new Y.Doc();
    const frame = makeFrameNode('f1', { x: 0, y: 0 }, 0);
    addNode(doc, frame);

    expect(doc.getMap(NODE_TEXTS).get('f1')).toBe('Frame');
    expect(doc.getMap(NODE_DATA).get('f1')).not.toHaveProperty('title');
    const reconstructed = findNode(doc, 'f1');
    expect(reconstructed).toEqual(frame);
    if (reconstructed?.type === 'frame') expect(reconstructed.title).toBe('Frame');
  });

  it('does not create a nodeTexts entry for icon/drawing', () => {
    const doc = new Y.Doc();
    addNode(doc, makeIconNode('i1', { x: 0, y: 0 }, 0, 'star'));
    expect(doc.getMap(NODE_TEXTS).get('i1')).toBeUndefined();
  });

  it('getSnapshot returns every added node and edge', () => {
    const doc = new Y.Doc();
    const a = makeShapeNode('a', { x: 0, y: 0 }, 0, 'rect');
    const b = makeShapeNode('b', { x: 100, y: 0 }, 1, 'ellipse');
    addNode(doc, a);
    addNode(doc, b);
    addEdge(doc, makeEdge('e1', 'a', 'b'));

    const snap = getSnapshot(doc);
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
  });
});

describe('updateNode', () => {
  it('merges a patch without clobbering untouched fields', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    updateNode(doc, 'sh', { color: '#dbeafe' });

    const node = findNode(doc, 'sh');
    expect(node).toMatchObject({ color: '#dbeafe', shape: 'rect', pos: { x: 0, y: 0 } });
  });

  it('updates description independently of text', () => {
    const doc = new Y.Doc();
    addNode(doc, makeTextNode('t', { x: 0, y: 0 }, 0));
    updateNode(doc, 't', { description: 'Some **markdown**' });

    const node = findNode(doc, 't');
    expect(node).toMatchObject({ description: 'Some **markdown**' });
    if (node?.type === 'text') expect(node.text).toBe('Label');
  });

  it('is a no-op when patch is empty (does not touch nodeData)', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    const before = doc.getMap(NODE_DATA).get('sh');
    updateNode(doc, 'sh', {});
    expect(doc.getMap(NODE_DATA).get('sh')).toBe(before);
  });

  it('throws on a cross-variant patch and does NOT write it', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    const before = doc.getMap(NODE_DATA).get('sh');

    // `name` + `points` belong to icon/drawing, not shape — a malformed merge.
    expect(() =>
      updateNode(doc, 'sh', { name: 'star', points: [{ x: 0, y: 0 }] } as never),
    ).toThrow(/invalid/i);

    // The doc is unchanged — the failed transaction wrote nothing.
    expect(doc.getMap(NODE_DATA).get('sh')).toBe(before);
    expect(findNode(doc, 'sh')).toMatchObject({ type: 'shape', shape: 'rect' });
  });

  it('accepts a valid same-variant patch and merges granularly', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    updateNode(doc, 'sh', { color: '#dbeafe', rotation: 90 });

    const node = findNode(doc, 'sh');
    expect(node).toMatchObject({ color: '#dbeafe', rotation: 90, shape: 'rect' });
  });
});

describe('moveNode', () => {
  it('updates position and leaves other fields intact', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    moveNode(doc, 'sh', { x: 42, y: 99 });

    const node = findNode(doc, 'sh');
    expect(node?.pos).toEqual({ x: 42, y: 99 });
    if (node?.type === 'shape') expect(node.shape).toBe('rect');
  });

  it('is a no-op for a node that does not exist', () => {
    const doc = new Y.Doc();
    expect(() => moveNode(doc, 'missing', { x: 1, y: 1 })).not.toThrow();
  });
});

describe('deleteNode', () => {
  it('removes both the node data and its text entry', () => {
    const doc = new Y.Doc();
    addNode(doc, stickyWithText('s', { x: 0, y: 0 }, 0, 'x'));
    deleteNode(doc, 's');
    expect(findNode(doc, 's')).toBeUndefined();
    expect(doc.getMap(NODE_TEXTS).get('s')).toBeUndefined();
  });

  it('prunes every edge touching the deleted node, in the same transaction', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('a', { x: 0, y: 0 }, 0, 'rect'));
    addNode(doc, makeShapeNode('b', { x: 100, y: 0 }, 1, 'rect'));
    addNode(doc, makeShapeNode('c', { x: 200, y: 0 }, 2, 'rect'));
    addEdge(doc, makeEdge('e-ab', 'a', 'b')); // touches a (source)
    addEdge(doc, makeEdge('e-ca', 'c', 'a')); // touches a (target)
    addEdge(doc, makeEdge('e-bc', 'b', 'c')); // does not touch a

    deleteNode(doc, 'a');

    // The raw edgeData map — not getSnapshot — proves orphans are physically gone.
    const remainingIds = Array.from(doc.getMap(EDGE_DATA).keys()).sort();
    expect(remainingIds).toEqual(['e-bc']);
  });
});

describe('setNodeText', () => {
  it('sets text without touching the nodeData SyncShape', () => {
    const doc = new Y.Doc();
    addNode(doc, stickyWithText('s', { x: 0, y: 0 }, 0, 'old'));
    const shapeBefore = doc.getMap(NODE_DATA).get('s');

    setNodeText(doc, 's', 'new');

    const node = findNode(doc, 's');
    if (node?.type === 'sticky') {
      expect(node.text).toBe('new');
      expect(node.color).toBe('#fef3c7');
    }
    // The SyncShape reference in nodeData is untouched.
    expect(doc.getMap(NODE_DATA).get('s')).toBe(shapeBefore);
  });
});

// Endpoints for edge tests — getSnapshot now prunes edges whose source/target
// isn't a live node, so edges need real nodes to survive the snapshot.
function seedEndpoints(doc: Y.Doc): void {
  addNode(doc, makeShapeNode('a', { x: 0, y: 0 }, 0, 'rect'));
  addNode(doc, makeShapeNode('b', { x: 100, y: 0 }, 1, 'rect'));
}

describe('edge ops', () => {
  it('addEdge stores an edge and updateEdge merges a patch', () => {
    const doc = new Y.Doc();
    seedEndpoints(doc);
    addEdge(doc, makeEdge('e', 'a', 'b'));

    expect(findEdge(doc, 'e')).toMatchObject({
      id: 'e',
      source: 'a',
      target: 'b',
      style: 'solid',
      kind: 'arrow',
      arrow: 'end',
    });

    updateEdge(doc, 'e', { label: 'flows to' });
    const edge = findEdge(doc, 'e');
    expect(edge?.label).toBe('flows to');
    expect(edge?.source).toBe('a'); // untouched fields survive the merge
  });

  it('deleteEdge removes it from the snapshot', () => {
    const doc = new Y.Doc();
    seedEndpoints(doc);
    addEdge(doc, makeEdge('e', 'a', 'b'));
    deleteEdge(doc, 'e');
    expect(getSnapshot(doc).edges).toHaveLength(0);
  });

  it('updateEdge is a no-op for a missing edge', () => {
    const doc = new Y.Doc();
    expect(() => updateEdge(doc, 'missing', { label: 'x' })).not.toThrow();
    expect(getSnapshot(doc).edges).toHaveLength(0);
  });
});

describe('getSnapshot self-consistency', () => {
  it('drops a dangling edge whose endpoint is not a live node', () => {
    const doc = new Y.Doc();
    addNode(doc, makeShapeNode('a', { x: 0, y: 0 }, 0, 'rect'));
    // Edge to a non-existent 'ghost' — e.g. its target node was concurrently
    // deleted by another peer but the edge write hasn't been pruned yet.
    addEdge(doc, makeEdge('e', 'a', 'ghost'));
    // A well-formed edge between two live nodes survives.
    addNode(doc, makeShapeNode('b', { x: 100, y: 0 }, 1, 'rect'));
    addEdge(doc, makeEdge('e-ok', 'a', 'b'));

    const snap = getSnapshot(doc);
    expect(snap.edges.map((e) => e.id)).toEqual(['e-ok']);
    // Raw edgeData still holds the dangling edge — getSnapshot only filters the
    // read; it doesn't mutate the doc.
    expect(doc.getMap(EDGE_DATA).has('e')).toBe(true);
  });
});

describe('addDrawing', () => {
  it('stores a drawing node with padded bbox and rebased points', () => {
    const doc = new Y.Doc();
    const strokeWidth = 3;
    const node = makeDrawingNode(
      'd1',
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 40 },
      ],
      0,
      '#123456',
      strokeWidth,
    ) as DrawingNode;
    addDrawing(doc, node);

    const stored = findNode(doc, 'd1');
    expect(stored).toEqual(node);
    if (stored?.type === 'drawing') {
      expect(stored.pos).toEqual({ x: 10 - strokeWidth, y: 10 - strokeWidth });
      expect(stored.size).toEqual({
        width: 50 - 10 + strokeWidth * 2,
        height: 40 - 10 + strokeWidth * 2,
      });
    }
    // Drawings carry no editable text.
    expect(doc.getMap(NODE_TEXTS).get('d1')).toBeUndefined();
  });
});

describe('origins', () => {
  it('tags mutations with LOCAL_ORIGIN by default', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => origins.push(txn.origin));
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'));
    expect(origins).toContain(LOCAL_ORIGIN);
  });

  it('passes a caller-supplied origin through to the transaction', () => {
    const doc = new Y.Doc();
    const origin = Symbol('remote-ish');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => origins.push(txn.origin));
    moveNode(doc, 'nope', { x: 1, y: 1 }, origin); // no-op body still transacts
    addNode(doc, makeShapeNode('sh', { x: 0, y: 0 }, 0, 'rect'), origin);
    expect(origins).toContain(origin);
  });
});

describe('loadBoardIntoDoc + getSnapshot round-trip', () => {
  const nodes: BoardNode[] = [
    stickyWithText('s', { x: 1, y: 2 }, 0, 'sticky text'),
    makeTextNode('t', { x: 3, y: 4 }, 1),
    makeShapeNode('sh', { x: 5, y: 6 }, 2, 'diamond'),
    makeFrameNode('f', { x: 7, y: 8 }, 3),
    makeEmojiNode('em', { x: 9, y: 10 }, 4, '🚀'),
    makeIconNode('ic', { x: 11, y: 12 }, 5, 'gear'),
    makeDrawingNode(
      'dr',
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      6,
    ),
  ];
  const edges: BoardEdge[] = [makeEdge('e1', 's', 't'), makeEdge('e2', 'sh', 'f')];

  it('returns the same nodes and edges (set-equal, ignoring order)', () => {
    const doc = new Y.Doc();
    loadBoardIntoDoc(doc, { nodes, edges });

    const snap = getSnapshot(doc);
    const byId = (arr: { id: string }[]) => new Map(arr.map((x) => [x.id, x]));

    const gotNodes = byId(snap.nodes);
    expect(snap.nodes).toHaveLength(nodes.length);
    for (const n of nodes) expect(gotNodes.get(n.id)).toEqual(n);

    const gotEdges = byId(snap.edges);
    expect(snap.edges).toHaveLength(edges.length);
    for (const e of edges) expect(gotEdges.get(e.id)).toEqual(e);
  });

  it('clears any prior content so a reload does not leave stale nodes', () => {
    const doc = new Y.Doc();
    loadBoardIntoDoc(doc, { nodes, edges });
    loadBoardIntoDoc(doc, {
      nodes: [makeTextNode('only', { x: 0, y: 0 }, 0)],
      edges: [],
    });

    const snap = getSnapshot(doc);
    expect(snap.nodes.map((n) => n.id)).toEqual(['only']);
    expect(snap.edges).toHaveLength(0);
    expect(doc.getMap(NODE_TEXTS).get('s')).toBeUndefined();
  });
});
