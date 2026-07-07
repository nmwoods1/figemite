// ── Pure board helpers ───────────────────────────────────────────────────────
//
// Ported from the original prototype's `src/lib/board-io.ts`, with two
// additions required by the T2 data model:
//
//   1. Every node factory now takes an explicit `order` (the authoritative
//      z-index — see model/board.ts's NodeBase doc). `nextOrder` /
//      `normalizeOrder` are the bridge between array position and `order`.
//   2. `serialise` is now canonical and writer-independent: two BoardFiles
//      that differ only in array ordering (not content) serialise to the
//      identical string. This is load-bearing — the browser and the MCP
//      server must produce byte-identical output for the same board state.

import type {
  ArrowStyle,
  BoardEdge,
  BoardFile,
  BoardNode,
  Cardinality,
  EdgeKind,
  LineStyle,
  ShapeKind,
  StickyColor,
  WH,
  XY,
} from './model/board.js';
import {
  DEFAULT_EMOJI_SIZE,
  DEFAULT_FRAME_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STICKY_SIZE,
  FORMAT_VERSION,
  STICKY_COLORS,
} from './model/constants.js';
import { parseBoardFile } from './model/schema.js';

// ── ID generation ────────────────────────────────────────────────────────────

export function generateId(prefix: string, existing: Set<string>): string {
  let n = 1;
  let id = `${prefix}${n}`;
  while (existing.has(id)) {
    n++;
    id = `${prefix}${n}`;
  }
  return id;
}

export function allNodeIds(file: BoardFile): Set<string> {
  return new Set(file.nodes.map((n) => n.id));
}

// ── Empty board factory ──────────────────────────────────────────────────────

export function emptyBoard(label: string): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: label,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ── Node factories ────────────────────────────────────────────────────────────
// Each factory takes an explicit `order` (placed right after `pos`) — the
// caller is expected to pass `nextOrder(existingNodes)` so new nodes land on
// top of the stack. See `nextOrder` / `normalizeOrder` below.

export function makeStickyNode(
  id: string,
  pos: XY,
  color: StickyColor,
  order: number,
  size: WH = DEFAULT_STICKY_SIZE,
): BoardNode {
  return { id, type: 'sticky', pos, order, size, text: '', color };
}

export function makeTextNode(id: string, pos: XY, order: number): BoardNode {
  return { id, type: 'text', pos, order, text: 'Label' };
}

export function makeShapeNode(
  id: string,
  pos: XY,
  order: number,
  shape: ShapeKind,
  size: WH = DEFAULT_SHAPE_SIZE,
  color = '#e2e8f0',
): BoardNode {
  return { id, type: 'shape', pos, order, size, shape, color };
}

export function makeEmojiNode(
  id: string,
  pos: XY,
  order: number,
  text: string,
  size = DEFAULT_EMOJI_SIZE,
): BoardNode {
  return { id, type: 'emoji', pos, order, text, size };
}

export function makeIconNode(
  id: string,
  pos: XY,
  order: number,
  name: string,
  size = DEFAULT_ICON_SIZE,
  color = '#1e293b',
): BoardNode {
  return { id, type: 'icon', pos, order, name, size, color };
}

// Build a DrawingNode from absolute-canvas-space points: compute the bbox,
// then translate the points so they're relative to that bbox origin (`pos`).
// Padding is added so wide strokes aren't clipped against the SVG edge.
export function makeDrawingNode(
  id: string,
  absolutePoints: XY[],
  order: number,
  color = '#1e293b',
  strokeWidth = 3,
): BoardNode {
  const pad = strokeWidth;
  let minX = absolutePoints[0]?.x ?? 0;
  let minY = absolutePoints[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (const p of absolutePoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pos: XY = { x: minX - pad, y: minY - pad };
  const size: WH = {
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
  const points = absolutePoints.map((p) => ({ x: p.x - pos.x, y: p.y - pos.y }));
  return { id, type: 'drawing', pos, order, size, points, color, strokeWidth };
}

export function makeFrameNode(
  id: string,
  pos: XY,
  order: number,
  size: WH = DEFAULT_FRAME_SIZE,
  color = '#fef3c7',
  title = 'Frame',
): BoardNode {
  return { id, type: 'frame', pos, order, size, title, color };
}

export function makeEdge(
  id: string,
  source: string,
  target: string,
  style: LineStyle = 'solid',
  kind: EdgeKind = 'arrow',
  arrow: ArrowStyle = 'end',
  cardinality: Cardinality = '1:N',
): BoardEdge {
  if (kind === 'cardinality') {
    return { id, source, target, style, kind, cardinality };
  }
  return { id, source, target, style, kind, arrow };
}

// ── Order helpers ─────────────────────────────────────────────────────────────
//
// `order` is the authoritative z-index (see model/board.ts). The `nodes`
// array is a materialized view; canonical serialization sorts by `order`.

/** The `order` a newly-created node should use so it lands on top of the stack. */
export function nextOrder(nodes: BoardNode[]): number {
  return nodes.length ? Math.max(...nodes.map((n) => n.order)) + 1 : 0;
}

/**
 * The bridge between array position and `order`. Preserves the legacy rule
 * that frames always render behind non-frames: partitions into frames and
 * non-frames (each partition sorted by its *existing* `order`, stably, so
 * relative order within a partition survives), concatenates
 * `[...frames, ...nonFrames]`, then reassigns each node's `order` to its
 * final index in that concatenation.
 *
 * Returns new node objects; never mutates the input.
 */
export function normalizeOrder(nodes: BoardNode[]): BoardNode[] {
  const frames = nodes
    .filter((n) => n.type === 'frame')
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.order - b.n.order || a.i - b.i)
    .map(({ n }) => n);
  const nonFrames = nodes
    .filter((n) => n.type !== 'frame')
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.order - b.n.order || a.i - b.i)
    .map(({ n }) => n);

  return [...frames, ...nonFrames].map((n, index) => ({ ...n, order: index }));
}

// ── Prune edges for deleted nodes ────────────────────────────────────────────

export function pruneEdgesForDeletedNodes(
  edges: BoardEdge[],
  remainingNodeIds: Set<string>,
): BoardEdge[] {
  return edges.filter((e) => remainingNodeIds.has(e.source) && remainingNodeIds.has(e.target));
}

// ── Color cycling ─────────────────────────────────────────────────────────────

// Cycles through the STICKY_COLORS palette. `current` isn't required to be a
// palette color (StickyColor is free-form hex) — if it isn't found (indexOf
// === -1), `(-1 + 1) % length === 0` naturally lands on the first palette
// color, which is a sensible fallback rather than an error.
export function nextStickyColor(current: StickyColor): StickyColor {
  const idx = STICKY_COLORS.indexOf(current);
  return STICKY_COLORS[(idx + 1) % STICKY_COLORS.length];
}

// ── Layer reordering ─────────────────────────────────────────────────────────
// Z-order in the canvas is driven by array order in `board.nodes` (later in
// the array = rendered on top). Frame nodes always sit behind non-frames
// visually. To keep the JSON data model consistent with what's drawn,
// reordering operates on two partitions independently — frames stay grouped
// at the start of the array, non-frames at the end — so a shape can never
// end up behind a frame.
//
// `applyLayerOp` below moves nodes by *array position* only; it does not
// touch each node's `order` field. So after reassembling
// `[...frames', ...nonFrames']`, the final array position (not any node's
// stale `order`) is what encodes the new stacking. We therefore reassign
// `order` directly from that final position — deliberately NOT via
// `normalizeOrder`, whose contract is to sort each partition by *existing*
// `order` first (the right behaviour for bridging a drifted nodes array, but
// wrong here since it would resurrect the pre-move order and undo the swap).

export type LayerOp = 'forward' | 'backward' | 'front' | 'back';

export function reorderLayers(
  nodes: BoardNode[],
  selectedIds: Set<string>,
  op: LayerOp,
): BoardNode[] {
  if (selectedIds.size === 0) return nodes;

  const frames = nodes.filter((n) => n.type === 'frame');
  const nonFrames = nodes.filter((n) => n.type !== 'frame');

  const reordered = [
    ...applyLayerOp(frames, selectedIds, op),
    ...applyLayerOp(nonFrames, selectedIds, op),
  ];

  return reordered.map((n, index) => ({ ...n, order: index }));
}

function applyLayerOp(group: BoardNode[], selectedIds: Set<string>, op: LayerOp): BoardNode[] {
  if (!group.some((n) => selectedIds.has(n.id))) return group;

  if (op === 'front') {
    const sel = group.filter((n) => selectedIds.has(n.id));
    const rest = group.filter((n) => !selectedIds.has(n.id));
    return [...rest, ...sel];
  }

  if (op === 'back') {
    const sel = group.filter((n) => selectedIds.has(n.id));
    const rest = group.filter((n) => !selectedIds.has(n.id));
    return [...sel, ...rest];
  }

  const out = [...group];

  if (op === 'forward') {
    // Walk right-to-left so each selected node shifts up by one slot without
    // colliding with another selected node that's already moved.
    for (let i = out.length - 2; i >= 0; i--) {
      if (selectedIds.has(out[i].id) && !selectedIds.has(out[i + 1].id)) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
      }
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (selectedIds.has(out[i].id) && !selectedIds.has(out[i - 1].id)) {
        [out[i], out[i - 1]] = [out[i - 1], out[i]];
      }
    }
  }

  return out;
}

// ── Canonical serialization ──────────────────────────────────────────────────
//
// Deterministic and writer-independent: the browser and the MCP server must
// produce byte-identical output for the same logical board state (fixing a
// real dup-write bug where array-order-only differences caused spurious
// writes/conflicts). Two BoardFiles that differ only in the ordering of
// `nodes`/`edges` arrays — same `order` values, same contents — serialise to
// the identical string.
//
// Achieved by emitting a normalized plain object with:
//   - a fixed top-level key order: formatVersion, boardLabel, viewport,
//     nodes, edges;
//   - `nodes` sorted ascending by `order`, then `id` as a stable tiebreak;
//   - `edges` sorted ascending by `id`;
//   - each node/edge's own keys re-emitted in a fixed, documented order.

function normalizeNode(node: BoardNode): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    pos: { x: node.pos.x, y: node.pos.y },
    order: node.order,
    ...(node.description !== undefined ? { description: node.description } : {}),
  };

  // WH sizes are reconstructed key-by-key ({ width, height }) rather than
  // spread, so key order is enforced by this function itself instead of
  // relying on every upstream producer to build the object in that order —
  // critical for the byte-identical browser/MCP guarantee. (emoji/icon carry
  // a numeric `size`, a primitive, so there's nothing to normalize there.)
  const wh = (s: WH) => ({ width: s.width, height: s.height });

  switch (node.type) {
    case 'sticky':
      return { ...base, size: wh(node.size), text: node.text, color: node.color };
    case 'text':
      return { ...base, text: node.text };
    case 'shape':
      return {
        ...base,
        size: wh(node.size),
        shape: node.shape,
        ...(node.text !== undefined ? { text: node.text } : {}),
        color: node.color,
        ...(node.rotation !== undefined ? { rotation: node.rotation } : {}),
      };
    case 'frame':
      return { ...base, size: wh(node.size), title: node.title, color: node.color };
    case 'emoji':
      return {
        ...base,
        text: node.text,
        size: node.size,
        ...(node.rotation !== undefined ? { rotation: node.rotation } : {}),
      };
    case 'icon':
      return {
        ...base,
        name: node.name,
        size: node.size,
        color: node.color,
        ...(node.rotation !== undefined ? { rotation: node.rotation } : {}),
      };
    case 'drawing':
      return {
        ...base,
        size: wh(node.size),
        points: node.points.map((p) => ({ x: p.x, y: p.y })),
        color: node.color,
        strokeWidth: node.strokeWidth,
      };
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

function normalizeEdge(edge: BoardEdge): Record<string, unknown> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}),
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    style: edge.style,
    ...(edge.kind !== undefined ? { kind: edge.kind } : {}),
    ...(edge.arrow !== undefined ? { arrow: edge.arrow } : {}),
    ...(edge.cardinality !== undefined ? { cardinality: edge.cardinality } : {}),
  };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical, deterministic, writer-independent JSON serialization of a
 * BoardFile. See module doc above for the invariant this provides.
 */
export function serialise(file: BoardFile): string {
  const nodes = [...file.nodes]
    .sort((a, b) => a.order - b.order || compareIds(a.id, b.id))
    .map(normalizeNode);
  const edges = [...file.edges].sort((a, b) => compareIds(a.id, b.id)).map(normalizeEdge);

  const normalized = {
    formatVersion: file.formatVersion,
    boardLabel: file.boardLabel,
    viewport: { x: file.viewport.x, y: file.viewport.y, zoom: file.viewport.zoom },
    nodes,
    edges,
  };

  return JSON.stringify(normalized, null, 2);
}

/**
 * Parses a raw JSON string into a validated, migrated {@link BoardFile}.
 * Delegates entirely to `parseBoardFile` (model/schema.ts) — this does not
 * re-implement validation, so a legacy v0 JSON string round-trips to a valid
 * v1 BoardFile just like calling `parseBoardFile(JSON.parse(raw))` would.
 */
export function deserialise(raw: string): BoardFile {
  return parseBoardFile(JSON.parse(raw));
}

// ── Signature (canonical string) ─────────────────────────────────────────────
//
// The canonical string for a board — used by tests/debug/equality checks.
// NOT the hot-path dirty check (that's a client-side epoch counter added in
// a later phase); this is a full re-serialization, kept for callers that want
// a stable string identity for a board's content.
export function boardSignature(file: BoardFile): string {
  return serialise(file);
}

// ── Hashing (dirty-detection support) ────────────────────────────────────────
//
// A fast 32-bit structural hash of the canonical serialise() output.
// Deterministic; equal iff the two files' canonical serialisations are equal.
// FNV-1a over the UTF-16 code units of the canonical string.
export function boardHash(file: BoardFile): number {
  const str = serialise(file);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime multiplication via shifts, kept within uint32 range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
