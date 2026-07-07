// ── useMultiSelectResize: the store-commit half of group resize (P4-T24) ────
//
// `MultiSelectResizer` (canvas/MultiSelectResizer.tsx) is pure UI/geometry —
// it computes a `ScaleSpec` (factor + anchor + each selected node's pre-drag
// rect) from pointer movement and hands it up via `onScale`. This hook is
// where that spec becomes a doc commit: for every selected node, it looks up
// the node's pre-drag rect, computes the per-type patch via
// `multi-select-scale.ts`'s pure `scaleNodeForGroupResize`, and commits ALL
// of it (pos + size + points) in ONE `store.applyNodePatch` call per node —
// never two separate ops, so a group-resize tick can't split into a
// half-applied intermediate state.
//
// `onScale`/`onScaleStart` are memoized on `store` alone (mirroring
// `useEditableCanvas`'s `useNodeCallbacks` stability rationale) — not load-
// bearing for the reconciler here (this hook's return isn't attached to RF
// node `data`), but keeping the same discipline avoids the handler being
// re-created every render, which would otherwise re-run `MultiSelectResizer`'s
// mousemove effect on every tick.

import { useCallback, useMemo } from 'react';
import type { BoardNode } from '@figemite/shared';
import type { BoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { scaleNodeForGroupResize } from '../canvas/multi-select-scale.js';
import type { MultiSelectScaleEvent } from '../canvas/MultiSelectResizer.js';

export interface MultiSelectResize {
  /** The live BoardNodes for the given selected ids (for the overlay's bbox/geometry). */
  selectedNodes: BoardNode[];
  /** Called once when a group-resize drag begins. */
  onScaleStart: () => void;
  /** Called on every drag tick; commits the scaled patch for every selected node. */
  onScale: (spec: MultiSelectScaleEvent) => void;
}

export function useMultiSelectResize(
  store: BoardStore,
  selectedNodeIds: Set<string>,
): MultiSelectResize {
  const snapshot = useBoardStore(store);

  const selectedNodes = useMemo(
    () => snapshot.nodes.filter((n) => selectedNodeIds.has(n.id)),
    [snapshot, selectedNodeIds],
  );

  const onScaleStart = useCallback(() => {
    // No explicit "push a snapshot" step needed: Y.UndoManager (useUndoRedo,
    // P4-T23) captures every LOCAL_ORIGIN transaction automatically and
    // coalesces a drag's ticks within its ~400ms window into one undo step.
  }, []);

  const onScale = useCallback(
    (spec: MultiSelectScaleEvent) => {
      for (const node of store.getSnapshot().nodes) {
        const rect = spec.originalRects.get(node.id);
        if (!rect) continue;
        const patch = scaleNodeForGroupResize(node, rect, spec);
        store.applyNodePatch(node.id, patch);
      }
    },
    [store],
  );

  return { selectedNodes, onScaleStart, onScale };
}
