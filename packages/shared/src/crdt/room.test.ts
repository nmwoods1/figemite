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

  it('inserts a ~<draftId> marker after the slug for a draft room', () => {
    expect(roomNameFor('spend', [], 'd1')).toBe('spend~d1');
    expect(roomNameFor('spend', ['NodeA'], 'd1')).toBe('spend~d1.NodeA');
    expect(roomNameFor('spend', ['NodeA', 'NodeB'], 'd1')).toBe('spend~d1.NodeA.NodeB');
  });

  it('omitting the draftId yields exactly the prod room name', () => {
    expect(roomNameFor('spend', ['NodeA'], undefined)).toBe('spend.NodeA');
  });
});
