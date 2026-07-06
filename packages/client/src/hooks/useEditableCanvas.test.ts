// ── useEditableCanvas tests ───────────────────────────────────────────────────
//
// The hook that turns a doc-first BoardStore into ReactFlow's editable props
// (P4-T22). It owns RF's controlled nodes/edges state, subscribes to the store,
// runs the doc→RF reconcile (preserving selection/drag), and exposes the
// interaction handlers that COMMIT to the doc via the store's mutation API.
//
// These tests drive the handlers directly (the RF props) against a real store
// and assert the RIGHT ops land on the doc — the wiring contract. Real
// pointer-drag geometry is a browser concern (P4-T26 E2E); here we assert that
// e.g. `onNodeDragStop` commits the final position, `onConnect` adds an edge.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Connection } from '@xyflow/react';
import type { BoardFile } from '@easel/shared';
import type { BoardRfEdge, BoardRfNode } from '../canvas/rf-adapters.js';
import { createBoardStore } from '../store/board-store.js';
import { useEditableCanvas } from './useEditableCanvas.js';

/** Minimal RF node stand-in for driving handlers that only read id/position. */
function rfNode(id: string, x = 0, y = 0): BoardRfNode {
  return { id, position: { x, y } } as BoardRfNode;
}
function rfEdge(id: string): BoardRfEdge {
  return { id } as BoardRfEdge;
}

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 10, y: 20 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'hello',
        color: '#fef3c7',
      },
      {
        id: 's2',
        type: 'sticky',
        pos: { x: 300, y: 20 },
        order: 1,
        size: { width: 200, height: 160 },
        text: 'world',
        color: '#fef3c7',
      },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2', style: 'solid', kind: 'arrow', arrow: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('useEditableCanvas', () => {
  it('seeds RF nodes/edges from the store snapshot', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(['s1', 's2']);
    expect(result.current.edges.map((e) => e.id)).toEqual(['e1']);
    store.destroy();
  });

  it('onNodeDragStop commits the final position to the doc', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    const moved = rfNode('s1', 500, 600);
    act(() => {
      result.current.onNodeDragStop({} as MouseEvent, moved, [moved]);
    });
    const s1 = store.getSnapshot().nodes.find((n) => n.id === 's1');
    expect(s1?.pos).toEqual({ x: 500, y: 600 });
    store.destroy();
  });

  it('onNodeDragStop commits EVERY dragged node (multi-node drag)', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    const a = rfNode('s1', 1, 1);
    const b = rfNode('s2', 2, 2);
    act(() => {
      result.current.onNodeDragStop({} as MouseEvent, a, [a, b]);
    });
    const snap = store.getSnapshot();
    expect(snap.nodes.find((n) => n.id === 's1')?.pos).toEqual({ x: 1, y: 1 });
    expect(snap.nodes.find((n) => n.id === 's2')?.pos).toEqual({ x: 2, y: 2 });
    store.destroy();
  });

  it('onConnect adds a fresh edge to the doc with a generated id', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    const connection: Connection = {
      source: 's2',
      target: 's1',
      sourceHandle: null,
      targetHandle: null,
    };
    act(() => {
      result.current.onConnect(connection);
    });
    const edges = store.getSnapshot().edges;
    expect(edges).toHaveLength(2);
    const added = edges.find((e) => e.source === 's2' && e.target === 's1');
    expect(added).toBeDefined();
    // Fresh id, not colliding with the existing 'e1'.
    expect(added?.id).not.toBe('e1');
    store.destroy();
  });

  it('onConnect preserves source/target handles from the connection', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      result.current.onConnect({
        source: 's1',
        target: 's2',
        sourceHandle: 'r',
        targetHandle: 'l',
      });
    });
    const added = store.getSnapshot().edges.find((e) => e.id !== 'e1');
    expect(added?.sourceHandle).toBe('r');
    expect(added?.targetHandle).toBe('l');
    store.destroy();
  });

  it('onNodesDelete removes the node and its edges from the doc', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      result.current.onNodesDelete([rfNode('s1')]);
    });
    const snap = store.getSnapshot();
    expect(snap.nodes.some((n) => n.id === 's1')).toBe(false);
    expect(snap.edges.some((e) => e.id === 'e1')).toBe(false);
    store.destroy();
  });

  it('onEdgesDelete removes the edge from the doc', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      result.current.onEdgesDelete([rfEdge('e1')]);
    });
    expect(store.getSnapshot().edges.some((e) => e.id === 'e1')).toBe(false);
    store.destroy();
  });

  it('a doc update (op applied elsewhere) flows into RF nodes via reconcile', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      store.moveNode('s2', { x: 999, y: 999 });
    });
    const s2 = result.current.nodes.find((n) => n.id === 's2');
    expect(s2?.position).toEqual({ x: 999, y: 999 });
    store.destroy();
  });

  it('a doc update does not clear the selection of an unrelated node', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    // Select s1.
    act(() => {
      result.current.onSelectionChange({ nodes: [{ id: 's1' }], edges: [] });
    });
    expect(result.current.nodes.find((n) => n.id === 's1')?.selected).toBe(true);
    // Move an unrelated node in the doc.
    act(() => {
      store.moveNode('s2', { x: 999, y: 999 });
    });
    // s1 stays selected.
    expect(result.current.nodes.find((n) => n.id === 's1')?.selected).toBe(true);
    store.destroy();
  });

  it('deleting a selected node drops it from the selection', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      result.current.onSelectionChange({ nodes: [{ id: 's1' }], edges: [] });
    });
    act(() => {
      result.current.onNodesDelete([rfNode('s1')]);
    });
    expect(result.current.selectedNodeIds.has('s1')).toBe(false);
    store.destroy();
  });
});
