import { describe, it, expect } from 'vitest';
import type { BoardNode } from '../model/board.js';
import { nodeToSyncShape, nodeText, reconstructNode, syncShapeEqual } from './accessors.js';

// One literal of each of the 7 node types. These are the fixtures the
// round-trip invariant is proved over.
const sticky: BoardNode = {
  id: 'n-sticky',
  type: 'sticky',
  pos: { x: 10, y: 20 },
  order: 3,
  size: { width: 200, height: 160 },
  text: 'Hello',
  color: '#fef3c7',
};

const text: BoardNode = {
  id: 'n-text',
  type: 'text',
  pos: { x: 1, y: 2 },
  order: 0,
  text: 'Label',
};

const shape: BoardNode = {
  id: 'n-shape',
  type: 'shape',
  pos: { x: 5, y: 5 },
  order: 1,
  size: { width: 160, height: 100 },
  shape: 'rect',
  text: 'in shape',
  color: '#e2e8f0',
  rotation: 45,
};

// A shape WITHOUT its optional text — reconstruct must not resurrect a `text`
// key from an undefined `nodeText`.
const shapeNoText: BoardNode = {
  id: 'n-shape-notext',
  type: 'shape',
  pos: { x: 6, y: 6 },
  order: 2,
  size: { width: 160, height: 100 },
  shape: 'ellipse',
  color: '#e2e8f0',
};

const frame: BoardNode = {
  id: 'n-frame',
  type: 'frame',
  pos: { x: 0, y: 0 },
  order: 4,
  size: { width: 480, height: 320 },
  title: 'My Frame',
  color: '#ede9fe',
};

const emoji: BoardNode = {
  id: 'n-emoji',
  type: 'emoji',
  pos: { x: 9, y: 9 },
  order: 5,
  text: '🎉',
  size: 64,
};

const icon: BoardNode = {
  id: 'n-icon',
  type: 'icon',
  pos: { x: 3, y: 3 },
  order: 6,
  name: 'star',
  size: 48,
  color: '#1e293b',
};

const drawing: BoardNode = {
  id: 'n-drawing',
  type: 'drawing',
  pos: { x: 7, y: 8 },
  order: 7,
  size: { width: 40, height: 30 },
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 30 },
  ],
  color: '#123456',
  strokeWidth: 3,
};

const ALL: BoardNode[] = [sticky, text, shape, shapeNoText, frame, emoji, icon, drawing];

describe('nodeText', () => {
  it('returns title for a frame', () => {
    expect(nodeText(frame)).toBe('My Frame');
  });

  it('returns text for text-bearing nodes (sticky, text, emoji, shape)', () => {
    expect(nodeText(sticky)).toBe('Hello');
    expect(nodeText(text)).toBe('Label');
    expect(nodeText(emoji)).toBe('🎉');
    expect(nodeText(shape)).toBe('in shape');
  });

  it('returns undefined for a shape with no text', () => {
    expect(nodeText(shapeNoText)).toBeUndefined();
  });

  it('returns undefined for icon and drawing', () => {
    expect(nodeText(icon)).toBeUndefined();
    expect(nodeText(drawing)).toBeUndefined();
  });
});

describe('nodeToSyncShape', () => {
  it('strips text/title but keeps everything else including order', () => {
    const shape = nodeToSyncShape(sticky);
    expect(shape).not.toHaveProperty('text');
    expect(shape).toHaveProperty('order', 3);
    expect(shape).toHaveProperty('color', '#fef3c7');
    expect(shape).toHaveProperty('type', 'sticky');
  });

  it('strips title from a frame', () => {
    const shape = nodeToSyncShape(frame);
    expect(shape).not.toHaveProperty('title');
    expect(shape).toHaveProperty('order', 4);
  });

  it('does not mutate the input node', () => {
    const before = JSON.stringify(sticky);
    nodeToSyncShape(sticky);
    expect(JSON.stringify(sticky)).toBe(before);
  });
});

describe('round-trip invariant', () => {
  it.each(ALL.map((n) => [n.type + (n === shapeNoText ? '-notext' : ''), n] as const))(
    'reconstructNode(nodeToSyncShape(n), nodeText(n)) deep-equals n for %s',
    (_label, n) => {
      const rebuilt = reconstructNode(nodeToSyncShape(n), nodeText(n));
      expect(rebuilt).toEqual(n);
    },
  );

  it('order survives a nodeToSyncShape -> reconstructNode round-trip', () => {
    for (const n of ALL) {
      const rebuilt = reconstructNode(nodeToSyncShape(n), nodeText(n));
      expect(rebuilt.order).toBe(n.order);
    }
  });
});

describe('syncShapeEqual', () => {
  it('is true for structurally equal shapes', () => {
    expect(syncShapeEqual(nodeToSyncShape(sticky), nodeToSyncShape({ ...sticky }))).toBe(true);
  });

  it('is false when a field differs', () => {
    const moved = nodeToSyncShape({ ...sticky, pos: { x: 999, y: 999 } });
    expect(syncShapeEqual(nodeToSyncShape(sticky), moved)).toBe(false);
  });
});
