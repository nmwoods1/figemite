// ── doc→RF reconciler tests ───────────────────────────────────────────────────
//
// The reconciler is how a doc update flows into ReactFlow's controlled state
// WITHOUT (a) blowing away RF's transient per-node UI state (`selected`, an
// in-flight `dragging` flag, `measured` dimensions) and (b) thrashing React
// with a fresh array/objects on every doc tick even when nothing changed.
//
// It merges `next` (doc-derived, from boardToRf) onto `prev` (RF's current
// controlled nodes/edges): doc-authoritative fields (position, data, zIndex…)
// come from `next`; transient fields carried by RF come from `prev`. It is
// idempotent by reference: reconciling against an unchanged doc returns the
// SAME `prev` array (and the SAME element objects), so a redundant reconcile is
// a cheap identity check the caller can skip re-rendering on.

import { describe, it, expect } from 'vitest';
import type { BoardRfEdge, BoardRfNode } from './rf-adapters.js';
import { reconcileNodes, reconcileEdges } from './reconcile.js';

function rfNode(id: string, x: number, y: number, extra: Partial<BoardRfNode> = {}): BoardRfNode {
  return {
    id,
    type: 'sticky',
    position: { x, y },
    data: { text: 'hi', color: '#fff', width: 200, height: 160 },
    zIndex: 0,
    draggable: true,
    selectable: true,
    ...extra,
  } as BoardRfNode;
}

function rfEdge(id: string, source: string, target: string): BoardRfEdge {
  return {
    id,
    source,
    target,
    type: 'arrow',
    data: { label: undefined, style: 'solid', kind: 'arrow', arrow: 'end', cardinality: '1:N' },
  } as BoardRfEdge;
}

describe('reconcileNodes', () => {
  it('adopts the doc-derived position for a moved node', () => {
    const prev = [rfNode('a', 0, 0), rfNode('b', 100, 100)];
    const next = [rfNode('a', 0, 0), rfNode('b', 250, 300)];
    const result = reconcileNodes(prev, next);
    const b = result.find((n) => n.id === 'b');
    expect(b?.position).toEqual({ x: 250, y: 300 });
  });

  it('preserves a transient `selected` flag on an UNRELATED node when another node moves', () => {
    // `a` is selected in RF; the doc moves `b`. Reconciling must keep a.selected.
    const prev = [rfNode('a', 0, 0, { selected: true }), rfNode('b', 100, 100)];
    const next = [rfNode('a', 0, 0), rfNode('b', 250, 300)]; // doc has no `selected`
    const result = reconcileNodes(prev, next);
    const a = result.find((n) => n.id === 'a');
    expect(a?.selected).toBe(true);
  });

  it('preserves an in-flight `dragging` flag from RF', () => {
    const prev = [rfNode('a', 0, 0, { dragging: true, selected: true })];
    const next = [rfNode('a', 5, 5)];
    const result = reconcileNodes(prev, next);
    const a = result.find((n) => n.id === 'a');
    expect(a?.dragging).toBe(true);
    expect(a?.selected).toBe(true);
    expect(a?.position).toEqual({ x: 5, y: 5 });
  });

  it('adds a node that appeared in the doc', () => {
    const prev = [rfNode('a', 0, 0)];
    const next = [rfNode('a', 0, 0), rfNode('c', 500, 500)];
    const result = reconcileNodes(prev, next);
    expect(result.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('removes a node that disappeared from the doc', () => {
    const prev = [rfNode('a', 0, 0), rfNode('b', 100, 100)];
    const next = [rfNode('a', 0, 0)];
    const result = reconcileNodes(prev, next);
    expect(result.map((n) => n.id)).toEqual(['a']);
  });

  it('follows the doc-derived ordering (frames-behind ordering survives)', () => {
    const prev = [rfNode('a', 0, 0), rfNode('b', 0, 0)];
    const next = [rfNode('b', 0, 0), rfNode('a', 0, 0)];
    const result = reconcileNodes(prev, next);
    expect(result.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('is idempotent: an unchanged doc returns the SAME array reference', () => {
    const prev = [rfNode('a', 0, 0, { selected: true }), rfNode('b', 100, 100)];
    // `next` is freshly built (as boardToRf would produce on every doc tick)
    // but describes the identical non-transient state.
    const next = [rfNode('a', 0, 0), rfNode('b', 100, 100)];
    const result = reconcileNodes(prev, next);
    expect(result).toBe(prev);
  });

  it('keeps the SAME element object for an unchanged node when only a sibling moved', () => {
    const prev = [rfNode('a', 0, 0, { selected: true }), rfNode('b', 100, 100)];
    const next = [rfNode('a', 0, 0), rfNode('b', 250, 300)];
    const result = reconcileNodes(prev, next);
    const aPrev = prev.find((n) => n.id === 'a');
    const aResult = result.find((n) => n.id === 'a');
    // `a` didn't change, so its object identity is preserved (no needless
    // re-render of that node); `b` did change, so it's a new object.
    expect(aResult).toBe(aPrev);
    expect(result).not.toBe(prev);
  });

  it('updates a node whose doc data changed (e.g. recolor) while preserving selection', () => {
    const prev = [rfNode('a', 0, 0, { selected: true })];
    const next = [
      rfNode('a', 0, 0, { data: { text: 'hi', color: '#f00', width: 200, height: 160 } }),
    ];
    const result = reconcileNodes(prev, next);
    const a = result.find((n) => n.id === 'a');
    expect((a?.data as { color: string }).color).toBe('#f00');
    expect(a?.selected).toBe(true);
  });
});

describe('reconcileEdges', () => {
  it('adds an edge that appeared in the doc', () => {
    const prev = [rfEdge('e1', 'a', 'b')];
    const next = [rfEdge('e1', 'a', 'b'), rfEdge('e2', 'b', 'c')];
    const result = reconcileEdges(prev, next);
    expect(result.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('removes an edge that disappeared from the doc', () => {
    const prev = [rfEdge('e1', 'a', 'b'), rfEdge('e2', 'b', 'c')];
    const next = [rfEdge('e1', 'a', 'b')];
    const result = reconcileEdges(prev, next);
    expect(result.map((e) => e.id)).toEqual(['e1']);
  });

  it('preserves a transient `selected` flag on an edge across a doc update', () => {
    const prev = [{ ...rfEdge('e1', 'a', 'b'), selected: true }, rfEdge('e2', 'b', 'c')];
    const next = [rfEdge('e1', 'a', 'b'), rfEdge('e2', 'b', 'c')];
    const result = reconcileEdges(prev, next);
    const e1 = result.find((e) => e.id === 'e1');
    expect(e1?.selected).toBe(true);
  });

  it('is idempotent: an unchanged doc returns the SAME array reference', () => {
    const prev = [{ ...rfEdge('e1', 'a', 'b'), selected: true }];
    const next = [rfEdge('e1', 'a', 'b')];
    const result = reconcileEdges(prev, next);
    expect(result).toBe(prev);
  });
});
