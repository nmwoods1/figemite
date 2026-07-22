// ── Floating-edge geometry ───────────────────────────────────────────────────
//
// Pure, dependency-light math for "floating" edges: instead of docking to fixed
// handles, an edge attaches to the point on each node's boundary that faces the
// other node. This is the standard ReactFlow floating-edge recipe (a ray from
// one rect's center to the other's center, clipped to the first rect's border),
// factored out with NO React/DOM so it is unit-testable in isolation. Task 3's
// edge components consume it, building rects from RF's `internals.positionAbsolute`
// + `measured.{width,height}`.
//
// Coordinate convention (matches how the caller builds rects):
//   `RectGeom.x`/`y` is the rect's TOP-LEFT corner in flow coordinates and
//   `width`/`height` its size, so the center is `(x + width/2, y + height/2)`.
//   The +y axis points DOWN (screen/flow convention), so `Position.Top` is the
//   smaller-y side and `Position.Bottom` the larger-y side.
//
// The only import is `Position` from `@xyflow/react` — a plain string enum
// (`'left' | 'right' | 'top' | 'bottom'`), no runtime coupling.

import { Position } from '@xyflow/react';

export interface RectGeom {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Intersection of the ray from `rect`'s center toward `other`'s center with
 * `rect`'s border.
 *
 * We scale the center-to-center direction so the point lands exactly on the
 * first side it reaches: the border is where the offset, normalized by the
 * half-extents, first hits magnitude 1, i.e. `max(|dx|/halfW, |dy|/halfH) = 1`.
 * The dominant (larger normalized) axis is the one clamped to ±half-extent, so
 * the result is exactly on a side and the other coordinate stays strictly
 * inside that side's span.
 *
 * Degenerate case — coincident centers (fully overlapping rects): the direction
 * is the zero vector and the scale would divide by zero, so we fall back to the
 * rect's own center. That keeps the segment a (zero-length) center-to-center
 * one and guarantees a finite result (never NaN/Infinity).
 */
export function getRectIntersection(rect: RectGeom, other: RectGeom): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const ox = other.x + other.width / 2;
  const oy = other.y + other.height / 2;

  const dx = ox - cx;
  const dy = oy - cy;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const denom = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  // Coincident centers → no direction to clip; fall back to the center.
  if (!(denom > 0) || !Number.isFinite(denom)) {
    return { x: cx, y: cy };
  }

  const scale = 1 / denom;
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Which side of `rect` a border `point` sits on, as a ReactFlow `Position`.
 *
 * Consistent with `getRectIntersection`: we normalize the point's offset from
 * the center by the half-extents and take the dominant axis. The dominant axis
 * is exactly the one the intersection clamped to ±1, so feeding an intersection
 * back in recovers the correct side.
 *
 * Tie-break: at an exact corner `|nx| === |ny|`, the horizontal axis wins
 * (`Left`/`Right`), via the `>=` comparison. This is documented and
 * deterministic; for the axis-aligned cases the tests exercise there is no tie.
 */
export function getEdgePosition(rect: RectGeom, point: Point): Position {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const nx = halfW > 0 ? (point.x - cx) / halfW : 0;
  const ny = halfH > 0 ? (point.y - cy) / halfH : 0;

  if (Math.abs(nx) >= Math.abs(ny)) {
    return nx >= 0 ? Position.Right : Position.Left;
  }
  return ny >= 0 ? Position.Bottom : Position.Top;
}

/**
 * Floating-edge endpoints and sides for a source→target rect pair: clip both
 * ways and classify each side. `sx`/`sy` is the point on the source border, and
 * `tx`/`ty` on the target border; `sourcePos`/`targetPos` are the RF Positions.
 */
export function getFloatingEdgeParams(
  source: RectGeom,
  target: RectGeom,
): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
} {
  const sourcePoint = getRectIntersection(source, target);
  const targetPoint = getRectIntersection(target, source);

  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: getEdgePosition(source, sourcePoint),
    targetPos: getEdgePosition(target, targetPoint),
  };
}

/**
 * Orthogonal ("elbow") path between two points already on their node borders,
 * as an SVG path built from `M`/`L` commands only — every segment is strictly
 * horizontal or vertical (no `C`/`Q` curves).
 *
 * Route rule (a two-bend "Z"): split on the dominant axis so the edge leaves
 * and arrives aligned with the facing sides.
 *   - Horizontal dominant (`|dx| >= |dy|`): a vertical split line at the mid-x
 *     `(sx+tx)/2` → `M s L (mx,sy) L (mx,ty) L t`.
 *   - Vertical dominant: a horizontal split line at the mid-y `(sy+ty)/2` →
 *     `M s L (sx,my) L (tx,my) L t`.
 * A perfectly diagonal pair (`|dx| === |dy|`) ties to horizontal via `>=`.
 *
 * `labelX`/`labelY` is the path's arc-length midpoint (the middle of the
 * connecting segment) — a reasonable center for an edge label.
 */
export function getElbowPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): [path: string, labelX: number, labelY: number] {
  const dx = tx - sx;
  const dy = ty - sy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const mx = (sx + tx) / 2;
    const path = `M ${sx},${sy} L ${mx},${sy} L ${mx},${ty} L ${tx},${ty}`;
    return [path, mx, (sy + ty) / 2];
  }

  const my = (sy + ty) / 2;
  const path = `M ${sx},${sy} L ${sx},${my} L ${tx},${my} L ${tx},${ty}`;
  return [path, (sx + tx) / 2, my];
}
