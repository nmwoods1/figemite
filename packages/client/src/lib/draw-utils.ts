// ── Drawing helpers ──────────────────────────────────────────────────────────
//
// Ported from the original prototype's src/lib/draw-utils.ts.
// Shared utilities for the persistent pencil (DrawingNode) and (later) the
// ephemeral annotation overlay. Keeping them here keeps stroke smoothing
// consistent across both, and gives one place to tune curve quality / point
// thinning. Uses `@figemite/shared`'s `XY` instead of the legacy's local
// `lib/types.ts` copy.

import type { XY } from '@figemite/shared';

// Quadratic-Bézier smoothing: connect midpoints between consecutive points
// using each original point as the control point. Cheap, looks good, and
// matches what most freehand tools do as a baseline.
export function smoothPath(points: XY[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Single click — draw a tiny dot.
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Drop points that are within `min` units of the previous point. Keeps strokes
// from getting absurdly long on slow pointer moves and reduces JSON size on
// commit. Using squared distance avoids a per-sample sqrt.
export function thinPoints(points: XY[], min = 1.5): XY[] {
  if (points.length <= 1) return points;
  const minSq = min * min;
  const out: XY[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    const dx = points[i].x - last.x;
    const dy = points[i].y - last.y;
    if (dx * dx + dy * dy >= minSq) out.push(points[i]);
  }
  // Always keep the last input point so the stroke ends where the cursor ended.
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

// Axis-aligned bounding box of a list of points, expanded by `pad` on all
// sides (typically half the stroke width so the SVG doesn't clip the line).
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeBBox(points: XY[], pad = 0): BBox {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

// Translate every point by (-dx, -dy). Used after computing a stroke's bbox
// so points become relative to the bbox origin (i.e. relative to the
// DrawingNode's `pos`).
export function translatePoints(points: XY[], dx: number, dy: number): XY[] {
  return points.map((p) => ({ x: p.x - dx, y: p.y - dy }));
}
