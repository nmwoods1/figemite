// nodeTypes: the ReactFlow node-type registry BoardCanvas (P3-T20) passes to
// <ReactFlow nodeTypes={nodeTypes} />. Every BoardNode['type'] discriminant
// (@figemite/shared) must have a matching entry here, keyed by that same string
// (matching rf-adapters.ts's `boardNodeToRf`, which sets RF `type` to the
// board node's own `type`).

import { describe, expect, it } from 'vitest';
import type { BoardNode } from '@figemite/shared';
import { nodeTypes } from './index.js';

describe('nodeTypes', () => {
  it('has an entry for every BoardNode type', () => {
    const expectedTypes: BoardNode['type'][] = [
      'sticky',
      'text',
      'shape',
      'frame',
      'emoji',
      'icon',
      'drawing',
    ];
    for (const type of expectedTypes) {
      expect(nodeTypes[type]).toBeDefined();
    }
  });

  it('has exactly 7 entries (no extras, no gaps)', () => {
    expect(Object.keys(nodeTypes)).toHaveLength(7);
  });
});
