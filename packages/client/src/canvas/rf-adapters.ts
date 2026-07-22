// ── BoardNode/BoardEdge <-> ReactFlow adapters ────────────────────────────────
//
// Ported from the original prototype's `boardNodesToRF` /
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
//      `@figemite/shared`'s `normalizeOrder`/`reorderLayers`) instead of a fixed
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
import type { BoardEdge, BoardNode, XY } from '@figemite/shared';

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

  // WH-sized nodes (sticky/shape/frame/drawing) store `size: {width,height}`
  // on the board model, but every node component (nodes/StickyNode.tsx etc.)
  // reads flat `data.width`/`data.height` — matching how RF itself already
  // wants a top-level width/height (see boardNodeToRf below). Numeric `size`
  // nodes (emoji/icon) already match what their components expect (a flat
  // `data.size` number), so they pass through `rest.size` untouched.
  const size = rest.size;
  if (size && typeof size === 'object' && 'width' in size && 'height' in size) {
    const wh = size as { width: number; height: number };
    delete rest.size;
    rest.width = wh.width;
    rest.height = wh.height;
  }

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

// ── Editing-callback injection (P4-T24, editable path only) ──────────────────
//
// `useEditableCanvas` builds ONE `NodeCallbacks` bag per store (memoized —
// see its module doc) and passes it through `boardToRf` → `boardNodeToRf` on
// every doc-driven rebuild. EVERY function in this bag is created exactly
// once (inside that `useMemo`, closing only over the stable `store`) and
// reused as-is here — `callbacksForNode` only ever PICKS which existing
// reference(s) to attach to a given node's `data`, it never wraps/recreates
// one. That's load-bearing: if it allocated a new closure per node per call
// (e.g. to adapt `onResizeEnd`'s `{width,height}` shape to emoji/icon's
// single-number `size`), `data` would get a fresh function identity on every
// doc-driven rebuild, and `reconcile.ts`'s shallow `data` diff would see a
// "changed" node every tick — defeating its reference-stability guarantee
// (see reconcile.ts's module doc, point 2). So the width/height -> number
// squash for emoji/icon lives in `onResizeEndSquare` itself (still ONE
// stable function), not in a per-call wrapper here.
//
// Which callback(s) a node type receives mirrors `@figemite/shared`'s
// `nodeText` accessor (the frame/text-bearing/none split) for text editing,
// plus `onOpenDescription` for every node type whose component actually
// renders a `DescriptionBadge` (sticky/text/shape/emoji/icon — NOT frame or
// drawing), `onResizeEnd`/`onResizeEndSquare` for the resizable types
// (sticky/shape/frame/drawing use WH; emoji/icon use the aspect-locked
// numeric-size variant), and `onRotate` for the rotatable types
// (shape/emoji/icon) — see nodes/*.tsx for each component's own gating.
export interface NodeCallbacks {
  onTextChange: (id: string, text: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onOpenDescription: (id: string) => void;
  /** WH-sized nodes (sticky/shape/frame/drawing). */
  onResizeEnd: (id: string, size: { width: number; height: number }) => void;
  /** Numeric-sized nodes (emoji/icon) — EmojiNode/IconNode already squash
   * their aspect-locked `{width,height}` down to a single number (`Math.max`)
   * before calling `data.onResizeEnd` (see their own module docs), so this
   * stable function's signature matches that number directly. */
  onResizeEndSquare: (id: string, size: number) => void;
  onRotate: (id: string, rotation: number) => void;
}

const DESCRIBABLE_TYPES = new Set<BoardNode['type']>(['sticky', 'text', 'shape', 'emoji', 'icon']);

/** Node types that carry the drill-in (sub-board) badge. Frames (a.k.a.
 * "sections") are included so a section can own a nested board and be drilled
 * into — the seed boards ship sub-boards on frame nodes, and without the badge
 * those sub-boards were unreachable. Kept separate from `DESCRIBABLE_TYPES` so
 * the two affordances can diverge without entangling. */
const DRILLABLE_TYPES = new Set<BoardNode['type']>(['sticky', 'shape', 'frame']);

const WH_RESIZABLE_TYPES = new Set<BoardNode['type']>(['sticky', 'shape', 'frame', 'drawing']);
const SQUARE_RESIZABLE_TYPES = new Set<BoardNode['type']>(['emoji', 'icon']);
const ROTATABLE_TYPES = new Set<BoardNode['type']>(['shape', 'emoji', 'icon']);

// ── Drill-in (sub-board) injection — applies in BOTH read-only and editable ──
//
// Unlike the editing callbacks above (which are withheld from a read-only
// render — see `boardNodeToRf`'s `readonly` gate), the drill-in affordance is
// deliberately orthogonal to that gate: navigating INTO an existing sub-board
// must work in the published/static read-only build too, not just in the
// editable dev app. Only CREATING one is editable-only, which the badge itself
// gates via `canCreate` (false in read-only mode). So this bag is passed
// straight through `boardToRf` and attached regardless of `readonly`.
export interface SubBoardAdapter {
  /** Ids of nodes at THIS board level that already have a sub-board. */
  childIds: Set<string>;
  /** Opens (creating first if allowed) a node's sub-board. */
  onDrillIn: (nodeId: string) => void;
  /** Whether a sub-board may be created here (editable mode) — false in read-only. */
  canCreate: boolean;
}

/** The drill-in `data` a given node TYPE should receive. Returns `{}` (no keys)
 * for non-drillable types or when no `subBoard` adapter is supplied. */
function drillDataForNode(node: BoardNode, subBoard?: SubBoardAdapter): RfNodeData {
  if (!subBoard || !DRILLABLE_TYPES.has(node.type)) return {};
  return {
    hasSubBoard: subBoard.childIds.has(node.id),
    canCreateSubBoard: subBoard.canCreate,
    onDrillIn: subBoard.onDrillIn,
  };
}

/** The editing callbacks a given node TYPE should receive, per the module doc's
 * type→callback mapping. Returns `{}` (no keys) for a read-only render. */
function callbacksForNode(node: BoardNode, callbacks?: NodeCallbacks): RfNodeData {
  if (!callbacks) return {};
  const extra: RfNodeData = {};

  if (node.type === 'frame') {
    extra.onTitleChange = callbacks.onTitleChange;
  } else if (
    node.type === 'sticky' ||
    node.type === 'text' ||
    node.type === 'shape' ||
    node.type === 'emoji'
  ) {
    extra.onTextChange = callbacks.onTextChange;
  }

  if (DESCRIBABLE_TYPES.has(node.type)) {
    extra.onOpenDescription = callbacks.onOpenDescription;
  }

  if (WH_RESIZABLE_TYPES.has(node.type)) {
    extra.onResizeEnd = callbacks.onResizeEnd;
  } else if (SQUARE_RESIZABLE_TYPES.has(node.type)) {
    // EmojiNode/IconNode's `data.onResizeEnd` takes a single number, not
    // `{width,height}` — `onResizeEndSquare` IS that number-shaped stable
    // function (see the interface doc), so it's assigned to the same
    // `data.onResizeEnd` key the node component reads.
    extra.onResizeEnd = callbacks.onResizeEndSquare;
  }

  if (ROTATABLE_TYPES.has(node.type)) {
    extra.onRotate = callbacks.onRotate;
  }

  return extra;
}

/**
 * Map a single {@link BoardNode} to its ReactFlow node. `zIndex` mirrors the
 * legacy's frame-behind-non-frame rule (see module doc); `order` (not `pos`)
 * decides the exact zIndex so within-partition stacking is meaningful.
 * When `readonly`, nodes are pinned non-`draggable`/-`selectable` at the node
 * level; when editable, both are left UNSET so the board-level ReactFlow props
 * (`nodesDraggable`/`elementsSelectable`) — which encode the live content-lock,
 * AI locks, and overlay modes — remain the single source of truth (see the
 * node-level comment below).
 * `callbacks`, when given AND `readonly` is false, augments `data` with the
 * editing callbacks this node's type needs (see the module doc above) — the
 * seams in BaseNode/useEditableText/ConnectionHandles/DescriptionBadge go
 * live only when their gating callback is present, so a read-only render
 * (or omitting `callbacks`) leaves every seam inert. `subBoard`, when given,
 * augments a drillable node's `data` with the drill-in affordance REGARDLESS
 * of `readonly` (navigate-in works in read-only; create is gated by the
 * adapter's own `canCreate` — see {@link SubBoardAdapter}).
 */
export function boardNodeToRf(
  node: BoardNode,
  readonly: boolean,
  callbacks?: NodeCallbacks,
  subBoard?: SubBoardAdapter,
): BoardRfNode {
  const { width, height } = nodeSize(node);
  const zIndex =
    node.type === 'frame' ? FRAME_ZINDEX_BASE + node.order : NON_FRAME_ZINDEX_BASE + node.order;

  return {
    id: node.id,
    type: node.type,
    position: { x: node.pos.x, y: node.pos.y },
    data: {
      ...nodeData(node),
      ...(readonly ? {} : callbacksForNode(node, callbacks)),
      ...drillDataForNode(node, subBoard),
    },
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    // Frames ("sections") only drag by their title bar (`.frame-drag-handle`),
    // not their whole body — otherwise dragging the large background moves the
    // section and swallows canvas panning. Other node types have no dragHandle
    // and drag by their whole body as usual.
    ...(node.type === 'frame' ? { dragHandle: '.frame-drag-handle' } : {}),
    // A frame's body is `pointer-events: none` so drags over its (large,
    // otherwise empty) background fall through to the pane and PAN the canvas
    // instead of being swallowed. The interactive parts inside FrameNode — the
    // title bar, resize handles, and drill badge — re-enable pointer events on
    // themselves. Inner nodes are separate RF nodes stacked above, unaffected.
    ...(node.type === 'frame' ? { style: { pointerEvents: 'none' as const } } : {}),
    zIndex,
    // Interactivity is governed by the board-level ReactFlow props
    // (`nodesDraggable`/`elementsSelectable`), which aggregate EVERY edit gate:
    // read-only, the live content-lock, AI locks, and overlay (pencil/annotation)
    // modes. An explicit node-level `draggable`/`selectable` OVERRIDES those
    // board-level props (xyflow uses `node.draggable || (nodesDraggable &&
    // node.draggable === undefined)`), so a node-level `true` on the editable
    // pane would leak drag/select past the content-lock on the live board
    // (editable pane, but frozen). We therefore leave both UNSET when editable
    // and let the board-level gate decide — mirroring `connectable`, which is
    // never set node-level. When read-only we still pin them false as a
    // belt-and-suspenders reinforcement of the read-only pane's board-level gate.
    ...(readonly ? { draggable: false, selectable: false } : {}),
  };
}

// ── Edge-styling callback injection (P4-T24, editable path only) ─────────────
//
// Same stability contract as `NodeCallbacks` (see that interface's doc):
// `useEditableCanvas` builds ONE `EdgeCallbacks` bag per store, and
// `boardEdgeToRf` only picks which of its (already-stable) functions to
// attach — never wraps/recreates one — so `data` doesn't churn on every
// doc-driven rebuild. `onLabelChange`/`onStyleChange`/`onRoutingChange` apply
// to every edge (ArrowEdge and CardinalityEdge both support inline label
// editing, are both style-able, and both route via `data.routing`);
// `onArrowChange` only makes sense for an 'arrow'-kind edge,
// `onCardinalityChange` only for a 'cardinality'-kind edge.
export interface EdgeCallbacks {
  onLabelChange: (id: string, label: string) => void;
  onArrowChange: (id: string, arrow: BoardEdge['arrow']) => void;
  onStyleChange: (id: string, style: BoardEdge['style']) => void;
  onCardinalityChange: (id: string, cardinality: BoardEdge['cardinality']) => void;
  onRoutingChange: (id: string, routing: BoardEdge['routing']) => void;
}

/**
 * Map a single {@link BoardEdge} to its ReactFlow edge. `type` is
 * `'cardinality'` when `edge.kind === 'cardinality'`, else `'arrow'`
 * (matching `kind`'s own default-to-'arrow' contract). `data` carries the
 * style/arrow/cardinality/label/routing fields the edge component needs,
 * plus (when `callbacks` is given) the editing callbacks ArrowEdge/
 * CardinalityEdge's inline seams need — see `EdgeCallbacks`'s doc for the
 * kind-specific split.
 */
export function boardEdgeToRf(edge: BoardEdge, callbacks?: EdgeCallbacks): BoardRfEdge {
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
      routing: edge.routing,
      ...(callbacks
        ? {
            onLabelChange: callbacks.onLabelChange,
            onStyleChange: callbacks.onStyleChange,
            onRoutingChange: callbacks.onRoutingChange,
            ...(kind === 'cardinality'
              ? { onCardinalityChange: callbacks.onCardinalityChange }
              : { onArrowChange: callbacks.onArrowChange }),
          }
        : {}),
    },
  };
}

/**
 * Map a whole board (nodes + edges) to ReactFlow shape. Nodes are sorted so
 * that ReactFlow's render order agrees with `zIndex`: all frames first
 * (ordered by their own `order`), then all non-frames (ordered by their own
 * `order`) — the exact partition scheme `@figemite/shared`'s `normalizeOrder`
 * uses, reused here rather than reinvented.
 */
export function boardToRf(
  board: { nodes: BoardNode[]; edges: BoardEdge[] },
  readonly: boolean,
  nodeCallbacks?: NodeCallbacks,
  edgeCallbacks?: EdgeCallbacks,
  subBoard?: SubBoardAdapter,
): { nodes: BoardRfNode[]; edges: BoardRfEdge[] } {
  const frames = board.nodes.filter((n) => n.type === 'frame').sort((a, b) => a.order - b.order);
  const nonFrames = board.nodes.filter((n) => n.type !== 'frame').sort((a, b) => a.order - b.order);

  const nodes = [...frames, ...nonFrames].map((n) =>
    boardNodeToRf(n, readonly, nodeCallbacks, subBoard),
  );
  const edges = board.edges.map((e) => boardEdgeToRf(e, readonly ? undefined : edgeCallbacks));

  return { nodes, edges };
}

// ── Minimal write direction (Phase 4 owns the full interaction handlers) ─────

/** Read a position back off an RF node — e.g. after a drag-end event. */
export function rfNodeToPosition(node: Pick<BoardRfNode, 'position'>): XY {
  return { x: node.position.x, y: node.position.y };
}
