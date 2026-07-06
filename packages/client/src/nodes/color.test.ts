// Unifies the legacy's duplicated `hexToRgba` (StickyNode.tsx + FrameNode.tsx
// in figmalade both defined the exact same function). One implementation now.

import { describe, it, expect } from 'vitest';
import { hexToRgba } from './color.js';

describe('hexToRgba', () => {
  it('converts a 6-digit hex to an rgba() string with the given alpha', () => {
    expect(hexToRgba('#fef3c7', 0.6)).toBe('rgba(254, 243, 199, 0.6)');
  });

  it('converts a 3-digit hex shorthand by doubling each digit', () => {
    expect(hexToRgba('#0f0', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('works without a leading #', () => {
    expect(hexToRgba('000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });

  it('returns the original hex string unchanged when it cannot be parsed', () => {
    expect(hexToRgba('not-a-color', 0.5)).toBe('not-a-color');
  });
});
