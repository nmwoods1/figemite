import { describe, it, expect } from 'vitest';
import { colorForName, CURSOR_COLORS } from './color.js';

describe('colorForName', () => {
  it('is deterministic — the same seed always maps to the same color', () => {
    const seeds = ['Nick', 'Will', 'Sarah', 'AI', 'Cursor AI'];
    for (const seed of seeds) {
      expect(colorForName(seed)).toBe(colorForName(seed));
    }
  });

  it('only ever returns a color from the fixed palette', () => {
    const names = ['a', 'b', 'c', 'Nick Woods', 'x'.repeat(50), ''];
    for (const name of names) {
      expect(CURSOR_COLORS).toContain(colorForName(name));
    }
  });

  it('distributes different names across more than one color', () => {
    const names = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i));
    const colors = new Set(names.map(colorForName));
    expect(colors.size).toBeGreaterThan(1);
  });
});
