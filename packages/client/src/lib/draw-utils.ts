// ── Drawing helpers ──────────────────────────────────────────────────────────
//
// Ported from the original prototype's src/lib/draw-utils.ts.
// Shared utilities for the persistent pencil (DrawingNode) and (later) the
// ephemeral annotation overlay. Keeping them here keeps stroke smoothing
// consistent across both, and gives one place to tune curve quality / point
// thinning. Uses `@figemite/shared`'s `XY` instead of the legacy's local
// `lib/types.ts` copy.

import getStroke from 'perfect-freehand';
import type { XY } from '@figemite/shared';

// ── perfect-freehand outline rendering ───────────────────────────────────────
//
// The visible pencil/annotation stroke is drawn as a FILLED outline polygon
// (via perfect-freehand's `getStroke`) instead of a stroked centerline. This
// gives pressure/velocity-variable width — a real hand-drawn look — for free.
//
// We store no per-point pressure (the board model's `points` stay plain `XY`),
// so `simulatePressure` derives width from pointer velocity: fast = thin,
// slow = fat. That keeps the data model, MCP `add_drawing` contract, and
// on-disk JSON unchanged — only rendering differs. `smoothPath` below is still
// used for the invisible fat hit-target so thin strokes stay easy to click.

export interface StrokePathOptions {
  /** Stroke diameter, in the same units as `points` (maps to the board node's
   *  `strokeWidth`). Defaults to 3. */
  size?: number;
  /** How much the stroke tapers with speed/pressure (0–1). */
  thinning?: number;
  /** Curve smoothing (0–1). */
  smoothing?: number;
  /** Input-point streamlining / jitter removal (0–1). */
  streamline?: number;
  /** Derive width from pointer velocity when no real pressure is captured. */
  simulatePressure?: boolean;
  /** Whether this is the final (settled) stroke vs. an in-progress preview.
   *  Caps the tail so committed strokes end cleanly. */
  last?: boolean;
}

// Build a filled-outline SVG path (`d`) for a freehand stroke. Delegates the
// dot/short-stroke edge cases to perfect-freehand, which already handles 0/1/2
// input points. The result is meant to be rendered with `fill`, not `stroke`.
export function getStrokePath(points: XY[], options: StrokePathOptions = {}): string {
  if (points.length === 0) return '';
  const outline = getStroke(
    points.map((p) => [p.x, p.y]),
    {
      size: options.size ?? 3,
      thinning: options.thinning ?? 0.6,
      smoothing: options.smoothing ?? 0.5,
      streamline: options.streamline ?? 0.5,
      simulatePressure: options.simulatePressure ?? true,
      last: options.last ?? false,
    },
  );
  return outlineToPath(outline);
}

// Turn perfect-freehand's outline points into a closed SVG path, using
// quadratic segments through the midpoints of consecutive outline points for a
// smooth boundary. (The standard perfect-freehand rendering recipe.)
function outlineToPath(outline: number[][]): string {
  if (outline.length === 0) return '';
  const first = outline[0];
  let d = `M ${first[0]} ${first[1]} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` ${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
  }
  return `${d} Z`;
}

// Quadratic-Bézier smoothing: connect midpoints between consecutive points
// using each original point as the control point. Cheap, looks good, and
// matches what most freehand tools do as a baseline. Still used for the
// invisible fat hit-target path (see `getStrokePath`'s note).
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
