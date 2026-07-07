// ── Tool → shared-op wiring tests ────────────────────────────────────────────
//
// Drives the node/edge tool functions directly against a real in-memory
// Y.Doc (via a BoardPeer built with a fake, non-networked provider) — no MCP
// transport, no real websocket. Proves each tool calls the correct
// `@easel/shared` crdt op with the right arguments, and that reads
// (getBoard/getNode/listNodes) reflect the writes.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { getSnapshot } from '@easel/shared';
import { BoardPeer, type ProviderFactory } from './peer.js';
import { FakeAwareness } from './test/fake-awareness.js';
import {
  getBoard,
  getNode,
  listNodes,
  addNode,
  updateNode,
  moveNode,
  deleteNode,
  setNodeText,
  addDrawing,
  setDescription,
  addEdge,
  updateEdge,
  deleteEdge,
} from './tools.js';

class FakeProvider {
  synced = true;
  awareness = new FakeAwareness();
  constructor(
    public serverUrl: string,
    public roomname: string,
    public doc: Y.Doc,
  ) {}
  on(): void {}
  off(): void {}
  destroy(): void {}
}

const makeFakeProvider: ProviderFactory = ((wsUrl: string, roomname: string, doc: Y.Doc) =>
  new FakeProvider(wsUrl, roomname, doc)) as unknown as ProviderFactory;

function makeTestPeer(): BoardPeer {
  return new BoardPeer({
    wsUrl: 'ws://localhost:5400/yjs',
    slug: 'spend',
    name: 'AI',
    makeProvider: makeFakeProvider,
  });
}

describe('addNode', () => {
  it('creates a sticky node with an auto-generated id and returns it', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'sticky', pos: { x: 10, y: 20 }, color: '#fef3c7' });

    expect(id).toBeTruthy();
    const { nodes } = getSnapshot(peer.doc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id, type: 'sticky', pos: { x: 10, y: 20 }, color: '#fef3c7' });
  });

  it('uses a caller-supplied id when given', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'text', pos: { x: 0, y: 0 }, id: 'my-node' });
    expect(id).toBe('my-node');
  });

  it('assigns increasing order (z-index) to successive nodes', () => {
    const peer = makeTestPeer();
    const id1 = addNode(peer, { type: 'text', pos: { x: 0, y: 0 } });
    const id2 = addNode(peer, { type: 'text', pos: { x: 1, y: 1 } });
    const { nodes } = getSnapshot(peer.doc);
    const n1 = nodes.find((n) => n.id === id1)!;
    const n2 = nodes.find((n) => n.id === id2)!;
    expect(n2.order).toBeGreaterThan(n1.order);
  });

  it('creates a shape node with the shape kind and default size', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'shape', pos: { x: 0, y: 0 }, shape: 'diamond' });
    const node = getNode(peer, id);
    expect(node).toMatchObject({ type: 'shape', shape: 'diamond' });
  });

  it('creates a frame node using title as its text', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'frame', pos: { x: 0, y: 0 }, title: 'My Frame' });
    const node = getNode(peer, id) as { title?: string };
    expect(node?.title).toBe('My Frame');
  });

  it('creates an emoji node with text as the glyph', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'emoji', pos: { x: 0, y: 0 }, text: '🎉' });
    const node = getNode(peer, id) as { text?: string };
    expect(node?.text).toBe('🎉');
  });

  it('creates an icon node with name/size/color', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'icon', pos: { x: 0, y: 0 }, name: 'star', color: '#111' });
    const node = getNode(peer, id) as { name?: string; color?: string };
    expect(node?.name).toBe('star');
    expect(node?.color).toBe('#111');
  });

  it('applies a description when given', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'text', pos: { x: 0, y: 0 }, description: 'hello' });
    const node = getNode(peer, id) as { description?: string };
    expect(node?.description).toBe('hello');
  });

  it('throws for an unknown node type', () => {
    const peer = makeTestPeer();
    expect(() => addNode(peer, { type: 'bogus', pos: { x: 0, y: 0 } })).toThrow();
  });
});

describe('getBoard / getNode / listNodes', () => {
  it('getBoard reflects nodes and edges added via ops', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 100, y: 0 } });
    addEdge(peer, { source: a, target: b });

    const board = getBoard(peer);
    expect(board.nodes).toHaveLength(2);
    expect(board.edges).toHaveLength(1);
  });

  it('getNode returns null for a missing id', () => {
    const peer = makeTestPeer();
    expect(getNode(peer, 'nope')).toBeNull();
  });

  it('listNodes filters by type', () => {
    const peer = makeTestPeer();
    addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    addNode(peer, { type: 'text', pos: { x: 0, y: 0 } });
    const stickies = listNodes(peer, 'sticky');
    expect(stickies).toHaveLength(1);
    expect(stickies[0].type).toBe('sticky');
  });

  it('listNodes with no filter returns everything', () => {
    const peer = makeTestPeer();
    addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    addNode(peer, { type: 'text', pos: { x: 0, y: 0 } });
    expect(listNodes(peer)).toHaveLength(2);
  });
});

describe('updateNode / moveNode / deleteNode / setNodeText', () => {
  it('updateNode merges a patch into the node', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 }, color: '#fef3c7' });
    updateNode(peer, id, { color: '#dbeafe' });
    expect((getNode(peer, id) as { color?: string })?.color).toBe('#dbeafe');
  });

  it('moveNode updates only the position', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    moveNode(peer, id, { x: 42, y: 99 });
    expect((getNode(peer, id) as { pos?: { x: number; y: number } })?.pos).toEqual({
      x: 42,
      y: 99,
    });
  });

  it('deleteNode removes the node from the board', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    deleteNode(peer, id);
    expect(getNode(peer, id)).toBeNull();
  });

  it('deleteNode also removes edges touching the node', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const edgeId = addEdge(peer, { source: a, target: b });
    deleteNode(peer, a);
    expect(getBoard(peer).edges.find((e) => e.id === edgeId)).toBeUndefined();
  });

  it('setNodeText sets the text field without touching other fields', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 }, color: '#fef3c7' });
    setNodeText(peer, id, 'hello world');
    const node = getNode(peer, id) as { text?: string; color?: string };
    expect(node?.text).toBe('hello world');
    expect(node?.color).toBe('#fef3c7');
  });

  it('setNodeText sets a frame title', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'frame', pos: { x: 0, y: 0 } });
    setNodeText(peer, id, 'New Title');
    expect((getNode(peer, id) as { title?: string })?.title).toBe('New Title');
  });
});

describe('setDescription', () => {
  it('sets the description field via updateNode semantics', () => {
    const peer = makeTestPeer();
    const id = addNode(peer, { type: 'text', pos: { x: 0, y: 0 } });
    setDescription(peer, id, '# Notes\nSome markdown');
    expect((getNode(peer, id) as { description?: string })?.description).toBe(
      '# Notes\nSome markdown',
    );
  });
});

describe('addDrawing', () => {
  it('builds a drawing node from absolute points via makeDrawingNode', () => {
    const peer = makeTestPeer();
    const id = addDrawing(peer, {
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 30 },
      ],
    });
    const node = getNode(peer, id) as {
      type: string;
      pos: { x: number; y: number };
      points: { x: number; y: number }[];
      color: string;
      strokeWidth: number;
    };
    expect(node.type).toBe('drawing');
    // Bbox padded by strokeWidth (default 3): minX=10-3=7, minY=10-3=7.
    expect(node.pos).toEqual({ x: 7, y: 7 });
    expect(node.color).toBe('#1e293b');
    expect(node.strokeWidth).toBe(3);
  });

  it('respects a custom color and strokeWidth', () => {
    const peer = makeTestPeer();
    const id = addDrawing(peer, {
      points: [{ x: 0, y: 0 }],
      color: '#7c3aed',
      strokeWidth: 5,
    });
    const node = getNode(peer, id) as { color: string; strokeWidth: number };
    expect(node.color).toBe('#7c3aed');
    expect(node.strokeWidth).toBe(5);
  });

  it('throws when given zero points', () => {
    const peer = makeTestPeer();
    expect(() => addDrawing(peer, { points: [] })).toThrow();
  });
});

describe('addEdge / updateEdge / deleteEdge', () => {
  it('addEdge creates an edge with defaults', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const id = addEdge(peer, { source: a, target: b });
    const edge = getBoard(peer).edges.find((e) => e.id === id);
    expect(edge).toMatchObject({
      source: a,
      target: b,
      style: 'solid',
      kind: 'arrow',
      arrow: 'end',
    });
  });

  it('addEdge supports a cardinality edge', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const id = addEdge(peer, { source: a, target: b, kind: 'cardinality', cardinality: '1:N' });
    const edge = getBoard(peer).edges.find((e) => e.id === id);
    expect(edge).toMatchObject({ kind: 'cardinality', cardinality: '1:N' });
  });

  it('updateEdge merges a patch', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const id = addEdge(peer, { source: a, target: b });
    updateEdge(peer, id, { label: 'connects to' });
    const edge = getBoard(peer).edges.find((e) => e.id === id);
    expect(edge?.label).toBe('connects to');
  });

  it('deleteEdge removes the edge', () => {
    const peer = makeTestPeer();
    const a = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const b = addNode(peer, { type: 'sticky', pos: { x: 0, y: 0 } });
    const id = addEdge(peer, { source: a, target: b });
    deleteEdge(peer, id);
    expect(getBoard(peer).edges.find((e) => e.id === id)).toBeUndefined();
  });
});
