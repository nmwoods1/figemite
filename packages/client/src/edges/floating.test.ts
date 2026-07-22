// Tests for the pure floating-edge geometry module (edges/floating.ts).
//
// No ReactFlow runtime / DOM here — everything operates on plain
// `{ x, y, width, height }` rects in flow coordinates, so the recipe is
// fully unit-testable in isolation. These tests ARE the contract for Task 3's
// edge components, which feed rects built from RF's `positionAbsolute` +
// `measured.{width,height}`.

import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import {
  getRectIntersection,
  getEdgePosition,
  getFloatingEdgeParams,
  getElbowPath,
  type RectGeom,
} from './floating.js';

// A point lies on the rect's border when it sits on one of the four sides
// (within `eps`) AND stays within the extent of that side.
function onBorder(rect: RectGeom, p: { x: number; y: number }, eps = 1e-9): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const onVertical =
    (Math.abs(p.x - left) <= eps || Math.abs(p.x - right) <= eps) &&
    p.y >= top - eps &&
    p.y <= bottom + eps;
  const onHorizontal =
    (Math.abs(p.y - top) <= eps || Math.abs(p.y - bottom) <= eps) &&
    p.x >= left - eps &&
    p.x <= right + eps;
  return onVertical || onHorizontal;
}

describe('getRectIntersection', () => {
  it('clips a horizontal ray to the facing vertical border', () => {
    const left: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const right: RectGeom = { x: 200, y: 0, width: 100, height: 60 };

    // left → right: exits the RIGHT edge of the left rect at its vertical center.
    expect(getRectIntersection(left, right)).toEqual({ x: 100, y: 30 });
    // right → left: exits the LEFT edge of the right rect.
    expect(getRectIntersection(right, left)).toEqual({ x: 200, y: 30 });
  });

  it('clips a vertical ray to the facing horizontal border', () => {
    const top: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const bottom: RectGeom = { x: 0, y: 200, width: 100, height: 60 };

    expect(getRectIntersection(top, bottom)).toEqual({ x: 50, y: 60 });
    expect(getRectIntersection(bottom, top)).toEqual({ x: 50, y: 200 });
  });

  it('returns a point exactly on the border for a diagonal offset', () => {
    const a: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const b: RectGeom = { x: 200, y: 60, width: 100, height: 60 };

    const ia = getRectIntersection(a, b);
    const ib = getRectIntersection(b, a);
    expect(onBorder(a, ia)).toBe(true);
    expect(onBorder(b, ib)).toBe(true);
    // Horizontally-dominant offset → exits the right side of a, left side of b.
    expect(ia.x).toBeCloseTo(100);
    expect(ib.x).toBeCloseTo(200);
    // y stays strictly between each rect's top and bottom.
    expect(ia.y).toBeGreaterThan(0);
    expect(ia.y).toBeLessThan(60);
    expect(ib.y).toBeGreaterThan(60);
    expect(ib.y).toBeLessThan(120);
  });

  it('never produces NaN/Infinity when centers coincide (overlapping rects)', () => {
    const r: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const p = getRectIntersection(r, { ...r });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    // Degenerate fallback: the rect's own center.
    expect(p).toEqual({ x: 50, y: 30 });
  });

  it('lands on the border across a spread of offsets', () => {
    const rect: RectGeom = { x: 10, y: 20, width: 80, height: 120 };
    const offsets = [
      [500, 0],
      [-500, 0],
      [0, 500],
      [0, -500],
      [300, 40],
      [-40, 300],
      [220, -190],
      [-260, -170],
      [7, 913],
      [913, 7],
    ];
    for (const [ox, oy] of offsets) {
      const other: RectGeom = { x: rect.x + ox, y: rect.y + oy, width: 30, height: 30 };
      const p = getRectIntersection(rect, other);
      expect(onBorder(rect, p, 1e-6)).toBe(true);
    }
  });
});

describe('getEdgePosition', () => {
  const rect: RectGeom = { x: 0, y: 0, width: 100, height: 60 };

  it('maps each side to its ReactFlow Position', () => {
    expect(getEdgePosition(rect, { x: 100, y: 30 })).toBe(Position.Right);
    expect(getEdgePosition(rect, { x: 0, y: 30 })).toBe(Position.Left);
    expect(getEdgePosition(rect, { x: 50, y: 0 })).toBe(Position.Top);
    expect(getEdgePosition(rect, { x: 50, y: 60 })).toBe(Position.Bottom);
  });

  it('breaks a corner tie toward the horizontal axis (Left/Right)', () => {
    // Exact top-right corner: |nx| == |ny| == 1 → horizontal wins.
    expect(getEdgePosition(rect, { x: 100, y: 0 })).toBe(Position.Right);
    expect(getEdgePosition(rect, { x: 0, y: 60 })).toBe(Position.Left);
  });
});

describe('getFloatingEdgeParams', () => {
  it('gives Right→Left for horizontally-separated rects', () => {
    const source: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const target: RectGeom = { x: 200, y: 0, width: 100, height: 60 };

    const p = getFloatingEdgeParams(source, target);
    expect(p.sx).toBeCloseTo(100);
    expect(p.sy).toBeCloseTo(30);
    expect(p.tx).toBeCloseTo(200);
    expect(p.ty).toBeCloseTo(30);
    expect(p.sourcePos).toBe(Position.Right);
    expect(p.targetPos).toBe(Position.Left);
  });

  it('gives Bottom→Top for vertically-stacked rects', () => {
    const source: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const target: RectGeom = { x: 0, y: 200, width: 100, height: 60 };

    const p = getFloatingEdgeParams(source, target);
    expect(p.sx).toBeCloseTo(50);
    expect(p.sy).toBeCloseTo(60);
    expect(p.tx).toBeCloseTo(50);
    expect(p.ty).toBeCloseTo(200);
    expect(p.sourcePos).toBe(Position.Bottom);
    expect(p.targetPos).toBe(Position.Top);
  });

  it('handles a diagonal offset (endpoints on facing sides, y within extents)', () => {
    const source: RectGeom = { x: 0, y: 0, width: 100, height: 60 };
    const target: RectGeom = { x: 200, y: 60, width: 100, height: 60 };

    const p = getFloatingEdgeParams(source, target);
    expect(p.sourcePos).toBe(Position.Right);
    expect(p.targetPos).toBe(Position.Left);
    expect(p.sy).toBeGreaterThan(0);
    expect(p.sy).toBeLessThan(60);
    expect(p.ty).toBeGreaterThan(60);
    expect(p.ty).toBeLessThan(120);
  });

  it('stays finite for coincident centers', () => {
    const r: RectGeom = { x: 5, y: 5, width: 40, height: 40 };
    const p = getFloatingEdgeParams(r, { ...r });
    for (const v of [p.sx, p.sy, p.tx, p.ty]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('getElbowPath', () => {
  it('emits an orthogonal path with L commands and no curves', () => {
    const [path] = getElbowPath(0, 0, 100, 40);
    expect(path).toContain('L');
    expect(path).not.toContain('C');
    expect(path).not.toContain('Q');
  });

  it('splits on the mid-x for a horizontally-dominant route', () => {
    // |dx|=100 > |dy|=40 → vertical split line at mid-x (50).
    const [path, labelX, labelY] = getElbowPath(0, 0, 100, 40);
    // Two bends on the x=50 split line.
    expect(path).toContain('50,0');
    expect(path).toContain('50,40');
    // Label anchor = arc-length midpoint = (mid-x, mid-y of the endpoints).
    expect(labelX).toBe(50);
    expect(labelY).toBe(20);
  });

  it('splits on the mid-y for a vertically-dominant route', () => {
    // |dy|=100 > |dx|=40 → horizontal split line at mid-y (50).
    const [path, labelX, labelY] = getElbowPath(0, 0, 40, 100);
    expect(path).toContain('0,50');
    expect(path).toContain('40,50');
    expect(labelX).toBe(20);
    expect(labelY).toBe(50);
  });

  it('starts at the source and ends at the target', () => {
    const [path] = getElbowPath(12, 34, 78, 90);
    expect(path.startsWith('M 12,34')).toBe(true);
    expect(path.trimEnd().endsWith('78,90')).toBe(true);
  });
});
