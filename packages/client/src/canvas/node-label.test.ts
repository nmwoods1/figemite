// Ported from the original prototype's inline `descNodeLabel`
// computation (BoardCanvas.tsx): the DescriptionModal's header shows a
// human-readable label for whichever node's description is open — its own
// text/title where the node has one, falling back to its id.

import { describe, it, expect } from 'vitest';
import type { BoardNode } from '@figemite/shared';
import { nodeLabel } from './node-label.js';

describe('nodeLabel', () => {
  it("uses a sticky's text", () => {
    const node = {
      id: 's1',
      type: 'sticky',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 1, height: 1 },
      text: 'Buy milk',
      color: '#fff',
    } as BoardNode;
    expect(nodeLabel(node)).toBe('Buy milk');
  });

  it("uses a shape's text when present", () => {
    const node = {
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 1, height: 1 },
      shape: 'rect',
      text: 'Decision',
      color: '#fff',
    } as BoardNode;
    expect(nodeLabel(node)).toBe('Decision');
  });

  it("falls back to a shape's id when it has no text", () => {
    const node = {
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 1, height: 1 },
      shape: 'rect',
      color: '#fff',
    } as BoardNode;
    expect(nodeLabel(node)).toBe('sh1');
  });

  it("uses a frame's title", () => {
    const node = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 1, height: 1 },
      title: 'Phase 1',
      color: '#fff',
    } as BoardNode;
    expect(nodeLabel(node)).toBe('Phase 1');
  });

  it("uses a text node's text", () => {
    const node = {
      id: 't1',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 0,
      text: 'Label',
    } as BoardNode;
    expect(nodeLabel(node)).toBe('Label');
  });

  it("falls back to the node's id for emoji/icon/drawing", () => {
    const emoji = {
      id: 'e1',
      type: 'emoji',
      pos: { x: 0, y: 0 },
      order: 0,
      text: '🎉',
      size: 40,
    } as BoardNode;
    expect(nodeLabel(emoji)).toBe('e1');
  });

  it('returns an empty string for undefined (no node open)', () => {
    expect(nodeLabel(undefined)).toBe('');
  });
});
