// ── useUndoRedo: collaboration-correct undo via Y.UndoManager ────────────────
//
// Plan v2 §3 / rough-edge a. The legacy client (src/components/BoardCanvas.tsx)
// undid by pushing a `structuredClone` of the WHOLE board onto a stack
// (MAX_UNDO=100) and restoring it wholesale. That's collaboration-hostile: an
// undo after a remote edit would clobber the remote peer's change, because
// "undo" meant "replace the entire board with an old snapshot" rather than
// "revert my own delta."
//
// `Y.UndoManager` fixes this at the CRDT level: it records per-origin deltas
// against the tracked Y types and can revert exactly those deltas, rebasing
// across any remote structural changes that happened in between. Scoping
// `trackedOrigins` to `LOCAL_ORIGIN` (every op in `@easel/shared`'s crdt/ops.ts
// commits under that origin by default) is what makes undo "mine only": a
// remote-origin transaction is never captured onto this client's stack, so it
// can never be undone here, and it is never disturbed by a local undo/redo
// either (Y.UndoManager only ever touches the structs it captured).
//
// Scope: the three maps + one array that make up the doc (crdt/schema.ts) —
// nodeData, nodeTexts, edgeData, annotations. Passing all four as the
// `typeScope` array means a single logical edit that touches more than one map
// (e.g. deleteNode touching nodeData + nodeTexts + edgeData in one transaction)
// undoes as ONE step, since Y.UndoManager groups by transaction, not by type.
//
// captureTimeout (~400ms) coalesces a burst of local transactions (a drag's
// final commit, rapid typing) that land within the window into a single undo
// step — mirroring the legacy's per-gesture (not per-keystroke) undo grain.
//
// Soft cap: unlike the legacy's MAX_UNDO=100 array-shift, Y.UndoManager's stack
// is an internal array of `StackItem`s (delta-based, not full clones) that we
// don't fully control the internals of. We trim it ourselves on
// 'stack-item-added' by shifting the oldest entries off `undoManager.undoStack`
// once it exceeds 100 — the array is documented/public (`UndoManager.undoStack:
// Array<StackItem>`), so a direct trim is safe and keeps unbounded history from
// accumulating in a long session, same intent as the legacy cap.

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { ANNOTATIONS, EDGE_DATA, LOCAL_ORIGIN, NODE_DATA, NODE_TEXTS } from '@easel/shared';
import type { BoardStore } from '../store/board-store.js';

/** Mirrors the legacy MAX_UNDO — a soft cap on the undo stack's length. */
const MAX_UNDO = 100;

/** ~400ms: coalesces a burst of local transactions into one undo step. */
const CAPTURE_TIMEOUT_MS = 400;

export interface UndoRedo {
  /** Revert this client's most recent local change (no-op if nothing to undo). */
  undo(): void;
  /** Re-apply the most recently undone local change (no-op if nothing to redo). */
  redo(): void;
  /** Whether there is a local change to undo. */
  canUndo: boolean;
  /** Whether there is an undone change to redo. */
  canRedo: boolean;
  /** Empty both stacks — call on external change (SSE) or board reload/history-restore. */
  clear(): void;
}

export function useUndoRedo(store: BoardStore): UndoRedo {
  const undoManager = useMemo(() => {
    const doc = store.doc;
    const scope = [
      doc.getMap(NODE_DATA),
      doc.getMap(NODE_TEXTS),
      doc.getMap(EDGE_DATA),
      doc.getArray(ANNOTATIONS),
    ];
    return new Y.UndoManager(scope, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: CAPTURE_TIMEOUT_MS,
    });
  }, [store]);

  const [canUndo, setCanUndo] = useState(() => undoManager.canUndo());
  const [canRedo, setCanRedo] = useState(() => undoManager.canRedo());

  useEffect(() => {
    const refresh = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    const onStackItemAdded = () => {
      // Soft cap (see module doc): trim the oldest entries once over MAX_UNDO.
      const stack = undoManager.undoStack;
      if (stack.length > MAX_UNDO) {
        stack.splice(0, stack.length - MAX_UNDO);
      }
      refresh();
    };

    undoManager.on('stack-item-added', onStackItemAdded);
    undoManager.on('stack-item-popped', refresh);
    undoManager.on('stack-cleared', refresh);

    // Sync initial state (constructing the manager doesn't fire these events).
    refresh();

    return () => {
      undoManager.off('stack-item-added', onStackItemAdded);
      undoManager.off('stack-item-popped', refresh);
      undoManager.off('stack-cleared', refresh);
      undoManager.destroy();
    };
  }, [undoManager]);

  return useMemo(
    () => ({
      undo: () => {
        undoManager.undo();
      },
      redo: () => {
        undoManager.redo();
      },
      canUndo,
      canRedo,
      clear: () => {
        undoManager.clear();
      },
    }),
    [undoManager, canUndo, canRedo],
  );
}
