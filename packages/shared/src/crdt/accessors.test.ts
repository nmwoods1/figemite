import { describe, it, expect } from 'vitest';
import type { BoardNode } from '../model/board.js';
import { BoardNodeSchema } from '../model/schema.js';
import { NODE_DATA } from './schema.js';
import * as Y from 'yjs';
import { addNode, getSnapshot } from './ops.js';
import { nodeToSyncShape, nodeText, reconstructNode, syncShapeEqual } from './accessors.js';

// One literal of each of the 7 node types. These are the fixtures the
// round-trip invariant is proved over. This one also carries a `description` so
// the round-trip proves that optional field survives.
const sticky: BoardNode = {
  id: 'n-sticky',
  type: 'sticky',
  pos: { x: 10, y: 20 },
  order: 3,
  size: { width: 200, height: 160 },
  text: 'Hello',
  color: '#fef3c7',
  description: 'a described sticky',
};

// An empty-text sticky — the exact case the emoji/seeding reconciliation
// changed (nodeText now returns '' rather than being special-cased away).
const emptySticky: BoardNode = {
  id: 'n-sticky-empty',
  type: 'sticky',
  pos: { x: 0, y: 0 },
  order: 8,
  size: { width: 200, height: 160 },
  text: '',
  color: '#dbeafe',
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

const ALL: BoardNode[] = [
  sticky,
  emptySticky,
  text,
  shape,
  shapeNoText,
  frame,
  emoji,
  icon,
  drawing,
];

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

  it("returns '' (not undefined) for an empty-text sticky", () => {
    expect(nodeText(emptySticky)).toBe('');
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
  it.each(ALL.map((n) => [n.id, n] as const))(
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

  it("preserves the sticky's description across the round-trip", () => {
    const rebuilt = reconstructNode(nodeToSyncShape(sticky), nodeText(sticky));
    expect((rebuilt as { description?: string }).description).toBe('a described sticky');
  });
});

describe('reconstructNode is total for a torn read (no nodeTexts entry)', () => {
  // Seed nodeData ONLY (no nodeTexts) — the normal transient state while the two
  // maps replicate independently — and require the reconstruct to still validate
  // against the canonical schema.
  it.each([
    ['sticky', sticky],
    ['text', text],
    ['frame', frame],
    ['emoji', emoji],
  ] as const)('yields a schema-valid %s with empty required text/title', (_label, n) => {
    const doc = new Y.Doc();
    // Write the SyncShape directly, deliberately skipping the nodeTexts entry.
    doc.getMap(NODE_DATA).set(n.id, nodeToSyncShape(n));

    const snap = getSnapshot(doc);
    const rebuilt = snap.nodes.find((x) => x.id === n.id)!;
    expect(BoardNodeSchema.safeParse(rebuilt).success).toBe(true);
    if (rebuilt.type === 'frame') expect(rebuilt.title).toBe('');
    else if ('text' in rebuilt) expect((rebuilt as { text: string }).text).toBe('');
  });

  it('leaves a text-less shape with text still undefined (optional field)', () => {
    const doc = new Y.Doc();
    addNode(doc, shapeNoText);
    const rebuilt = getSnapshot(doc).nodes.find((x) => x.id === shapeNoText.id)!;
    expect(BoardNodeSchema.safeParse(rebuilt).success).toBe(true);
    expect((rebuilt as { text?: string }).text).toBeUndefined();
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

  it('is order-insensitive — reordered keys still compare equal (no spurious write)', () => {
    const base = { id: 'x', type: 'sticky', order: 1, color: '#fff', pos: { x: 1, y: 2 } };
    // Same content, keys built in a different order (as a `{ ...existing, ...patch }`
    // spread that moved `color` to the end would produce).
    const reordered = { pos: { x: 1, y: 2 }, type: 'sticky', id: 'x', order: 1, color: '#fff' };
    expect(syncShapeEqual(base, reordered)).toBe(true);
    // JSON.stringify would have said these differ — prove the equality is real.
    expect(JSON.stringify(base)).not.toBe(JSON.stringify(reordered));
  });

  it('compares nested objects and arrays structurally', () => {
    expect(syncShapeEqual({ points: [{ x: 1, y: 2 }] }, { points: [{ x: 1, y: 2 }] })).toBe(true);
    expect(syncShapeEqual({ points: [{ x: 1, y: 2 }] }, { points: [{ x: 1, y: 3 }] })).toBe(false);
    expect(syncShapeEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
