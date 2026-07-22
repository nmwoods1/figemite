// ── The doc-first board store ─────────────────────────────────────────────────
//
// Plan v2 §3. The Y.Doc — not a React state tree — is the source of truth for
// nodes/edges, and every read goes through the shared `getSnapshot(doc)`.
// Mutations (Phase 4's ops-driven interaction handlers) write to the doc
// directly via `@figemite/shared`'s ops — this store doesn't wrap them, it just
// exposes `doc` so callers can.
//
// ── Hydration: two paths (P5-T29) ────────────────────────────────────────────
//
// How the doc gets its initial content depends on `opts`:
//
//   - `readonly: true` (static/READONLY mode) — hydrated ONCE from the fetched
//     `BoardFile` via the shared `loadBoardIntoDoc`. No provider, no network:
//     this is a local, disconnected doc that never changes after construction
//     (READONLY mode disables every mutation method below).
//
//   - `readonly: false` + `opts.room` given (the real editable app,
//     App.tsx's board route) — the doc starts EMPTY and joins the server room
//     via `lib/realtime.ts`'s `joinBoardRoom`, which attaches a
//     `WebsocketProvider`. The server (`@figemite/server`'s `YjsWebsocketService`,
//     P5-T28) is the single content writer: it seeds the room from disk and
//     persists it back on a debounce. This store does NOT call
//     `loadBoardIntoDoc` in this path — doing so would race/duplicate the
//     server's own seed and violate "server is the only writer of content."
//     The passed-in `initialBoard`'s nodes/edges are ignored for content in
//     this path; only its `viewport` is used (metadata, never CRDT content —
//     see below).
//
//   - `readonly: false` WITHOUT `opts.room` — a convenience/unit-test path
//     (every existing mutation-op unit test in this codebase constructs a
//     store this way, expecting synchronous local content with no network
//     involved). Behaves like the read-only path's hydration (immediate
//     `loadBoardIntoDoc`) but leaves mutations enabled. Real app code (the
//     board route) always supplies `room` for an editable board; this path
//     exists for tests, not for the shipped app.
//
// Referential stability (CRITICAL): `getSnapshot()` must return the SAME
// object reference across calls when nothing has changed, or
// `useSyncExternalStore` loops/throws ("getSnapshot should be cached"). We
// cache the last `{ nodes, edges }` result and only recompute it inside the
// Y.Doc's `update` observer — i.e. recomputation is driven by the doc actually
// changing, never by the act of reading. `getSnapshot()` itself never
// recomputes; it just returns whatever is currently cached.
//
// Viewport is board metadata, not doc content (it never needs to CRDT-merge
// across peers within this phase), so it's a separate small piece of state
// with its own cache + subscriber list, following the same reference-stability
// rule.

import * as Y from 'yjs';
import {
  addEdge as addEdgeOp,
  addNode as addNodeOp,
  deleteEdge as deleteEdgeOp,
  deleteNode as deleteNodeOp,
  getSnapshot as getDocSnapshot,
  loadBoardIntoDoc,
  moveNode as moveNodeOp,
  setNodeText as setNodeTextOp,
  updateEdge as updateEdgeOp,
  updateNode as updateNodeOp,
} from '@figemite/shared';
import type {
  ArrowStyle,
  BoardEdge,
  BoardFile,
  BoardNode,
  Cardinality,
  EdgeKind,
  EdgeRouting,
  LineStyle,
  WH,
  XY,
} from '@figemite/shared';
import type { Viewport } from '../canvas/coords.js';
import { joinBoardRoom } from '../lib/realtime.js';
import type { BoardRoom } from '../lib/realtime.js';

export type { Viewport };

export interface BoardSnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface BoardStoreOptions {
  readonly: boolean;
  /**
   * When given (and `readonly` is false), the store joins this room instead
   * of seeding the doc locally from the passed-in `BoardFile` — see this
   * module's doc for the two-hydration-paths rationale. Omitted for
   * read-only stores and for the unit-test local-seed convenience path. A
   * `draftId` scopes the room to a draft (`boards/<slug>/.drafts/<draftId>/`).
   */
  room?: { slug: string; path: string[]; draftId?: string };
}

export interface BoardStore {
  /** The underlying Y.Doc — exposed for Phase 4 (ops) and Phase 5 (provider). */
  doc: Y.Doc;
  /** Whether this store was created in read-only mode. */
  readonly: boolean;
  /** The joined realtime room (P5-T29), or `null` when this store hydrated
   * locally (read-only mode, or the no-`room` unit-test convenience path). */
  room: BoardRoom | null;
  /** Subscribe to node/edge changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Referentially-stable snapshot of the current nodes/edges (see module doc). */
  getSnapshot(): BoardSnapshot;
  /** Subscribe to viewport changes. Returns an unsubscribe function. */
  subscribeViewport(listener: () => void): () => void;
  /** Referentially-stable snapshot of the current viewport. */
  getViewport(): Viewport;
  /** Replace the viewport and notify viewport subscribers. */
  setViewport(vp: Viewport): void;

  // ── Mutation API (the doc-first write surface — see module doc) ─────────────
  //
  // Thin, typed wrappers over the shared `@figemite/shared` CRDT ops, so callers
  // (BoardCanvas's interaction handlers) commit through named methods rather
  // than importing raw ops. Every mutation is a NO-OP on a read-only store.

  /** Add a fully-built node to the doc (Toolbar's node-creation buttons — the
   * caller builds it via a shared `@figemite/shared` factory with a fresh id and
   * `order`). No-op if read-only. */
  addNode(node: BoardNode): void;
  /** Commit a node's final position to the doc. No-op if read-only. */
  moveNode(id: string, pos: XY): void;
  /** Delete nodes (and their dependent edges) from the doc. No-op if read-only. */
  deleteNodes(ids: string[]): void;
  /** Add an edge to the doc. No-op if read-only. */
  addEdge(edge: BoardEdge): void;
  /** Delete edges from the doc. No-op if read-only. */
  deleteEdges(ids: string[]): void;

  /** Merge an arbitrary patch of non-text fields into an existing node (e.g.
   * the Toolbar's color picker setting `{ color }`). No-op if read-only, and
   * a no-op if the node doesn't exist (see `@figemite/shared`'s `updateNode`). */
  updateNode(id: string, patch: Partial<BoardNode>): void;
  /** Commit a node's text/title (sticky/text/shape/emoji's `text`, frame's
   * `title`) to the doc via `nodeTexts`. No-op if read-only. */
  setNodeText(id: string, text: string): void;
  /** Commit a node's final size — `WH` for sticky/shape/frame/drawing, a
   * number for emoji/icon's square glyph size. No-op if read-only. */
  resizeNode(id: string, size: WH | number): void;
  /** Commit a node's rotation (degrees). No-op if read-only. */
  rotateNode(id: string, rotation: number): void;
  /**
   * Commit a combined position + size (+ points, for a drawing) patch in ONE
   * transaction — used by the multi-select group resize (P4-T24), which
   * needs to move AND resize every selected node atomically rather than as
   * two separate ops (moveNode then resizeNode) per node. No-op if read-only.
   */
  applyNodePatch(id: string, patch: { pos: XY; size?: WH | number; points?: XY[] }): void;

  // ── Edge styling (P4-T24; toolbar UI is P4-T25) ─────────────────────────────

  /** Set an edge's label (the inline-editable verb/description). An empty
   * string clears it. No-op if read-only. */
  setEdgeLabel(id: string, label: string): void;
  /** Set an edge's arrowhead style. No-op if read-only. */
  setEdgeArrow(id: string, arrow: ArrowStyle): void;
  /** Set an edge's line style (solid/dashed). No-op if read-only. */
  setEdgeLineStyle(id: string, style: LineStyle): void;
  /** Set an edge's routing style (bezier/straight/elbow). No-op if read-only. */
  setEdgeRouting(id: string, routing: EdgeRouting): void;
  /** Set an edge's cardinality value (meaningful when kind === 'cardinality'). No-op if read-only. */
  setEdgeCardinality(id: string, cardinality: Cardinality): void;
  /**
   * Switch an edge between 'arrow' and 'cardinality' kind, moving the
   * kind-specific fields appropriately: switching TO 'cardinality' sets a
   * default cardinality ('1:N') and clears `arrow`; switching TO 'arrow' sets
   * a default arrow ('end') and clears `cardinality`. No-op if read-only.
   */
  setEdgeKind(id: string, kind: EdgeKind): void;
  /**
   * Move an existing edge's endpoints to a new source/target (and handles) —
   * the ReactFlow drag-to-reconnect gesture. Preserves the edge id, so its
   * label/style/arrow/kind/cardinality all carry over. No-op if read-only or
   * the edge is absent (see `@figemite/shared`'s `updateEdge`).
   */
  reconnectEdge(id: string, endpoints: EdgeEndpoints): void;

  /** Detach all observers and destroy the underlying Y.Doc. */
  destroy(): void;
}

/** New endpoints for {@link BoardStore.reconnectEdge}. `null` handles (what
 * ReactFlow hands back when an edge lands on a node's default drop target
 * rather than a specific handle) are normalised to "no handle". */
export interface EdgeEndpoints {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function createBoardStore(initialBoard: BoardFile, opts: BoardStoreOptions): BoardStore {
  const doc = new Y.Doc();

  // ── Hydration (see module doc for the two-paths rationale) ──────────────────
  const room: BoardRoom | null =
    !opts.readonly && opts.room
      ? joinBoardRoom(doc, opts.room.slug, opts.room.path, opts.room.draftId)
      : null;

  if (!room) {
    // Read-only, or the no-`room` unit-test convenience path: hydrate
    // immediately from the passed-in BoardFile. A room-joined store
    // deliberately skips this — its content arrives from the server via the
    // provider's sync, not from the fetched BoardFile (see module doc).
    loadBoardIntoDoc(doc, { nodes: initialBoard.nodes, edges: initialBoard.edges });
  }

  // ── Node/edge snapshot cache ────────────────────────────────────────────────
  let snapshot: BoardSnapshot = getDocSnapshot(doc);
  const listeners = new Set<() => void>();

  const onDocUpdate = () => {
    snapshot = getDocSnapshot(doc);
    for (const listener of listeners) listener();
  };
  doc.on('update', onDocUpdate);

  // ── Viewport cache (board metadata, not doc content) ────────────────────────
  let viewport: Viewport = { ...initialBoard.viewport };
  const viewportListeners = new Set<() => void>();

  let destroyed = false;

  return {
    doc,
    readonly: opts.readonly,
    room,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    subscribeViewport(listener: () => void) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },

    getViewport() {
      return viewport;
    },

    setViewport(vp: Viewport) {
      viewport = { ...vp };
      for (const listener of viewportListeners) listener();
    },

    // ── Mutation API ──────────────────────────────────────────────────────────
    // Each guards on `readonly` up front, then delegates to the shared op. The
    // op runs `doc.transact(..., LOCAL_ORIGIN)`, which fires the doc `update`
    // observer above — refreshing the cached snapshot and notifying subscribers.
    // The ops themselves are no-ops when the target id is absent, so callers
    // don't have to pre-check existence.

    addNode(node: BoardNode) {
      if (opts.readonly) return;
      addNodeOp(doc, node);
    },

    moveNode(id: string, pos: XY) {
      if (opts.readonly) return;
      moveNodeOp(doc, id, pos);
    },

    deleteNodes(ids: string[]) {
      if (opts.readonly) return;
      for (const id of ids) deleteNodeOp(doc, id);
    },

    addEdge(edge: BoardEdge) {
      if (opts.readonly) return;
      addEdgeOp(doc, edge);
    },

    deleteEdges(ids: string[]) {
      if (opts.readonly) return;
      for (const id of ids) deleteEdgeOp(doc, id);
    },

    updateNode(id: string, patch: Partial<BoardNode>) {
      if (opts.readonly) return;
      updateNodeOp(doc, id, patch);
    },

    setNodeText(id: string, text: string) {
      if (opts.readonly) return;
      setNodeTextOp(doc, id, text);
    },

    resizeNode(id: string, size: WH | number) {
      if (opts.readonly) return;
      updateNodeOp(doc, id, { size } as Partial<BoardNode>);
    },

    rotateNode(id: string, rotation: number) {
      if (opts.readonly) return;
      updateNodeOp(doc, id, { rotation } as Partial<BoardNode>);
    },

    applyNodePatch(id: string, patch: { pos: XY; size?: WH | number; points?: XY[] }) {
      if (opts.readonly) return;
      updateNodeOp(doc, id, { ...patch } as Partial<BoardNode>);
    },

    setEdgeLabel(id: string, label: string) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, { label: label || undefined });
    },

    setEdgeArrow(id: string, arrow: ArrowStyle) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, { arrow });
    },

    setEdgeLineStyle(id: string, style: LineStyle) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, { style });
    },

    setEdgeRouting(id: string, routing: EdgeRouting) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, { routing });
    },

    setEdgeCardinality(id: string, cardinality: Cardinality) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, { cardinality });
    },

    setEdgeKind(id: string, kind: EdgeKind) {
      if (opts.readonly) return;
      if (kind === 'cardinality') {
        const existing = snapshot.edges.find((e) => e.id === id);
        updateEdgeOp(doc, id, {
          kind,
          cardinality: existing?.cardinality ?? '1:N',
          arrow: undefined,
        });
      } else {
        const existing = snapshot.edges.find((e) => e.id === id);
        updateEdgeOp(doc, id, { kind, arrow: existing?.arrow ?? 'end', cardinality: undefined });
      }
    },

    reconnectEdge(id, endpoints) {
      if (opts.readonly) return;
      updateEdgeOp(doc, id, {
        source: endpoints.source,
        target: endpoints.target,
        sourceHandle: endpoints.sourceHandle ?? undefined,
        targetHandle: endpoints.targetHandle ?? undefined,
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('update', onDocUpdate);
      listeners.clear();
      viewportListeners.clear();
      room?.destroy();
      doc.destroy();
    },
  };
}
