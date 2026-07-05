import { describe, expect, it } from 'vitest';
import type {
  BoardFile,
  BoardNode,
  DrawingNode,
  EmojiNode,
  FrameNode,
  IconNode,
  ShapeNode,
  StickyNode,
  TextNode,
} from './board.js';
import {
  DEFAULT_EMOJI_SIZE,
  DEFAULT_FRAME_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STICKY_SIZE,
  FORMAT_VERSION,
  SHAPE_KINDS,
  STICKY_COLORS,
} from './constants.js';

describe('model constants', () => {
  it('has 6 sticky colors', () => {
    expect(STICKY_COLORS.length).toBe(6);
  });

  it('has 12 shape kinds', () => {
    expect(SHAPE_KINDS.length).toBe(12);
  });

  it('is at format version 1', () => {
    expect(FORMAT_VERSION).toBe(1);
  });
});

// Compile-time exhaustiveness guard: if a BoardNode variant is added or
// removed, this switch stops satisfying `never` in the default case and the
// build breaks. That's the point of the test — it fails to typecheck, not
// (only) at runtime.
function assertNever(x: never): never {
  throw new Error(`Unhandled node type: ${JSON.stringify(x)}`);
}

function describeNode(node: BoardNode): string {
  switch (node.type) {
    case 'sticky':
      return `sticky:${node.text}`;
    case 'text':
      return `text:${node.text}`;
    case 'shape':
      return `shape:${node.shape}`;
    case 'frame':
      return `frame:${node.title}`;
    case 'emoji':
      return `emoji:${node.text}`;
    case 'icon':
      return `icon:${node.name}`;
    case 'drawing':
      return `drawing:${node.points.length}`;
    default:
      return assertNever(node);
  }
}

describe('BoardNode variants', () => {
  const sticky: StickyNode = {
    id: 'n1',
    type: 'sticky',
    pos: { x: 0, y: 0 },
    order: 0,
    size: DEFAULT_STICKY_SIZE,
    text: 'hello',
    color: STICKY_COLORS[0],
  };

  const text: TextNode = {
    id: 'n2',
    type: 'text',
    pos: { x: 10, y: 10 },
    order: 1,
    text: 'a label',
  };

  const shape: ShapeNode = {
    id: 'n3',
    type: 'shape',
    pos: { x: 20, y: 20 },
    order: 2,
    size: DEFAULT_SHAPE_SIZE,
    shape: 'diamond',
    text: 'decision',
    color: '#1e293b',
    rotation: 0,
  };

  const frame: FrameNode = {
    id: 'n4',
    type: 'frame',
    pos: { x: 30, y: 30 },
    order: 3,
    size: DEFAULT_FRAME_SIZE,
    title: 'Section',
    color: '#1e293b',
  };

  const emoji: EmojiNode = {
    id: 'n5',
    type: 'emoji',
    pos: { x: 40, y: 40 },
    order: 4,
    text: '🎉',
    size: DEFAULT_EMOJI_SIZE,
  };

  const icon: IconNode = {
    id: 'n6',
    type: 'icon',
    pos: { x: 50, y: 50 },
    order: 5,
    name: 'star',
    size: DEFAULT_ICON_SIZE,
    color: '#1e293b',
  };

  const drawing: DrawingNode = {
    id: 'n7',
    type: 'drawing',
    pos: { x: 60, y: 60 },
    order: 6,
    size: { width: 100, height: 100 },
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    color: '#1e293b',
    strokeWidth: 3,
  };

  const nodes: BoardNode[] = [sticky, text, shape, frame, emoji, icon, drawing];

  it('constructs one literal of each of the 7 variants', () => {
    expect(nodes).toHaveLength(7);
  });

  it('exhausts the union without hitting the never guard', () => {
    const descriptions = nodes.map(describeNode);
    expect(descriptions).toEqual([
      'sticky:hello',
      'text:a label',
      'shape:diamond',
      'frame:Section',
      'emoji:🎉',
      'icon:star',
      'drawing:2',
    ]);
  });

  it('builds a BoardFile with formatVersion and per-node order', () => {
    const board: BoardFile = {
      formatVersion: FORMAT_VERSION,
      boardLabel: 'Test board',
      nodes,
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(board.formatVersion).toBe(1);
    expect(board.nodes.map((n) => n.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
