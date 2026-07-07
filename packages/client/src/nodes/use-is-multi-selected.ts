// ── useIsMultiSelected ────────────────────────────────────────────────────────
//
// Ported from the prototype's src/lib/use-is-multi-selected.ts. Returns true when
// 2+ nodes are currently selected in the ReactFlow store. Each resizable/
// rotatable node component uses this to suppress its own per-node
// `NodeResizer`/rotation handle while `MultiSelectResizer`'s group bounding
// box is active — otherwise the canvas would show two competing sets of
// resize handles (one per node AND the group box) at once.

import { useStore } from '@xyflow/react';

export function useIsMultiSelected(): boolean {
  return useStore((s) => {
    let count = 0;
    for (const n of s.nodeLookup.values()) {
      if (n.selected) {
        count++;
        if (count >= 2) return true;
      }
    }
    return false;
  });
}
