// ── useUndoRedo tests ─────────────────────────────────────────────────────────
//
// Collaboration-correct undo (plan v2 §3 / rough-edge a): a `Y.UndoManager`
// scoped to `LOCAL_ORIGIN` so it only reverts THIS client's own edits, never a
// remote peer's — remote changes interleave into the undo/redo timeline
// untouched. Ported semantics from the legacy full-clone undo stack
// (src/components/BoardCanvas.tsx): a MAX_UNDO cap and a `clear()` called on
// external updates (SSE) and board reload/history-restore.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { addNode, moveNode } from '@figemite/shared';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { useUndoRedo } from './useUndoRedo.js';

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
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** A non-local origin, simulating a remote peer's transaction (Phase 5). */
const REMOTE_ORIGIN = Symbol('remote-peer');

let store: BoardStore;

beforeEach(() => {
  vi.useFakeTimers();
  store = createBoardStore(fixtureBoard(), { readonly: false });
});

afterEach(() => {
  store.destroy();
  vi.useRealTimers();
});

describe('useUndoRedo', () => {
  it('starts with nothing to undo or redo', () => {
    const { result } = renderHook(() => useUndoRedo(store));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('undoes a local moveNode op (getSnapshot round-trips to the prior position)', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    act(() => {
      moveNode(store.doc, 's1', { x: 999, y: 888 });
    });
    // Move past the capture window so this commits as its own stack item.
    act(() => vi.advanceTimersByTime(1000));

    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 999,
      y: 888,
    });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());

    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('redoes an undone local op', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    act(() => moveNode(store.doc, 's1', { x: 50, y: 60 }));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.undo());
    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 10,
      y: 20,
    });

    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());

    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 50,
      y: 60,
    });
  });

  it('does NOT undo a non-local-origin change', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    act(() => {
      store.doc.transact(() => {
        moveNode(store.doc, 's1', { x: 500, y: 500 }, REMOTE_ORIGIN);
      }, REMOTE_ORIGIN);
    });
    act(() => vi.advanceTimersByTime(1000));

    // Untracked origin: never entered the undo stack.
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.undo());

    // The remote change survives untouched.
    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 500,
      y: 500,
    });
  });

  it('concurrent-remote-interleave: undoing a local move reverts only the local change, and a remote-added node survives', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    // Local move.
    act(() => moveNode(store.doc, 's1', { x: 700, y: 700 }));
    act(() => vi.advanceTimersByTime(1000));

    // A remote peer adds a node in between (different origin, untracked).
    act(() => {
      addNode(
        store.doc,
        { id: 'remote1', type: 'text', pos: { x: 1, y: 1 }, order: 1, text: 'from peer' },
        REMOTE_ORIGIN,
      );
    });
    act(() => vi.advanceTimersByTime(1000));

    act(() => result.current.undo());

    const snap = store.getSnapshot();
    // Local move is reverted...
    expect(snap.nodes.find((n) => n.id === 's1')?.pos).toEqual({ x: 10, y: 20 });
    // ...but the remote node is untouched by the local undo.
    expect(snap.nodes.some((n) => n.id === 'remote1')).toBe(true);
  });

  it('clear() empties both the undo and redo stacks', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    act(() => moveNode(store.doc, 's1', { x: 1, y: 1 }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.clear());

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('captureTimeout coalesces two rapid local ops into one undo step', () => {
    const { result } = renderHook(() => useUndoRedo(store));

    act(() => moveNode(store.doc, 's1', { x: 100, y: 100 }));
    // Well within the ~400ms capture window.
    act(() => vi.advanceTimersByTime(50));
    act(() => moveNode(store.doc, 's1', { x: 200, y: 200 }));
    act(() => vi.advanceTimersByTime(1000));

    // Exactly one undo unwinds BOTH moves at once, back to the original position.
    act(() => result.current.undo());
    expect(store.getSnapshot().nodes.find((n) => n.id === 's1')?.pos).toEqual({
      x: 10,
      y: 20,
    });
    // Nothing left to undo — it was a single coalesced step.
    expect(result.current.canUndo).toBe(false);
  });

  it('destroys the underlying Y.UndoManager on unmount without throwing', () => {
    const { result, unmount } = renderHook(() => useUndoRedo(store));
    act(() => moveNode(store.doc, 's1', { x: 1, y: 1 }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.canUndo).toBe(true);
    expect(() => unmount()).not.toThrow();
  });
});
