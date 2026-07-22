// Ported from the prototype's src/lib/draw-utils.ts: quadratic-Bézier stroke
// smoothing + point-thinning for the freehand pencil tool.

import { describe, it, expect } from 'vitest';
import {
  getStrokePath,
  smoothPath,
  thinPoints,
  computeBBox,
  translatePoints,
} from './draw-utils.js';

describe('getStrokePath', () => {
  it('returns an empty string for no points', () => {
    expect(getStrokePath([])).toBe('');
  });

  it('produces a closed, filled outline path for a stroke', () => {
    const d = getStrokePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
    // A perfect-freehand outline is a closed polygon: starts with a moveto and
    // ends with a close-path, unlike the open centerline `smoothPath` emits.
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d).toContain('Q');
  });

  it('scales the outline with the requested size', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    // A fatter stroke must yield a physically larger outline (more extent),
    // so the two paths can never be identical.
    expect(getStrokePath(points, { size: 2 })).not.toBe(getStrokePath(points, { size: 20 }));
  });

  it('is deterministic for the same input', () => {
    const points = [
      { x: 1, y: 2 },
      { x: 5, y: 9 },
      { x: 12, y: 3 },
    ];
    expect(getStrokePath(points, { size: 4 })).toBe(getStrokePath(points, { size: 4 }));
  });
});

describe('smoothPath', () => {
  it('returns an empty string for no points', () => {
    expect(smoothPath([])).toBe('');
  });

  it('draws a tiny dot for a single point', () => {
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5.01 5');
  });

  it('draws a straight line for two points', () => {
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe('M 0 0 L 10 10');
  });

  it('builds a quadratic curve through midpoints for 3+ points', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).toBe('M 0 0 Q 10 0 10 5 L 10 10');
  });
});

describe('thinPoints', () => {
  it('keeps the first and last point always', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 20, y: 0 },
    ];
    const thinned = thinPoints(points, 1.5);
    expect(thinned[0]).toEqual({ x: 0, y: 0 });
    expect(thinned[thinned.length - 1]).toEqual({ x: 20, y: 0 });
  });

  it('drops points closer than `min` to the previous kept point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 5, y: 0 },
    ];
    const thinned = thinPoints(points, 1.5);
    // 0.5 and 1 are both within 1.5 of the last kept point (0), so they're dropped
    // until 5, which is far enough — but the final point is always kept regardless.
    expect(thinned).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('returns single/empty input unchanged', () => {
    expect(thinPoints([])).toEqual([]);
    expect(thinPoints([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('computeBBox', () => {
  it('computes the bounding box of a set of points', () => {
    const bbox = computeBBox([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: -2, y: 8 },
    ]);
    expect(bbox).toEqual({ x: -2, y: 0, width: 12, height: 8 });
  });

  it('pads the bbox on all sides', () => {
    const bbox = computeBBox(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      2,
    );
    expect(bbox).toEqual({ x: -2, y: -2, width: 14, height: 14 });
  });

  it('returns a zero rect for no points', () => {
    expect(computeBBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('translatePoints', () => {
  it('translates every point by (-dx, -dy)', () => {
    const points = [
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(translatePoints(points, 2, 3)).toEqual([
      { x: 3, y: 2 },
      { x: 8, y: 7 },
    ]);
  });
});
