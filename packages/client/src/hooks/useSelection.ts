// ── useSelection: selection as first-class state ──────────────────────────────
//
// Plan v2 §3 / P4-T22. ReactFlow tracks a `selected` boolean per node/edge, but
// that lives on the transient RF objects — which the doc→RF reconciler rebuilds
// on every doc update. If selection lived only there, every remote/AI/undo doc
// change would risk dropping it. So selection is hoisted OUT of RF into its own
// state (two id Sets) and RF's flags become a projection of it.
//
// The flow:
//   - RF's `onSelectionChange(params)` → `setSelection(params)`: we snapshot the
//     ids of whatever RF says is selected (marquee, click, shift-click…).
//   - After a doc→RF reconcile, `applySelection(nodes, edges)` stamps the RF
//     `selected` flags back on from our Sets — so a reconcile that rebuilt the
//     node objects doesn't lose the highlight. Reference-stable: if the flags
//     already match, the input arrays are returned untouched (no churn).
//   - `pruneSelection(liveNodeIds, liveEdgeIds)` drops ids the doc no longer has
//     (a deleted node must leave the selection). Also reference-stable: if
//     nothing was dropped, the same Set objects are kept so downstream effects
//     don't re-fire.
//
// Selection "survives a doc update by construction": doc updates go through
// reconcile + applySelection + pruneSelection, none of which can resurrect a
// stale highlight or clear a live one.

import { useCallback, useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';

export interface SelectionParams {
  nodes: Pick<Node, 'id'>[];
  edges: Pick<Edge, 'id'>[];
}

export interface Selection {
  /** Ids of the currently-selected nodes. */
  selectedNodeIds: Set<string>;
  /** Ids of the currently-selected edges. */
  selectedEdgeIds: Set<string>;
  /** Record the ids of RF's currently-selected nodes/edges (the onSelectionChange sink). */
  setSelection(params: SelectionParams): void;
  /** Drop selected ids not present in the given live id sets (post-doc-update). */
  pruneSelection(liveNodeIds: Set<string>, liveEdgeIds: Set<string>): void;
  /** Project the current selection onto RF nodes/edges (`selected` flags). */
  applySelection<
    N extends { id: string; selected?: boolean },
    E extends { id: string; selected?: boolean },
  >(
    nodes: N[],
    edges: E[],
  ): { nodes: N[]; edges: E[] };
}

/** Keep only the members of `set` that appear in `live`; return the SAME set if
 * nothing was dropped (so identity-based effects don't re-fire needlessly). */
function intersect(set: Set<string>, live: Set<string>): Set<string> {
  let dropped = false;
  const next = new Set<string>();
  for (const id of set) {
    if (live.has(id)) next.add(id);
    else dropped = true;
  }
  return dropped ? next : set;
}

/** Stamp `selected` onto each element to match `ids`; return the SAME array when
 * every flag is already correct (avoids allocating and re-rendering unchanged). */
function stampSelected<T extends { id: string; selected?: boolean }>(
  items: T[],
  ids: Set<string>,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    const shouldSelect = ids.has(item.id);
    if ((item.selected ?? false) === shouldSelect) return item;
    changed = true;
    return { ...item, selected: shouldSelect };
  });
  return changed ? next : items;
}

export function useSelection(): Selection {
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());

  const setSelection = useCallback((params: SelectionParams) => {
    setSelectedNodeIds(new Set(params.nodes.map((n) => n.id)));
    setSelectedEdgeIds(new Set(params.edges.map((e) => e.id)));
  }, []);

  const pruneSelection = useCallback((liveNodeIds: Set<string>, liveEdgeIds: Set<string>) => {
    setSelectedNodeIds((prev) => intersect(prev, liveNodeIds));
    setSelectedEdgeIds((prev) => intersect(prev, liveEdgeIds));
  }, []);

  const applySelection = useCallback(
    <N extends { id: string; selected?: boolean }, E extends { id: string; selected?: boolean }>(
      nodes: N[],
      edges: E[],
    ) => ({
      nodes: stampSelected(nodes, selectedNodeIds),
      edges: stampSelected(edges, selectedEdgeIds),
    }),
    [selectedNodeIds, selectedEdgeIds],
  );

  return useMemo(
    () => ({ selectedNodeIds, selectedEdgeIds, setSelection, pruneSelection, applySelection }),
    [selectedNodeIds, selectedEdgeIds, setSelection, pruneSelection, applySelection],
  );
}
