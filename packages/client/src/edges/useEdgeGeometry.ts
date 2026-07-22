// ── Shared floating-edge geometry hook ───────────────────────────────────────
//
// The single place ArrowEdge and CardinalityEdge derive their endpoints, sides,
// and SVG path from — so neither component duplicates the floating/fallback/
// routing logic. It is a hook (not a plain function) because it must call
// `useInternalNode` for the two endpoint node ids; both edge components need
// exactly that.
//
// Endpoint precedence (matches the plan's required design):
//   1. If BOTH endpoint nodes resolve AND both have a measured size, build a
//      `RectGeom` for each (top-left = `internals.positionAbsolute`, size =
//      `measured.{width,height}`) and clip to the borders via
//      `getFloatingEdgeParams` — the real-app "floating" path.
//   2. Otherwise fall back to the caller-supplied endpoints/sides
//      (`sourceX/sourceY/targetX/targetY` + `sourcePosition/targetPosition`).
//      This keeps first paint non-blank before nodes are measured AND keeps the
//      isolated edge unit tests working (their harness has no store nodes, so
//      `useInternalNode` returns undefined — the tests exercise this branch).
//
// The `routing` field then selects the path style: 'straight' → a direct line,
// 'elbow' → orthogonal (from `floating.ts`), anything else (incl. undefined) →
// the default bezier.

import { getBezierPath, getStraightPath, useInternalNode } from '@xyflow/react';
import type { Position } from '@xyflow/react';
import type { EdgeRouting } from '@figemite/shared';
import { getElbowPath, getFloatingEdgeParams } from './floating.js';
import type { RectGeom } from './floating.js';

export interface EdgeGeometryInput {
  /** Source node id (RF `EdgeProps.source`). */
  source: string;
  /** Target node id (RF `EdgeProps.target`). */
  target: string;
  /** Path routing style; `undefined`/`'bezier'` → default bezier. */
  routing: EdgeRouting | undefined;
  // Fallback endpoints + sides (used verbatim until both nodes are measured).
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

export interface EdgeGeometry {
  edgePath: string;
  labelX: number;
  labelY: number;
  /** Resolved endpoints — on the node borders when floating, else the fallback. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** Resolved sides — the border side each endpoint landed on, else the fallback. */
  sourcePos: Position;
  targetPos: Position;
}

/**
 * Build a `RectGeom` from an internal node iff it has a finite measured size;
 * otherwise `null` ("not measured yet" → caller falls back to the RF props).
 */
function rectOf(node: ReturnType<typeof useInternalNode>): RectGeom | null {
  if (!node) return null;
  const { width, height } = node.measured;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width, height };
}

export function useEdgeGeometry(input: EdgeGeometryInput): EdgeGeometry {
  const sourceNode = useInternalNode(input.source);
  const targetNode = useInternalNode(input.target);

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);

  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  let sourcePos: Position;
  let targetPos: Position;

  if (sourceRect && targetRect) {
    // Floating: both nodes measured → clip endpoints to their facing borders.
    ({ sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(sourceRect, targetRect));
  } else {
    // Fallback (pre-measurement / isolated tests): the caller-supplied geometry.
    sx = input.sourceX;
    sy = input.sourceY;
    tx = input.targetX;
    ty = input.targetY;
    sourcePos = input.sourcePosition;
    targetPos = input.targetPosition;
  }

  let edgePath: string;
  let labelX: number;
  let labelY: number;
  if (input.routing === 'straight') {
    [edgePath, labelX, labelY] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
  } else if (input.routing === 'elbow') {
    [edgePath, labelX, labelY] = getElbowPath(sx, sy, tx, ty);
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sourcePos,
      targetX: tx,
      targetY: ty,
      targetPosition: targetPos,
    });
  }

  return { edgePath, labelX, labelY, sx, sy, tx, ty, sourcePos, targetPos };
}
