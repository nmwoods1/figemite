// The icon registry: inline SVG path data for a small curated set of icons.
// Ported verbatim from figmalade's src/lib/icons.ts.

import { describe, it, expect } from 'vitest';
import { ICONS, ICON_CATEGORIES, getIcon } from './icons.js';

describe('icons registry', () => {
  it('contains at least one icon per category', () => {
    for (const category of ICON_CATEGORIES) {
      expect(ICONS.some((icon) => icon.category === category)).toBe(true);
    }
  });

  it('getIcon finds an icon by name', () => {
    const star = getIcon('star');
    expect(star).toBeDefined();
    expect(star?.category).toBe('objects');
  });

  it('getIcon returns undefined for an unknown name', () => {
    expect(getIcon('not-a-real-icon')).toBeUndefined();
  });

  it('every icon has at least one of paths/circles/lines', () => {
    for (const icon of ICONS) {
      const hasGeometry =
        (icon.paths && icon.paths.length > 0) ||
        (icon.circles && icon.circles.length > 0) ||
        (icon.lines && icon.lines.length > 0);
      expect(hasGeometry).toBe(true);
    }
  });

  it('has no duplicate icon names', () => {
    const names = ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
