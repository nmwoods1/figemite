import { describe, expect, it } from 'vitest';
import type { BoardEdge, BoardFile, BoardNode, ShapeNode, WH } from './model/board.js';
import {
  DEFAULT_EMOJI_SIZE,
  DEFAULT_FRAME_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STICKY_SIZE,
  FORMAT_VERSION,
  STICKY_COLORS,
} from './model/constants.js';
import { isValidId } from './model/schema.js';
import {
  allNodeIds,
  boardHash,
  boardSignature,
  deserialise,
  emptyBoard,
  generateId,
  makeDrawingNode,
  makeEdge,
  makeEmojiNode,
  makeFrameNode,
  makeIconNode,
  makeShapeNode,
  makeStickyNode,
  makeTextNode,
  nextOrder,
  nextStickyColor,
  normalizeOrder,
  pruneEdgesForDeletedNodes,
  reorderLayers,
  serialise,
} from './board-io.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseBoard(): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: 'Test board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 100, height: 80 },
        text: 'hello',
        color: '#fef3c7',
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 's1',
        target: 's1',
        style: 'solid',
      },
    ],
    viewport: { x: 10, y: 20, zoom: 1 },
  };
}

const shape = (id: string, order: number): ShapeNode => ({
  id,
  type: 'shape',
  pos: { x: 0, y: 0 },
  order,
  size: { width: 10, height: 10 },
  shape: 'rect',
  color: '#e2e8f0',
});

const frame = (id: string, order: number): BoardNode => ({
  id,
  type: 'frame',
  pos: { x: 0, y: 0 },
  order,
  size: { width: 10, height: 10 },
  title: id,
  color: '#fef3c7',
});

// ── generateId ───────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('returns prefix + "1" when nothing exists yet', () => {
    expect(generateId('sticky', new Set())).toBe('sticky1');
  });

  it('skips ids that already exist', () => {
    const existing = new Set(['sticky1', 'sticky2', 'sticky3']);
    expect(generateId('sticky', existing)).toBe('sticky4');
  });

  it('fills a gap left by a deleted id only if it is the lowest free slot', () => {
    const existing = new Set(['node1', 'node3']);
    expect(generateId('node', existing)).toBe('node2');
  });

  it('produces an id that satisfies the id grammar', () => {
    const id = generateId('sticky', new Set());
    expect(isValidId(id)).toBe(true);
  });
});

// ── allNodeIds ───────────────────────────────────────────────────────────────

describe('allNodeIds', () => {
  it('collects every node id in the file', () => {
    const board = baseBoard();
    board.nodes.push(makeTextNode('t1', { x: 1, y: 1 }, 1));
    expect(allNodeIds(board)).toEqual(new Set(['s1', 't1']));
  });
});

// ── emptyBoard ───────────────────────────────────────────────────────────────

describe('emptyBoard', () => {
  it('creates an empty v1 board with the given label', () => {
    const board = emptyBoard('My board');
    expect(board).toEqual({
      formatVersion: FORMAT_VERSION,
      boardLabel: 'My board',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });
});

// ── Node factories ─────────────────────────────────────────────────────────

describe('node factories: order assignment', () => {
  it('makeStickyNode sets id, pos, order, and defaults', () => {
    const node = makeStickyNode('n1', { x: 1, y: 2 }, '#fef3c7', 5);
    expect(node).toEqual({
      id: 'n1',
      type: 'sticky',
      pos: { x: 1, y: 2 },
      order: 5,
      size: DEFAULT_STICKY_SIZE,
      text: '',
      color: '#fef3c7',
    });
  });

  it('makeStickyNode accepts an explicit size', () => {
    const node = makeStickyNode('n1', { x: 0, y: 0 }, '#fef3c7', 0, { width: 1, height: 2 });
    if (node.type !== 'sticky') throw new Error('expected sticky node');
    expect(node.size).toEqual({ width: 1, height: 2 });
  });

  it('makeTextNode sets order', () => {
    const node = makeTextNode('n2', { x: 10, y: 10 }, 3);
    expect(node).toEqual({
      id: 'n2',
      type: 'text',
      pos: { x: 10, y: 10 },
      order: 3,
      text: 'Label',
    });
  });

  it('makeShapeNode sets order and default size/color', () => {
    const node = makeShapeNode('n3', { x: 0, y: 0 }, 2, 'diamond');
    expect(node).toEqual({
      id: 'n3',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 2,
      size: DEFAULT_SHAPE_SIZE,
      shape: 'diamond',
      color: '#e2e8f0',
    });
  });

  it('makeEmojiNode sets order and default size', () => {
    const node = makeEmojiNode('n5', { x: 0, y: 0 }, 4, '🎉');
    expect(node).toEqual({
      id: 'n5',
      type: 'emoji',
      pos: { x: 0, y: 0 },
      order: 4,
      text: '🎉',
      size: DEFAULT_EMOJI_SIZE,
    });
  });

  it('makeIconNode sets order and defaults', () => {
    const node = makeIconNode('n6', { x: 0, y: 0 }, 6, 'star');
    expect(node).toEqual({
      id: 'n6',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 6,
      name: 'star',
      size: DEFAULT_ICON_SIZE,
      color: '#1e293b',
    });
  });

  it('makeFrameNode sets order and defaults', () => {
    const node = makeFrameNode('n4', { x: 0, y: 0 }, 1);
    expect(node).toEqual({
      id: 'n4',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 1,
      size: DEFAULT_FRAME_SIZE,
      title: 'Frame',
      color: '#fef3c7',
    });
  });

  it('makeDrawingNode sets order and computes a padded bounding box', () => {
    const strokeWidth = 3;
    const points = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 40 },
    ];
    const node = makeDrawingNode('d1', points, 7, '#123456', strokeWidth);

    expect(node.type).toBe('drawing');
    if (node.type !== 'drawing') throw new Error('expected drawing node');
    expect(node.order).toBe(7);

    // bbox is [10,10]..[50,40], padded by strokeWidth on each side.
    expect(node.pos).toEqual({ x: 10 - strokeWidth, y: 10 - strokeWidth });
    expect(node.size).toEqual({
      width: 50 - 10 + strokeWidth * 2,
      height: 40 - 10 + strokeWidth * 2,
    });

    // Points should be relative to node.pos.
    expect(node.points).toEqual([
      { x: 10 - node.pos.x, y: 10 - node.pos.y },
      { x: 50 - node.pos.x, y: 10 - node.pos.y },
      { x: 50 - node.pos.x, y: 40 - node.pos.y },
    ]);
    expect(node.color).toBe('#123456');
    expect(node.strokeWidth).toBe(strokeWidth);
  });

  it('makeDrawingNode defaults color and strokeWidth when omitted', () => {
    const node = makeDrawingNode('d2', [{ x: 0, y: 0 }], 0);
    if (node.type !== 'drawing') throw new Error('expected drawing node');
    expect(node.color).toBe('#1e293b');
    expect(node.strokeWidth).toBe(3);
  });

  it('makeDrawingNode handles a single point (zero-size bbox before padding)', () => {
    const node = makeDrawingNode('d3', [{ x: 5, y: 5 }], 0, '#000000', 2);
    if (node.type !== 'drawing') throw new Error('expected drawing node');
    expect(node.pos).toEqual({ x: 3, y: 3 });
    expect(node.size).toEqual({ width: 4, height: 4 });
    expect(node.points).toEqual([{ x: 2, y: 2 }]);
  });
});

// ── nextOrder ────────────────────────────────────────────────────────────────

describe('nextOrder', () => {
  it('returns 0 for an empty node list', () => {
    expect(nextOrder([])).toBe(0);
  });

  it('returns max(order) + 1', () => {
    const nodes = [shape('a', 0), shape('b', 5), shape('c', 2)];
    expect(nextOrder(nodes)).toBe(6);
  });
});

// ── normalizeOrder ───────────────────────────────────────────────────────────

describe('normalizeOrder', () => {
  it('assigns ascending order matching array position when already frames-first', () => {
    const nodes = [frame('f1', 10), shape('a', 20), shape('b', 30)];
    const result = normalizeOrder(nodes);
    expect(result.map((n) => n.id)).toEqual(['f1', 'a', 'b']);
    expect(result.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it('moves all frames before all non-frames regardless of input order', () => {
    const nodes = [shape('a', 0), frame('f1', 1), shape('b', 2), frame('f2', 3)];
    const result = normalizeOrder(nodes);
    expect(result.map((n) => n.id)).toEqual(['f1', 'f2', 'a', 'b']);
    expect(result.map((n) => n.order)).toEqual([0, 1, 2, 3]);
  });

  it('preserves relative order within each partition, sorted by existing order', () => {
    // Frames given out of order by existing `order` field; array position
    // differs from `order`. Partition should sort each group by `order` first.
    const f2 = frame('f2', 1);
    const f1 = frame('f1', 0);
    const b = shape('b', 3);
    const a = shape('a', 2);
    const result = normalizeOrder([f2, f1, b, a]);
    expect(result.map((n) => n.id)).toEqual(['f1', 'f2', 'a', 'b']);
    expect(result.map((n) => n.order)).toEqual([0, 1, 2, 3]);
  });

  it('does not mutate the input nodes', () => {
    const original = frame('f1', 99);
    const nodes = [original];
    const result = normalizeOrder(nodes);
    expect(original.order).toBe(99);
    expect(result[0]).not.toBe(original);
    expect(result[0].order).toBe(0);
  });

  it('handles an empty node list', () => {
    expect(normalizeOrder([])).toEqual([]);
  });
});

// ── pruneEdgesForDeletedNodes ────────────────────────────────────────────────

describe('pruneEdgesForDeletedNodes', () => {
  const edge = (id: string, source: string, target: string): BoardEdge => ({
    id,
    source,
    target,
    style: 'solid',
  });

  it('keeps edges whose endpoints both still exist', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const result = pruneEdgesForDeletedNodes(edges, new Set(['a', 'b', 'c']));
    expect(result).toHaveLength(2);
  });

  it('drops edges referencing a deleted node on either end', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')];
    const result = pruneEdgesForDeletedNodes(edges, new Set(['a', 'b']));
    expect(result.map((e) => e.id)).toEqual(['e1']);
  });
});

// ── nextStickyColor ──────────────────────────────────────────────────────────

describe('nextStickyColor', () => {
  it('cycles through the palette in order', () => {
    for (let i = 0; i < STICKY_COLORS.length; i++) {
      const current = STICKY_COLORS[i];
      const expected = STICKY_COLORS[(i + 1) % STICKY_COLORS.length];
      expect(nextStickyColor(current)).toBe(expected);
    }
  });

  it('wraps around from the last color back to the first', () => {
    const last = STICKY_COLORS[STICKY_COLORS.length - 1];
    expect(nextStickyColor(last)).toBe(STICKY_COLORS[0]);
  });
});

// ── makeEdge ─────────────────────────────────────────────────────────────────

describe('makeEdge', () => {
  it('defaults to a solid arrow edge with arrow style "end" and routing "bezier"', () => {
    const edge = makeEdge('e1', 'a', 'b');
    expect(edge).toEqual({
      id: 'e1',
      source: 'a',
      target: 'b',
      style: 'solid',
      kind: 'arrow',
      arrow: 'end',
      routing: 'bezier',
    });
  });

  it('builds a cardinality edge without an arrow field', () => {
    const edge = makeEdge('e2', 'a', 'b', 'dashed', 'cardinality', 'end', '1:1');
    expect(edge).toEqual({
      id: 'e2',
      source: 'a',
      target: 'b',
      style: 'dashed',
      kind: 'cardinality',
      cardinality: '1:1',
      routing: 'bezier',
    });
  });

  it('accepts an explicit routing, meaningful for either edge kind', () => {
    const arrowEdge = makeEdge('e3', 'a', 'b', 'solid', 'arrow', 'end', '1:N', 'elbow');
    expect(arrowEdge.routing).toBe('elbow');

    const cardinalityEdge = makeEdge(
      'e4',
      'a',
      'b',
      'solid',
      'cardinality',
      'end',
      '1:1',
      'straight',
    );
    expect(cardinalityEdge.routing).toBe('straight');
  });
});

// ── reorderLayers ────────────────────────────────────────────────────────────

describe('reorderLayers', () => {
  it('returns the same array when selection is empty', () => {
    const nodes = [shape('a', 0), shape('b', 1)];
    expect(reorderLayers(nodes, new Set(), 'front')).toBe(nodes);
  });

  it('moves selected non-frame nodes to the front (end of array) without disturbing frames', () => {
    const nodes = [frame('f1', 0), shape('a', 1), shape('b', 2), shape('c', 3)];
    const result = reorderLayers(nodes, new Set(['a']), 'front');
    expect(result.map((n) => n.id)).toEqual(['f1', 'b', 'c', 'a']);
  });

  it('moves selected nodes to the back (start of their partition)', () => {
    const nodes = [shape('a', 0), shape('b', 1), shape('c', 2)];
    const result = reorderLayers(nodes, new Set(['c']), 'back');
    expect(result.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('moves a selected node forward by one slot', () => {
    const nodes = [shape('a', 0), shape('b', 1), shape('c', 2)];
    const result = reorderLayers(nodes, new Set(['a']), 'forward');
    expect(result.map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('moves a selected node backward by one slot', () => {
    const nodes = [shape('a', 0), shape('b', 1), shape('c', 2)];
    const result = reorderLayers(nodes, new Set(['c']), 'backward');
    expect(result.map((n) => n.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps frames and non-frames in independent partitions so a shape never ends up behind a frame', () => {
    const nodes = [frame('f1', 0), frame('f2', 1), shape('a', 2), shape('b', 3)];
    const result = reorderLayers(nodes, new Set(['f1', 'a']), 'front');
    expect(result.map((n) => n.id)).toEqual(['f2', 'f1', 'b', 'a']);
  });

  it('does not touch a partition with no selected members', () => {
    const nodes = [frame('f1', 0), frame('f2', 1), shape('a', 2), shape('b', 3)];
    const result = reorderLayers(nodes, new Set(['a']), 'front');
    expect(result.map((n) => n.id)).toEqual(['f1', 'f2', 'b', 'a']);
  });

  it('reassigns order ascending by resulting array position (frames before non-frames)', () => {
    const nodes = [frame('f1', 0), shape('a', 1), shape('b', 2), shape('c', 3)];
    const result = reorderLayers(nodes, new Set(['a']), 'front');
    expect(result.map((n) => n.order)).toEqual([0, 1, 2, 3]);
    // Every frame's order is lower than every non-frame's order.
    const frameOrders = result.filter((n) => n.type === 'frame').map((n) => n.order);
    const nonFrameOrders = result.filter((n) => n.type !== 'frame').map((n) => n.order);
    expect(Math.max(...frameOrders)).toBeLessThan(Math.min(...nonFrameOrders));
  });

  it('produces consistent order after a backward move too', () => {
    const nodes = [frame('f1', 0), frame('f2', 1), shape('a', 2), shape('b', 3), shape('c', 4)];
    const result = reorderLayers(nodes, new Set(['c']), 'backward');
    expect(result.map((n) => n.id)).toEqual(['f1', 'f2', 'a', 'c', 'b']);
    expect(result.map((n) => n.order)).toEqual([0, 1, 2, 3, 4]);
  });
});

// ── serialise / deserialise ──────────────────────────────────────────────────

describe('serialise', () => {
  it('is deterministic and writer-independent: reordering nodes/edges arrays does not change the output', () => {
    const board = baseBoard();
    board.nodes.push(
      makeShapeNode('n2', { x: 5, y: 5 }, 1, 'diamond'),
      makeFrameNode('n3', { x: 9, y: 9 }, 2),
    );
    board.edges.push(makeEdge('e2', 'n2', 'n3'));

    const shuffled: BoardFile = {
      ...board,
      nodes: [board.nodes[2], board.nodes[0], board.nodes[1]],
      edges: [board.edges[1], board.edges[0]],
    };

    expect(serialise(board)).toBe(serialise(shuffled));
  });

  it('is independent of a WH size object’s key insertion order', () => {
    const forward = baseBoard();
    forward.nodes = [{ ...forward.nodes[0], size: { width: 60, height: 40 } } as BoardNode];

    const reversed = baseBoard();
    // Same logical size, but keys inserted height-first. The canonical
    // function must re-emit { width, height } regardless of producer order.
    reversed.nodes = [{ ...reversed.nodes[0], size: { height: 40, width: 60 } as WH } as BoardNode];

    expect(serialise(reversed)).toBe(serialise(forward));
  });

  it('changes when a node field changes', () => {
    const a = baseBoard();
    const b: BoardFile = { ...a, nodes: [{ ...a.nodes[0], text: 'changed' } as BoardNode] };
    expect(serialise(a)).not.toBe(serialise(b));
  });

  it('emits a fixed top-level key order', () => {
    const board = baseBoard();
    const parsed = JSON.parse(serialise(board));
    expect(Object.keys(parsed)).toEqual([
      'formatVersion',
      'boardLabel',
      'viewport',
      'nodes',
      'edges',
    ]);
  });

  it('sorts nodes ascending by order, then id as a stable tiebreak', () => {
    const board: BoardFile = {
      ...emptyBoard('x'),
      nodes: [shape('b', 0), shape('a', 0), frame('f', -1)],
    };
    const parsed = JSON.parse(serialise(board)) as BoardFile;
    expect(parsed.nodes.map((n) => n.id)).toEqual(['f', 'a', 'b']);
  });

  it('sorts edges ascending by id', () => {
    const board: BoardFile = {
      ...emptyBoard('x'),
      edges: [makeEdge('e2', 'a', 'b'), makeEdge('e1', 'a', 'b')],
    };
    const parsed = JSON.parse(serialise(board)) as BoardFile;
    expect(parsed.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('round-trips through deserialise unchanged in content', () => {
    const board = baseBoard();
    const result = deserialise(serialise(board));
    expect(result).toEqual(board);
  });

  it('round-trips a makeEdge-built edge with an explicit routing through serialise/deserialise', () => {
    const edge = makeEdge('e1', 'a', 'b', 'solid', 'arrow', 'end', '1:N', 'elbow');
    const board: BoardFile = { ...emptyBoard('x'), edges: [edge] };

    const result = deserialise(serialise(board));

    expect(result.edges[0]).toEqual(edge);
    expect(result.edges[0]?.routing).toBe('elbow');
  });

  it('omits the routing key entirely for an edge built without one (no `routing: undefined` noise)', () => {
    // Constructed as a plain object literal (not via makeEdge, which always
    // supplies a routing default) so this exercises normalizeEdge's
    // conditional-spread absent branch.
    const edge: BoardEdge = { id: 'e1', source: 'a', target: 'b', style: 'solid' };
    const board: BoardFile = { ...emptyBoard('x'), edges: [edge] };

    const parsed = JSON.parse(serialise(board));

    expect(parsed.edges[0]).not.toHaveProperty('routing');
  });
});

describe('deserialise', () => {
  it('validates and migrates a legacy v0 JSON string to a valid v1 BoardFile', () => {
    const legacy = {
      boardLabel: 'Legacy board',
      nodes: [
        { id: 'a', type: 'text', pos: { x: 0, y: 0 }, text: 'first' },
        { id: 'b', type: 'text', pos: { x: 1, y: 1 }, text: 'second' },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const result = deserialise(JSON.stringify(legacy));
    expect(result.formatVersion).toBe(FORMAT_VERSION);
    expect(result.nodes.map((n) => n.order)).toEqual([0, 1]);
  });

  it('throws on malformed JSON', () => {
    expect(() => deserialise('{not json')).toThrow();
  });

  it('throws on a structurally invalid board (via parseBoardFile)', () => {
    expect(() => deserialise(JSON.stringify({ nonsense: true }))).toThrow();
  });
});

// ── boardSignature ───────────────────────────────────────────────────────────

describe('boardSignature', () => {
  it('is the canonical serialise() output', () => {
    const board = baseBoard();
    expect(boardSignature(board)).toBe(serialise(board));
  });

  it('changes when nodes or edges change', () => {
    const a = baseBoard();
    const b: BoardFile = { ...a, nodes: [{ ...a.nodes[0], text: 'changed' } as BoardNode] };
    expect(boardSignature(a)).not.toBe(boardSignature(b));
  });

  it('is stable for identical content regardless of array order', () => {
    const a = baseBoard();
    a.nodes.push(makeShapeNode('n2', { x: 1, y: 1 }, 1, 'rect'));
    const b: BoardFile = { ...structuredClone(a), nodes: [...structuredClone(a).nodes].reverse() };
    expect(boardSignature(a)).toBe(boardSignature(b));
  });
});

// ── boardHash ────────────────────────────────────────────────────────────────

describe('boardHash', () => {
  it('is a number', () => {
    expect(typeof boardHash(baseBoard())).toBe('number');
  });

  it('is stable across array reorderings that do not change content', () => {
    const board = baseBoard();
    board.nodes.push(makeShapeNode('n2', { x: 1, y: 1 }, 1, 'rect'));
    board.edges.push(makeEdge('e2', 'n2', 's1'));

    const reordered: BoardFile = {
      ...board,
      nodes: [...board.nodes].reverse(),
      edges: [...board.edges].reverse(),
    };

    expect(boardHash(board)).toBe(boardHash(reordered));
  });

  it('changes when a node field changes', () => {
    const a = baseBoard();
    const b: BoardFile = { ...a, nodes: [{ ...a.nodes[0], text: 'changed' } as BoardNode] };
    expect(boardHash(a)).not.toBe(boardHash(b));
  });

  it('changes when an edge field changes', () => {
    const a = baseBoard();
    const b: BoardFile = { ...a, edges: [{ ...a.edges[0], style: 'dashed' as const }] };
    expect(boardHash(a)).not.toBe(boardHash(b));
  });

  it('is deterministic for identical content across separate calls', () => {
    const a = baseBoard();
    const b = structuredClone(baseBoard());
    expect(boardHash(a)).toBe(boardHash(b));
  });
});
