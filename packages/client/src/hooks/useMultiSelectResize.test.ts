// ── useMultiSelectResize ──────────────────────────────────────────────────────
//
// The store-commit half of the multi-select group resize (P4-T24): given the
// current doc snapshot and the set of selected node ids, exposes the
// selected BoardNodes (for MultiSelectResizer's bbox/geometry) and an
// `onScale` handler that, for each selected node, computes the per-type
// patch via `multi-select-scale.ts`'s pure `scaleNodeForGroupResize` and
// commits it in ONE call via `store.applyNodePatch` (so a drag never fires
// two separate ops per node per tick).

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import { useMultiSelectResize } from './useMultiSelectResize.js';

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 100, height: 80 },
        text: 'a',
        color: '#fff',
      },
      {
        id: 's2',
        type: 'sticky',
        pos: { x: 200, y: 0 },
        order: 1,
        size: { width: 100, height: 80 },
        text: 'b',
        color: '#fff',
      },
      {
        id: 's3',
        type: 'sticky',
        pos: { x: 400, y: 0 },
        order: 2,
        size: { width: 100, height: 80 },
        text: 'c',
        color: '#fff',
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('useMultiSelectResize', () => {
  it('selectedNodes reflects only the ids in selectedNodeIds', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useMultiSelectResize(store, new Set(['s1', 's2'])));
    expect(result.current.selectedNodes.map((n) => n.id).sort()).toEqual(['s1', 's2']);
    store.destroy();
  });

  it('onScale applies the computed patch to EVERY selected node via applyNodePatch', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useMultiSelectResize(store, new Set(['s1', 's2'])));
    const originalRects = new Map([
      ['s1', { x: 0, y: 0, width: 100, height: 80 }],
      ['s2', { x: 200, y: 0, width: 100, height: 80 }],
    ]);
    act(() => {
      result.current.onScale({ sx: 2, sy: 2, anchor: { x: 0, y: 0 }, originalRects });
    });
    const snap = store.getSnapshot();
    const s1 = snap.nodes.find((n) => n.id === 's1');
    const s2 = snap.nodes.find((n) => n.id === 's2');
    expect(s1).toMatchObject({ pos: { x: 0, y: 0 }, size: { width: 200, height: 160 } });
    expect(s2).toMatchObject({ pos: { x: 400, y: 0 }, size: { width: 200, height: 160 } });
    store.destroy();
  });

  it('onScale does NOT touch a node that is not in originalRects (defensive skip)', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useMultiSelectResize(store, new Set(['s1', 's3'])));
    const originalRects = new Map([['s1', { x: 0, y: 0, width: 100, height: 80 }]]);
    act(() => {
      result.current.onScale({ sx: 2, sy: 2, anchor: { x: 0, y: 0 }, originalRects });
    });
    const s3 = store.getSnapshot().nodes.find((n) => n.id === 's3');
    expect(s3).toMatchObject({ pos: { x: 400, y: 0 }, size: { width: 100, height: 80 } });
    store.destroy();
  });

  it('onScaleStart is callable (undo capture happens automatically via Y.UndoManager)', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useMultiSelectResize(store, new Set(['s1', 's2'])));
    expect(() => result.current.onScaleStart()).not.toThrow();
    store.destroy();
  });

  it('onScale is referentially stable across re-renders (mirrors the node-callback stability requirement)', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result, rerender } = renderHook(() => useMultiSelectResize(store, new Set(['s1'])));
    const before = result.current.onScale;
    rerender();
    expect(result.current.onScale).toBe(before);
    store.destroy();
  });
});
