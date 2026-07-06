// ── The doc-first board store ─────────────────────────────────────────────────
//
// Plan v2 §3. The Y.Doc — not a React state tree — is the source of truth for
// nodes/edges: it's hydrated once from the initial BoardFile via the shared
// `loadBoardIntoDoc`, and every subsequent read goes through the shared
// `getSnapshot(doc)`. Mutations (Phase 4's ops-driven interaction handlers,
// Phase 5's realtime provider) write to the doc directly via `@easel/shared`'s
// ops — this store doesn't wrap them, it just exposes `doc` so callers can.
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
import { getSnapshot as getDocSnapshot, loadBoardIntoDoc } from '@easel/shared';
import type { BoardEdge, BoardFile, BoardNode } from '@easel/shared';
import type { Viewport } from '../canvas/coords.js';

export type { Viewport };

export interface BoardSnapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface BoardStoreOptions {
  readonly: boolean;
}

export interface BoardStore {
  /** The underlying Y.Doc — exposed for Phase 4 (ops) and Phase 5 (provider). */
  doc: Y.Doc;
  /** Whether this store was created in read-only mode. */
  readonly: boolean;
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
  /** Detach all observers and destroy the underlying Y.Doc. */
  destroy(): void;
}

export function createBoardStore(initialBoard: BoardFile, opts: BoardStoreOptions): BoardStore {
  const doc = new Y.Doc();
  loadBoardIntoDoc(doc, { nodes: initialBoard.nodes, edges: initialBoard.edges });

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

    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('update', onDocUpdate);
      listeners.clear();
      viewportListeners.clear();
      doc.destroy();
    },
  };
}
