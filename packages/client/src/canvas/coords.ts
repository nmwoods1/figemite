// ── The SINGLE canvas <-> screen coordinate transform ────────────────────────
//
// The legacy prototype (figmalade's BoardCanvas.tsx) duplicated this exact
// math — `(screenX - rect.left - viewport.x) / viewport.zoom` and its inverse
// — inline in every overlay that needed to place something in flow space
// (comment pins, the pencil layer, the annotation layer, the multi-select
// resizer). Any drift between copies was a real source of misaligned
// overlays. This module is the one place that math lives now.
//
// Pure: no DOM/React imports. `DOMRect`-shaped values are accepted as plain
// data (see `getFlowPointer`'s `rect` param) so this stays testable outside a
// browser.

import type { BoardNode } from '@easel/shared';

export interface XY {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A minimal DOMRect-shaped value — only the fields this module reads. */
export interface RectLike {
  left: number;
  top: number;
}

/** A minimal PointerEvent/MouseEvent-shaped value — only the fields this module reads. */
export interface ClientPoint {
  clientX: number;
  clientY: number;
}

/** Flow (canvas) space -> screen (viewport) space. */
export function flowToScreen(p: XY, vp: Viewport): XY {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

/** Screen (viewport) space -> flow (canvas) space. Inverse of {@link flowToScreen}. */
export function screenToFlow(p: XY, vp: Viewport): XY {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

/**
 * Convert a screen-space pointer/mouse event position into flow coordinates,
 * relative to a container element's bounding rect.
 */
export function getFlowPointer(e: ClientPoint, rect: RectLike, vp: Viewport): XY {
  const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  return screenToFlow(local, vp);
}

// ── Node bbox helpers ─────────────────────────────────────────────────────────

/**
 * The flow-space bounding rect of a board node. Handles both `size: WH`
 * nodes (sticky/shape/frame/drawing) and numeric-`size` nodes (emoji/icon,
 * where `size` is the pixel side length of a square glyph). Nodes with no
 * `size` field at all (text) report a zero-size rect at `pos`.
 */
export function nodeRect(node: BoardNode): Rect {
  const { x, y } = node.pos;
  const size = (node as { size?: unknown }).size;

  if (typeof size === 'number') {
    return { x, y, width: size, height: size };
  }
  if (size && typeof size === 'object' && 'width' in size && 'height' in size) {
    const wh = size as { width: number; height: number };
    return { x, y, width: wh.width, height: wh.height };
  }
  return { x, y, width: 0, height: 0 };
}

/** The union rect of a set of nodes' {@link nodeRect}s. Empty input -> a zero rect. */
export function boundingBox(nodes: BoardNode[]): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const r = nodeRect(node);
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
