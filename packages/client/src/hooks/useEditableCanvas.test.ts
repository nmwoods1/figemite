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

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Connection } from '@xyflow/react';
import type { BoardFile } from '@figemite/shared';
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

  it('onReconnect moves an edge endpoint in place, preserving the edge id and styling', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    store.addNode({ id: 's3', type: 'text', pos: { x: 600, y: 20 }, order: 2, text: 'third' });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      result.current.onReconnect(rfEdge('e1'), {
        source: 's1',
        target: 's3',
        sourceHandle: null,
        targetHandle: null,
      });
    });
    const e1 = store.getSnapshot().edges.find((e) => e.id === 'e1');
    expect(e1).toMatchObject({ id: 'e1', source: 's1', target: 's3', arrow: 'end' });
    store.destroy();
  });

  it('onReconnect ignores a connection missing a source or target', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useEditableCanvas(store));
    act(() => {
      // RF types `Connection.target` as a (non-null) string; an empty string is
      // the falsy value the handler guards against (a drop into empty space).
      result.current.onReconnect(rfEdge('e1'), {
        source: 's1',
        target: '',
        sourceHandle: null,
        targetHandle: null,
      });
    });
    // Unchanged — still points at the original target.
    expect(store.getSnapshot().edges.find((e) => e.id === 'e1')).toMatchObject({ target: 's2' });
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

  // ── P4-T24: editing callbacks injected into node data ───────────────────────

  describe('injected node-data callbacks', () => {
    it("wires a sticky node's onTextChange to commit via setNodeText", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      const onTextChange = s1?.data.onTextChange as (id: string, text: string) => void;
      expect(onTextChange).toBeTypeOf('function');
      act(() => {
        onTextChange('s1', 'updated');
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(snap).toMatchObject({ text: 'updated' });
      store.destroy();
    });

    it("wires a frame node's onTitleChange to commit via setNodeText (title)", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 480, height: 320 },
        title: 'Old',
        color: '#fef3c7',
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const f1 = result.current.nodes.find((n) => n.id === 'f1');
      const onTitleChange = f1?.data.onTitleChange as (id: string, title: string) => void;
      expect(onTitleChange).toBeTypeOf('function');
      act(() => {
        onTitleChange('f1', 'New title');
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 'f1');
      expect(snap).toMatchObject({ title: 'New title' });
      store.destroy();
    });

    it('wires onOpenDescription as a callable no-op seam when no callback is given', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      const onOpenDescription = s1?.data.onOpenDescription as (id: string) => void;
      expect(onOpenDescription).toBeTypeOf('function');
      expect(() => onOpenDescription('s1')).not.toThrow();
      store.destroy();
    });

    it('wires a caller-supplied onOpenDescription through to node data (P4-T25 DescriptionModal seam)', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const onOpenDescription = vi.fn();
      const { result } = renderHook(() => useEditableCanvas(store, { onOpenDescription }));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      const handler = s1?.data.onOpenDescription as (id: string) => void;
      handler('s1');
      expect(onOpenDescription).toHaveBeenCalledWith('s1');
      store.destroy();
    });

    it('read-only nodes are never given editing callbacks', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      expect(s1?.data.onTextChange).toBeUndefined();
      expect(s1?.data.onOpenDescription).toBeUndefined();
      store.destroy();
    });

    it('injected callbacks are referentially stable across re-renders (reconciler idempotence)', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result, rerender } = renderHook(() => useEditableCanvas(store));
      const before = result.current.nodes.find((n) => n.id === 's1')?.data.onTextChange;
      rerender();
      const after = result.current.nodes.find((n) => n.id === 's1')?.data.onTextChange;
      expect(after).toBe(before);
      store.destroy();
    });

    it('injected callbacks stay stable across an UNRELATED doc update', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const before = result.current.nodes.find((n) => n.id === 's1')?.data.onTextChange;
      act(() => {
        store.moveNode('s2', { x: 42, y: 42 });
      });
      const after = result.current.nodes.find((n) => n.id === 's1')?.data.onTextChange;
      expect(after).toBe(before);
      store.destroy();
    });

    it('a doc update caused by a commit through an injected callback does not change node identity for an untouched node', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s2Before = result.current.nodes.find((n) => n.id === 's2');
      const onTextChange = result.current.nodes.find((n) => n.id === 's1')?.data.onTextChange as (
        id: string,
        text: string,
      ) => void;
      act(() => {
        onTextChange('s1', 'changed');
      });
      const s2After = result.current.nodes.find((n) => n.id === 's2');
      // reconcile.ts's idempotence guarantee: an object untouched by the
      // commit keeps its reference across the doc tick this commit causes.
      expect(s2After).toBe(s2Before);
      store.destroy();
    });

    it("wires a sticky node's onResizeEnd to commit via resizeNode", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      const onResizeEnd = s1?.data.onResizeEnd as (
        id: string,
        size: { width: number; height: number },
      ) => void;
      expect(onResizeEnd).toBeTypeOf('function');
      act(() => {
        onResizeEnd('s1', { width: 300, height: 220 });
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(snap).toMatchObject({ size: { width: 300, height: 220 } });
      store.destroy();
    });

    it("wires an emoji node's onResizeEnd (square) to commit a single numeric size via resizeNode", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'em1',
        type: 'emoji',
        pos: { x: 0, y: 0 },
        order: 2,
        text: '🎉',
        size: 64,
      });
      const store = createBoardStore(board, { readonly: false });
      // `snapEnabled: false` keeps this a pure "the numeric-size seam reaches
      // resizeNode" wiring test — grid-snapping of the size is covered by the
      // dedicated snap tests below (96 would otherwise round to 100).
      const { result } = renderHook(() => useEditableCanvas(store, { snapEnabled: false }));
      const em1 = result.current.nodes.find((n) => n.id === 'em1');
      const onResizeEnd = em1?.data.onResizeEnd as (id: string, size: number) => void;
      expect(onResizeEnd).toBeTypeOf('function');
      act(() => {
        onResizeEnd('em1', 96);
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 'em1');
      expect(snap).toMatchObject({ size: 96 });
      store.destroy();
    });

    // ── Grid-snap on committed resize sizes (client-only view pref) ──────────
    // When `snapEnabled` is true, a committed resize is rounded to the grid
    // via canvas/coords.ts's `snapSize`; when false, the raw size passes
    // through. The flag is read through a ref so toggling it never churns the
    // node-callbacks memo — asserted directly by the identity test below.

    it('keeps the node-callbacks bag reference-stable when snapEnabled toggles', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result, rerender } = renderHook(
        ({ snap }: { snap: boolean }) => useEditableCanvas(store, { snapEnabled: snap }),
        { initialProps: { snap: true } },
      );
      const before = result.current.nodes.find((n) => n.id === 's1')?.data.onResizeEnd;
      // Flip the preference — the ref indirection means the memoized callbacks
      // (keyed on [store]) must NOT be rebuilt, so node data stays identical.
      rerender({ snap: false });
      const after = result.current.nodes.find((n) => n.id === 's1')?.data.onResizeEnd;
      expect(after).toBe(before);
      store.destroy();
    });

    it('snaps a committed resize to the grid when snapEnabled is true', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store, { snapEnabled: true }));
      const onResizeEnd = result.current.nodes.find((n) => n.id === 's1')?.data.onResizeEnd as (
        id: string,
        size: { width: number; height: number },
      ) => void;
      act(() => {
        onResizeEnd('s1', { width: 137, height: 82 });
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 's1');
      // snapSize rounds to the nearest 20: 137 -> 140, 82 -> 80.
      expect(snap).toMatchObject({ size: { width: 140, height: 80 } });
      store.destroy();
    });

    it('commits the raw resize size unchanged when snapEnabled is false', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store, { snapEnabled: false }));
      const onResizeEnd = result.current.nodes.find((n) => n.id === 's1')?.data.onResizeEnd as (
        id: string,
        size: { width: number; height: number },
      ) => void;
      act(() => {
        onResizeEnd('s1', { width: 137, height: 82 });
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(snap).toMatchObject({ size: { width: 137, height: 82 } });
      store.destroy();
    });

    it('snaps a committed SQUARE resize to the grid when snapEnabled is true', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'em1',
        type: 'emoji',
        pos: { x: 0, y: 0 },
        order: 2,
        text: '🎉',
        size: 64,
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store, { snapEnabled: true }));
      const onResizeEnd = result.current.nodes.find((n) => n.id === 'em1')?.data.onResizeEnd as (
        id: string,
        size: number,
      ) => void;
      act(() => {
        onResizeEnd('em1', 137);
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 'em1');
      // Square: snapped as a square, width === height after snapSize -> 140.
      expect(snap).toMatchObject({ size: 140 });
      store.destroy();
    });

    it('commits the raw SQUARE resize size unchanged when snapEnabled is false', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'em1',
        type: 'emoji',
        pos: { x: 0, y: 0 },
        order: 2,
        text: '🎉',
        size: 64,
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store, { snapEnabled: false }));
      const onResizeEnd = result.current.nodes.find((n) => n.id === 'em1')?.data.onResizeEnd as (
        id: string,
        size: number,
      ) => void;
      act(() => {
        onResizeEnd('em1', 137);
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 'em1');
      expect(snap).toMatchObject({ size: 137 });
      store.destroy();
    });

    it("wires a shape node's onRotate to commit via rotateNode", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'sh1',
        type: 'shape',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'rect',
        color: '#fff',
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const sh1 = result.current.nodes.find((n) => n.id === 'sh1');
      const onRotate = sh1?.data.onRotate as (id: string, rotation: number) => void;
      expect(onRotate).toBeTypeOf('function');
      act(() => {
        onRotate('sh1', 45);
      });
      const snap = store.getSnapshot().nodes.find((n) => n.id === 'sh1');
      expect(snap).toMatchObject({ rotation: 45 });
      store.destroy();
    });

    it('a sticky node never gets onRotate (not a rotatable type)', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const s1 = result.current.nodes.find((n) => n.id === 's1');
      expect(s1?.data.onRotate).toBeUndefined();
      store.destroy();
    });

    it('onResizeEnd/onRotate stay referentially stable across re-renders too', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'sh1',
        type: 'shape',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'rect',
        color: '#fff',
      });
      const store = createBoardStore(board, { readonly: false });
      const { result, rerender } = renderHook(() => useEditableCanvas(store));
      const sh1Before = result.current.nodes.find((n) => n.id === 'sh1');
      rerender();
      const sh1After = result.current.nodes.find((n) => n.id === 'sh1');
      expect(sh1After?.data.onResizeEnd).toBe(sh1Before?.data.onResizeEnd);
      expect(sh1After?.data.onRotate).toBe(sh1Before?.data.onRotate);
      store.destroy();
    });
  });

  // ── P4-T24: injected edge-styling callbacks ─────────────────────────────────

  describe('injected edge-data callbacks', () => {
    it("wires an edge's onLabelChange to commit via setEdgeLabel", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      const onLabelChange = e1?.data?.onLabelChange as (id: string, label: string) => void;
      expect(onLabelChange).toBeTypeOf('function');
      act(() => {
        onLabelChange('e1', 'triggers');
      });
      const snap = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(snap?.label).toBe('triggers');
      store.destroy();
    });

    it("wires an arrow edge's onArrowChange to commit via setEdgeArrow", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      const onArrowChange = e1?.data?.onArrowChange as (id: string, arrow: string) => void;
      expect(onArrowChange).toBeTypeOf('function');
      act(() => {
        onArrowChange('e1', 'both');
      });
      const snap = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(snap?.arrow).toBe('both');
      store.destroy();
    });

    it("wires an edge's onStyleChange to commit via setEdgeLineStyle", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      const onStyleChange = e1?.data?.onStyleChange as (id: string, style: string) => void;
      expect(onStyleChange).toBeTypeOf('function');
      act(() => {
        onStyleChange('e1', 'dashed');
      });
      const snap = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(snap?.style).toBe('dashed');
      store.destroy();
    });

    it("wires an edge's onRoutingChange to commit via setEdgeRouting", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      const onRoutingChange = e1?.data?.onRoutingChange as (id: string, routing: string) => void;
      expect(onRoutingChange).toBeTypeOf('function');
      act(() => {
        onRoutingChange('e1', 'elbow');
      });
      const snap = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(snap?.routing).toBe('elbow');
      store.destroy();
    });

    it("wires a cardinality edge's onCardinalityChange to commit via setEdgeCardinality", () => {
      const board = fixtureBoard();
      board.edges.push({
        id: 'e2',
        source: 's1',
        target: 's2',
        style: 'solid',
        kind: 'cardinality',
        cardinality: '1:N',
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e2 = result.current.edges.find((e) => e.id === 'e2');
      const onCardinalityChange = e2?.data?.onCardinalityChange as (
        id: string,
        cardinality: string,
      ) => void;
      expect(onCardinalityChange).toBeTypeOf('function');
      act(() => {
        onCardinalityChange('e2', 'N:N');
      });
      const snap = store.getSnapshot().edges.find((e) => e.id === 'e2');
      expect(snap?.cardinality).toBe('N:N');
      store.destroy();
    });

    it('an arrow edge never gets onCardinalityChange; a cardinality edge never gets onArrowChange', () => {
      const board = fixtureBoard();
      board.edges.push({
        id: 'e2',
        source: 's1',
        target: 's2',
        style: 'solid',
        kind: 'cardinality',
        cardinality: '1:N',
      });
      const store = createBoardStore(board, { readonly: false });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      const e2 = result.current.edges.find((e) => e.id === 'e2');
      expect(e1?.data?.onCardinalityChange).toBeUndefined();
      expect(e2?.data?.onArrowChange).toBeUndefined();
      store.destroy();
    });

    it('read-only edges never get editing callbacks', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      const { result } = renderHook(() => useEditableCanvas(store));
      const e1 = result.current.edges.find((e) => e.id === 'e1');
      expect(e1?.data?.onLabelChange).toBeUndefined();
      expect(e1?.data?.onArrowChange).toBeUndefined();
      expect(e1?.data?.onStyleChange).toBeUndefined();
      expect(e1?.data?.onRoutingChange).toBeUndefined();
      store.destroy();
    });

    it('injected edge callbacks are referentially stable across re-renders', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const { result, rerender } = renderHook(() => useEditableCanvas(store));
      const before = result.current.edges.find((e) => e.id === 'e1')?.data?.onLabelChange;
      rerender();
      const after = result.current.edges.find((e) => e.id === 'e1')?.data?.onLabelChange;
      expect(after).toBe(before);
      store.destroy();
    });
  });
});
