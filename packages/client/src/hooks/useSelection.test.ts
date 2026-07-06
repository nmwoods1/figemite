// ── useSelection tests ────────────────────────────────────────────────────────
//
// Selection is first-class state living OUTSIDE ReactFlow's node/edge objects
// (P4-T22). RF's `selected` flags are a projection of it, not the source of
// truth — so selection survives a doc→RF reconcile by construction (the doc
// update never touches these Sets). The hook:
//   - exposes the current selected node/edge id Sets;
//   - `setSelection` is the `onSelectionChange` sink (RF hands us the selected
//     nodes/edges; we store their ids);
//   - `pruneSelection(nodeIds, edgeIds)` drops ids no longer present in the doc
//     (called after a doc update so a deleted node leaves the selection);
//   - `applySelection(nodes, edges)` stamps RF's `selected` flags to match,
//     returning the SAME arrays when nothing changed (reference-stable).

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { useSelection } from './useSelection.js';

function node(id: string, selected = false): Node {
  return { id, type: 'sticky', position: { x: 0, y: 0 }, data: {}, selected } as Node;
}
function edge(id: string, selected = false): Edge {
  return { id, source: 'a', target: 'b', selected } as Edge;
}

describe('useSelection', () => {
  it('starts with an empty selection', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selectedNodeIds.size).toBe(0);
    expect(result.current.selectedEdgeIds.size).toBe(0);
  });

  it('setSelection records the ids of the selected nodes and edges', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setSelection({ nodes: [node('n1'), node('n2')], edges: [edge('e1')] });
    });
    expect([...result.current.selectedNodeIds].sort()).toEqual(['n1', 'n2']);
    expect([...result.current.selectedEdgeIds]).toEqual(['e1']);
  });

  it('setSelection replaces the previous selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.setSelection({ nodes: [node('n1')], edges: [] }));
    act(() => result.current.setSelection({ nodes: [node('n2')], edges: [] }));
    expect([...result.current.selectedNodeIds]).toEqual(['n2']);
  });

  it('selection survives an unrelated prune (node still present stays selected)', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.setSelection({ nodes: [node('n1')], edges: [] }));
    // A doc update happened but n1 is still present.
    act(() => result.current.pruneSelection(new Set(['n1', 'n2']), new Set()));
    expect([...result.current.selectedNodeIds]).toEqual(['n1']);
  });

  it('pruneSelection drops a node id that no longer exists in the doc', () => {
    const { result } = renderHook(() => useSelection());
    act(() =>
      result.current.setSelection({ nodes: [node('n1'), node('n2')], edges: [edge('e1')] }),
    );
    // n2 and e1 were deleted from the doc.
    act(() => result.current.pruneSelection(new Set(['n1']), new Set()));
    expect([...result.current.selectedNodeIds]).toEqual(['n1']);
    expect(result.current.selectedEdgeIds.size).toBe(0);
  });

  it('pruneSelection is a no-op (same Set refs) when nothing was dropped', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.setSelection({ nodes: [node('n1')], edges: [edge('e1')] }));
    const beforeNodes = result.current.selectedNodeIds;
    const beforeEdges = result.current.selectedEdgeIds;
    act(() => result.current.pruneSelection(new Set(['n1', 'x']), new Set(['e1', 'y'])));
    expect(result.current.selectedNodeIds).toBe(beforeNodes);
    expect(result.current.selectedEdgeIds).toBe(beforeEdges);
  });

  it('applySelection stamps `selected` onto the matching RF nodes/edges', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.setSelection({ nodes: [node('n1')], edges: [edge('e1')] }));

    const nodes = [node('n1'), node('n2')];
    const edges = [edge('e1'), edge('e2')];
    const applied = result.current.applySelection(nodes, edges);

    expect(applied.nodes.find((n) => n.id === 'n1')?.selected).toBe(true);
    expect(applied.nodes.find((n) => n.id === 'n2')?.selected).toBe(false);
    expect(applied.edges.find((e) => e.id === 'e1')?.selected).toBe(true);
    expect(applied.edges.find((e) => e.id === 'e2')?.selected).toBe(false);
  });

  it('applySelection returns the SAME arrays when flags already match', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.setSelection({ nodes: [node('n1')], edges: [] }));

    const nodes = [node('n1', true), node('n2', false)];
    const edges = [edge('e1', false)];
    const applied = result.current.applySelection(nodes, edges);
    // Flags already correct → no new arrays (reference-stable, avoids churn).
    expect(applied.nodes).toBe(nodes);
    expect(applied.edges).toBe(edges);
  });

  it('applySelection flips a stale selected flag off', () => {
    const { result } = renderHook(() => useSelection());
    // Nothing selected in our state, but RF node carries a stale selected=true.
    const nodes = [node('n1', true)];
    const applied = result.current.applySelection(nodes, []);
    expect(applied.nodes[0].selected).toBe(false);
  });
});
