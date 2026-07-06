// edgeTypes: the ReactFlow edge-type registry BoardCanvas (P3-T20) passes to
// <ReactFlow edgeTypes={edgeTypes} />. Keyed by the RF edge `type` string
// rf-adapters.ts's `boardEdgeToRf` assigns ('arrow' | 'cardinality').

import { describe, expect, it } from 'vitest';
import { edgeTypes } from './index.js';

describe('edgeTypes', () => {
  it('has an entry for "arrow" and "cardinality"', () => {
    expect(edgeTypes.arrow).toBeDefined();
    expect(edgeTypes.cardinality).toBeDefined();
  });

  it('has exactly 2 entries (no extras, no gaps)', () => {
    expect(Object.keys(edgeTypes)).toHaveLength(2);
  });
});
