import { describe, it, expect } from 'vitest';
import { NODE_DATA, NODE_TEXTS, EDGE_DATA, ANNOTATIONS } from './schema.js';

describe('map/array name constants', () => {
  it('match the legacy Y.Map / Y.Array names exactly (byte-compat with existing rooms)', () => {
    expect(NODE_DATA).toBe('nodeData');
    expect(NODE_TEXTS).toBe('nodeTexts');
    expect(EDGE_DATA).toBe('edgeData');
    expect(ANNOTATIONS).toBe('annotations');
  });
});
