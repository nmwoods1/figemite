// ── BoardNode/BoardEdge <-> ReactFlow adapters ────────────────────────────────
//
// Ported from the legacy figmalade prototype's `boardNodesToRF` /
// `boardEdgesToRF` (src/components/BoardCanvas.tsx ~L175-308), faithfully
// preserving the frame-behind-non-frame stacking rule and the per-node-type
// data shape each node component needs to render. Two deliberate deviations
// from the legacy, both directed by the T18 plan:
//
//   1. RF node `type` is the board node's own `type` string (`'sticky'`,
//      `'frame'`, …) rather than the legacy's `'stickyNode'`/`'frameNode'`
//      suffix convention — one registered RF component per board node type,
//      named after that type directly.
//   2. Frame-vs-non-frame z-ordering reuses the shared `order` field (see
//      `@easel/shared`'s `normalizeOrder`/`reorderLayers`) instead of a fixed
//      `zIndex: -10` sentinel: frames are assigned negative zIndex values
//      derived from their `order`, non-frames get zIndex >= 0 derived from
//      theirs. This keeps relative stacking *within* each partition
//      meaningful (a frame's `order` still matters if frames can nest/overlap)
//      while preserving the invariant the legacy hardcoded — every frame
//      renders behind every non-frame.
//
// Write direction (RF -> board patch) is intentionally minimal here — full
// interaction handlers (drag/resize/rotate -> ops) are Phase 4. `rfNodeToPatch`
// is the one write-direction helper worth having now (reading a position back
// off a dragged RF node).

import type { Node as RfNode, Edge as RfEdge } from '@xyflow/react';
import type { BoardEdge, BoardNode, XY } from '@easel/shared';

// ── Node data shapes ──────────────────────────────────────────────────────────
//
// Each node type's `data` carries exactly the fields its node component needs
// to render (everything on BoardNode except `id`/`pos`/`order`, which RF
// already models via `id`/`position`/`zIndex`).

export type RfNodeData = Record<string, unknown>;

export type BoardRfNode = RfNode<RfNodeData, BoardNode['type']>;
export type BoardRfEdge = RfEdge<RfNodeData, 'arrow' | 'cardinality'>;

/** Every non-frame node's zIndex starts here, so it always exceeds any frame's. */
const NON_FRAME_ZINDEX_BASE = 0;
/** Frames get negative zIndex, keeping them behind every non-frame's >= 0 zIndex. */
const FRAME_ZINDEX_BASE = -1_000_000;

function nodeData(node: BoardNode): RfNodeData {
  const rest = { ...node } as Record<string, unknown>;
  delete rest.id;
  delete rest.pos;
  delete rest.order;
  delete rest.type;
  return rest as RfNodeData;
}

function nodeSize(node: BoardNode): { width?: number; height?: number } {
  const size = (node as { size?: unknown }).size;
  if (typeof size === 'number') return { width: size, height: size };
  if (size && typeof size === 'object' && 'width' in size && 'height' in size) {
    const wh = size as { width: number; height: number };
    return { width: wh.width, height: wh.height };
  }
  return {};
}

/**
 * Map a single {@link BoardNode} to its ReactFlow node. `zIndex` mirrors the
 * legacy's frame-behind-non-frame rule (see module doc); `order` (not `pos`)
 * decides the exact zIndex so within-partition stacking is meaningful.
 * `readonly` drives `draggable`/`selectable` (both false when true — Phase 4
 * wires up real interaction handlers for the non-readonly case).
 */
export function boardNodeToRf(node: BoardNode, readonly: boolean): BoardRfNode {
  const { width, height } = nodeSize(node);
  const zIndex =
    node.type === 'frame' ? FRAME_ZINDEX_BASE + node.order : NON_FRAME_ZINDEX_BASE + node.order;

  return {
    id: node.id,
    type: node.type,
    position: { x: node.pos.x, y: node.pos.y },
    data: nodeData(node),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    zIndex,
    draggable: !readonly,
    selectable: !readonly,
  };
}

/**
 * Map a single {@link BoardEdge} to its ReactFlow edge. `type` is
 * `'cardinality'` when `edge.kind === 'cardinality'`, else `'arrow'`
 * (matching `kind`'s own default-to-'arrow' contract). `data` carries the
 * style/arrow/cardinality/label fields the edge component needs.
 */
export function boardEdgeToRf(edge: BoardEdge): BoardRfEdge {
  const kind = edge.kind ?? 'arrow';
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: kind === 'cardinality' ? 'cardinality' : 'arrow',
    data: {
      label: edge.label,
      style: edge.style,
      kind,
      arrow: edge.arrow ?? 'end',
      cardinality: edge.cardinality ?? '1:N',
    },
  };
}

/**
 * Map a whole board (nodes + edges) to ReactFlow shape. Nodes are sorted so
 * that ReactFlow's render order agrees with `zIndex`: all frames first
 * (ordered by their own `order`), then all non-frames (ordered by their own
 * `order`) — the exact partition scheme `@easel/shared`'s `normalizeOrder`
 * uses, reused here rather than reinvented.
 */
export function boardToRf(
  board: { nodes: BoardNode[]; edges: BoardEdge[] },
  readonly: boolean,
): { nodes: BoardRfNode[]; edges: BoardRfEdge[] } {
  const frames = board.nodes.filter((n) => n.type === 'frame').sort((a, b) => a.order - b.order);
  const nonFrames = board.nodes.filter((n) => n.type !== 'frame').sort((a, b) => a.order - b.order);

  const nodes = [...frames, ...nonFrames].map((n) => boardNodeToRf(n, readonly));
  const edges = board.edges.map(boardEdgeToRf);

  return { nodes, edges };
}

// ── Minimal write direction (Phase 4 owns the full interaction handlers) ─────

/** Read a position back off an RF node — e.g. after a drag-end event. */
export function rfNodeToPosition(node: Pick<BoardRfNode, 'position'>): XY {
  return { x: node.position.x, y: node.position.y };
}
