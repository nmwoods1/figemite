import { describe, it, expect } from 'vitest';
import { roomNameFor } from './room.js';

describe('roomNameFor', () => {
  it('returns just the slug for the root board', () => {
    expect(roomNameFor('spend', [])).toBe('spend');
  });

  it('appends dot-joined path segments for a sub-board', () => {
    expect(roomNameFor('spend', ['NodeA'])).toBe('spend.NodeA');
  });

  it('supports nested sub-board paths', () => {
    expect(roomNameFor('spend', ['NodeA', 'NodeB'])).toBe('spend.NodeA.NodeB');
  });
});
