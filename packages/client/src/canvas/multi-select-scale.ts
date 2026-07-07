// ── multi-select-scale: pure group-resize transform ──────────────────────────
//
// Ported from the prototype's `handleMultiScale` (src/components/BoardCanvas.tsx
// ~L1507-1545) — see this module's test file for the full per-type
// breakdown. Pure and DOM-free: given a node's ORIGINAL flow-space rect and a
// scale spec (factor + fixed anchor corner), returns the store-patch to
// apply. The multi-select overlay component computes the scale spec from
// pointer movement; this module only does the per-node-type math, so it's
// unit-testable without any DOM/ReactFlow machinery.
//
// Legacy snapped every dimension to a GRID_SIZE (20px); the new codebase has
// no grid-snapping concept (BoardCanvas doesn't snap plain drag/resize
// either — see rf-adapters.ts/useEditableCanvas.ts), so this only keeps the
// MIN_BBOX floor, not the grid rounding.

import type { BoardNode, WH, XY } from '@figemite/shared';

export interface OriginalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleSpec {
  /** Horizontal scale factor. */
  sx: number;
  /** Vertical scale factor. */
  sy: number;
  /** The flow-space point that stays fixed while scaling (the opposite
   * corner from whichever handle is being dragged). */
  anchor: XY;
}

/** Mirrors the legacy's MIN_BBOX — a WH-sized node can never scale down past
 * this floor (in either dimension). */
const MIN_SIZE = 20;
/** Mirrors the legacy's numeric-size floor for emoji/icon glyphs. */
const MIN_GLYPH_SIZE = 16;

/** A patch suitable for `BoardStore`'s mutation API (`moveNode`+`resizeNode`,
 * or a single `updateNode` call) — only the keys this node's type needs. */
export interface GroupResizePatch {
  pos: XY;
  size?: WH | number;
  points?: XY[];
}

function scaledPos(rect: OriginalRect, spec: ScaleSpec): XY {
  return {
    x: spec.anchor.x + (rect.x - spec.anchor.x) * spec.sx,
    y: spec.anchor.y + (rect.y - spec.anchor.y) * spec.sy,
  };
}

/**
 * Compute the group-resize patch for a single node, given its pre-drag flow
 * rect and the current scale spec. Per-type behaviour (see module doc):
 *   - sticky/shape/frame: independent width x height scale.
 *   - drawing: width x height scale, AND every stored point scaled the same
 *     factor (so the stroke scales with the bbox instead of clipping).
 *   - emoji/icon: uniform scale (min(sx, sy)) so the glyph stays square.
 *   - text (and any other position-only type): position only, no size key.
 */
export function scaleNodeForGroupResize(
  node: BoardNode,
  rect: OriginalRect,
  spec: ScaleSpec,
): GroupResizePatch {
  const pos = scaledPos(rect, spec);

  switch (node.type) {
    case 'sticky':
    case 'shape':
    case 'frame': {
      const width = Math.max(MIN_SIZE, rect.width * spec.sx);
      const height = Math.max(MIN_SIZE, rect.height * spec.sy);
      return { pos, size: { width, height } };
    }
    case 'drawing': {
      const width = Math.max(MIN_SIZE, rect.width * spec.sx);
      const height = Math.max(MIN_SIZE, rect.height * spec.sy);
      const fx = rect.width === 0 ? 1 : width / rect.width;
      const fy = rect.height === 0 ? 1 : height / rect.height;
      return {
        pos,
        size: { width, height },
        points: node.points.map((p) => ({ x: p.x * fx, y: p.y * fy })),
      };
    }
    case 'emoji':
    case 'icon': {
      const factor = Math.min(spec.sx, spec.sy);
      const size = Math.max(MIN_GLYPH_SIZE, Math.round(node.size * factor));
      return { pos, size };
    }
    case 'text':
      return { pos };
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const _exhaustive: never = node;
      return { pos: (_exhaustive as BoardNode).pos };
    }
  }
}
