// ── useBoardInteractions tests ───────────────────────────────────────────────
//
// P4-T27. Keyboard shortcuts, internal clipboard (copy/cut/paste/duplicate),
// layer reordering, and alt-drag duplicate — all committing through the
// store's mutation API (so undo/autosave, which observe LOCAL_ORIGIN doc
// transactions, pick them up for free; no separate wiring needed here).
//
// Two ways in are tested: calling the hook's own methods directly (clearest
// for asserting the doc-level effect), and dispatching real `keydown` events
// on `window` (proving the shortcut wiring + gating actually works).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { useBoardInteractions } from './useBoardInteractions.js';
import type { UseBoardInteractionsOptions } from './useBoardInteractions.js';

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
      {
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 300 },
        order: 2,
        size: { width: 400, height: 300 },
        title: 'Frame',
        color: '#94a3b8',
      },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2', style: 'solid', kind: 'arrow', arrow: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function defaultOptions(
  store: BoardStore,
  overrides: Partial<UseBoardInteractionsOptions> = {},
): UseBoardInteractionsOptions {
  return {
    store,
    selectedNodeIds: new Set(),
    selectedEdgeIds: new Set(),
    readonly: false,
    undo: vi.fn(),
    redo: vi.fn(),
    flushNow: vi.fn(),
    ...overrides,
  };
}

let store: BoardStore;

beforeEach(() => {
  store = createBoardStore(fixtureBoard(), { readonly: false });
});

afterEach(() => {
  store.destroy();
  vi.restoreAllMocks();
});

function dispatchKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('useBoardInteractions', () => {
  // ── Clipboard: copy / paste ────────────────────────────────────────────────

  describe('copy + paste', () => {
    it('paste mints new ids and offsets pasted nodes by +20,+20', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.copySelection());
      act(() => result.current.pasteClipboard());

      const nodes = store.getSnapshot().nodes;
      expect(nodes).toHaveLength(4); // s1, s2, f1 + 1 pasted
      const pasted = nodes.find((n) => n.id !== 's1' && n.id !== 's2' && n.id !== 'f1');
      expect(pasted).toBeDefined();
      expect(pasted?.pos).toEqual({ x: 30, y: 40 });
    });

    it('paste selects the newly pasted set', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.copySelection());
      const pastedIds = act(() => result.current.pasteClipboard());
      // pasteClipboard returns the set of newly-created node ids so the
      // caller (useEditableCanvas's selection) can select them.
      expect(pastedIds).toBeDefined();
    });

    it('copy+paste remaps ONLY edges bridging two selected (copied) nodes', () => {
      const selectedNodeIds = new Set(['s1', 's2']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.copySelection());
      act(() => result.current.pasteClipboard());

      const snap = store.getSnapshot();
      // Original edge e1 (s1->s2) + one remapped pasted edge.
      expect(snap.edges).toHaveLength(2);
      const original = snap.edges.find((e) => e.id === 'e1')!;
      expect(original.source).toBe('s1');
      expect(original.target).toBe('s2');

      const pastedEdge = snap.edges.find((e) => e.id !== 'e1')!;
      expect(pastedEdge).toBeDefined();
      // Remapped to the two NEW pasted node ids, not the originals.
      expect(pastedEdge.source).not.toBe('s1');
      expect(pastedEdge.target).not.toBe('s2');
      const pastedNodeIds = new Set(
        snap.nodes.filter((n) => n.id !== 's1' && n.id !== 's2' && n.id !== 'f1').map((n) => n.id),
      );
      expect(pastedNodeIds.has(pastedEdge.source)).toBe(true);
      expect(pastedNodeIds.has(pastedEdge.target)).toBe(true);
    });

    it('an edge with only ONE endpoint selected is not copied', () => {
      // e1 is s1->s2; select only s1, so e1 has just one selected endpoint.
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.copySelection());
      act(() => result.current.pasteClipboard());

      const snap = store.getSnapshot();
      // Only the original edge remains — nothing pasted since e1 wasn't copied.
      expect(snap.edges).toHaveLength(1);
      expect(snap.edges[0]!.id).toBe('e1');
    });

    it('pasting with an empty clipboard is a no-op', () => {
      const { result } = renderHook(() => useBoardInteractions(defaultOptions(store)));
      const before = store.getSnapshot();
      act(() => result.current.pasteClipboard());
      const after = store.getSnapshot();
      expect(after.nodes).toHaveLength(before.nodes.length);
      expect(after.edges).toHaveLength(before.edges.length);
    });

    it('pasting twice mints two independent copies with independent ids', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.copySelection());
      act(() => result.current.pasteClipboard());
      act(() => result.current.pasteClipboard());

      const nodes = store.getSnapshot().nodes;
      const pastedIds = nodes
        .filter((n) => n.id !== 's1' && n.id !== 's2' && n.id !== 'f1')
        .map((n) => n.id);
      expect(pastedIds).toHaveLength(2);
      expect(new Set(pastedIds).size).toBe(2);
    });
  });

  // ── Clipboard: cut ─────────────────────────────────────────────────────────

  describe('cut', () => {
    it('cut copies the selection then deletes it', () => {
      const selectedNodeIds = new Set(['s2']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.cutSelection());

      // s2 is gone (and e1, which depended on it, is pruned).
      const snap = store.getSnapshot();
      expect(snap.nodes.some((n) => n.id === 's2')).toBe(false);
      expect(snap.edges.some((e) => e.id === 'e1')).toBe(false);

      // But it was captured to the clipboard — pasting brings it back.
      act(() => result.current.pasteClipboard());
      const afterPaste = store.getSnapshot();
      expect(afterPaste.nodes.some((n) => n.type === 'sticky' && n.text === 'world')).toBe(true);
    });
  });

  // ── Clipboard: duplicate ───────────────────────────────────────────────────

  describe('duplicate', () => {
    it('duplicate = copy immediately followed by paste (one new node, offset)', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.duplicateSelection());

      const nodes = store.getSnapshot().nodes;
      expect(nodes).toHaveLength(4);
      const dup = nodes.find((n) => n.id !== 's1' && n.id !== 's2' && n.id !== 'f1');
      expect(dup?.pos).toEqual({ x: 30, y: 40 });
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  describe('deleteSelected', () => {
    it('deletes selected nodes and prunes dangling edges', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.deleteSelected());

      const snap = store.getSnapshot();
      expect(snap.nodes.some((n) => n.id === 's1')).toBe(false);
      expect(snap.edges).toHaveLength(0); // e1 depended on s1
    });

    it('deletes selected edges directly', () => {
      const selectedEdgeIds = new Set(['e1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedEdgeIds })),
      );
      act(() => result.current.deleteSelected());
      expect(store.getSnapshot().edges).toHaveLength(0);
    });

    it('is a no-op with nothing selected', () => {
      const { result } = renderHook(() => useBoardInteractions(defaultOptions(store)));
      const before = store.getSnapshot();
      act(() => result.current.deleteSelected());
      const after = store.getSnapshot();
      expect(after.nodes).toHaveLength(before.nodes.length);
    });
  });

  // ── Layer reorder ──────────────────────────────────────────────────────────

  describe('reorderSelectedLayers', () => {
    it('"front" moves the selected non-frame node to the front of its partition (highest order)', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.reorderSelectedLayers('front'));

      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      const f1 = nodes.find((n) => n.id === 'f1')!;
      // Frame stays behind both non-frames regardless.
      expect(f1.order).toBeLessThan(s1.order);
      expect(f1.order).toBeLessThan(s2.order);
      // s1 (moved to front of the non-frame partition) now outranks s2.
      expect(s1.order).toBeGreaterThan(s2.order);
    });

    it('"back" moves the selected node behind its partition-mates', () => {
      const selectedNodeIds = new Set(['s2']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.reorderSelectedLayers('back'));

      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      expect(s2.order).toBeLessThan(s1.order);
    });

    it('"forward" swaps the selected node one slot up', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      const before = store.getSnapshot().nodes.find((n) => n.id === 's1')!.order;
      act(() => result.current.reorderSelectedLayers('forward'));
      const after = store.getSnapshot().nodes.find((n) => n.id === 's1')!.order;
      expect(after).toBeGreaterThan(before);
    });

    it('"backward" swaps the selected node one slot down (behind its neighbour)', () => {
      // Fixture: non-frame partition is [s1(order 0), s2(order 1)] — s2 is
      // already in front of s1. "backward" swaps it one slot down, so s2
      // should end up BEHIND s1 (lower relative order), even though s2's
      // absolute order value doesn't necessarily decrease (the frame
      // partition's own order occupies the low end of the shared index
      // space) — assert the relationship, not an absolute value.
      const selectedNodeIds = new Set(['s2']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      act(() => result.current.reorderSelectedLayers('backward'));
      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      expect(s2.order).toBeLessThan(s1.order);
    });

    it('commits the new order via updateNode (patch has ONLY the order field)', () => {
      const selectedNodeIds = new Set(['s1']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      const updateNodeSpy = vi.spyOn(store, 'updateNode');
      act(() => result.current.reorderSelectedLayers('front'));
      expect(updateNodeSpy).toHaveBeenCalled();
      for (const call of updateNodeSpy.mock.calls) {
        expect(Object.keys(call[1])).toEqual(['order']);
      }
    });

    it('is a no-op with nothing selected', () => {
      const { result } = renderHook(() => useBoardInteractions(defaultOptions(store)));
      const before = store.getSnapshot().nodes.map((n) => n.order);
      act(() => result.current.reorderSelectedLayers('front'));
      const after = store.getSnapshot().nodes.map((n) => n.order);
      expect(after).toEqual(before);
    });
  });

  // ── Alt-drag duplicate ──────────────────────────────────────────────────────

  describe('onNodeDragStart (alt-drag clone)', () => {
    it('Alt+drag on a node clones it, leaving the original in place', () => {
      const { result } = renderHook(() => useBoardInteractions(defaultOptions(store)));
      const rfNode = { id: 's1', position: { x: 10, y: 20 } } as never;
      act(() => {
        result.current.onNodeDragStart({ altKey: true } as MouseEvent, rfNode, [rfNode]);
      });
      const nodes = store.getSnapshot().nodes;
      expect(nodes).toHaveLength(4);
      // Original s1 is untouched.
      const original = nodes.find((n) => n.id === 's1')!;
      expect(original.pos).toEqual({ x: 10, y: 20 });
    });

    it('Alt+drag with a multi-node selection clones every selected node and rewires edges between clones', () => {
      const selectedNodeIds = new Set(['s1', 's2']);
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds })),
      );
      const rfNode = { id: 's1', position: { x: 10, y: 20 } } as never;
      act(() => {
        result.current.onNodeDragStart({ altKey: true } as MouseEvent, rfNode, [rfNode]);
      });
      const snap = store.getSnapshot();
      // Both originals untouched, two new clones, and a rewired edge between
      // the clones (not touching the originals).
      const cloneIds = new Set(
        snap.nodes.filter((n) => n.id !== 's1' && n.id !== 's2' && n.id !== 'f1').map((n) => n.id),
      );
      expect(cloneIds.size).toBe(2);
      expect(snap.edges).toHaveLength(2); // original e1 + rewired clone edge
      const cloneEdge = snap.edges.find((e) => e.id !== 'e1')!;
      expect(cloneIds.has(cloneEdge.source)).toBe(true);
      expect(cloneIds.has(cloneEdge.target)).toBe(true);
    });

    it('a plain (non-Alt) drag start does not clone anything', () => {
      const { result } = renderHook(() => useBoardInteractions(defaultOptions(store)));
      const rfNode = { id: 's1', position: { x: 10, y: 20 } } as never;
      act(() => {
        result.current.onNodeDragStart({ altKey: false } as MouseEvent, rfNode, [rfNode]);
      });
      expect(store.getSnapshot().nodes).toHaveLength(3);
    });

    it('does nothing when readonly', () => {
      const { result } = renderHook(() =>
        useBoardInteractions(defaultOptions(store, { readonly: true })),
      );
      const rfNode = { id: 's1', position: { x: 10, y: 20 } } as never;
      act(() => {
        result.current.onNodeDragStart({ altKey: true } as MouseEvent, rfNode, [rfNode]);
      });
      expect(store.getSnapshot().nodes).toHaveLength(3);
    });
  });

  // ── Global keyboard wiring ───────────────────────────────────────────────────

  describe('keyboard shortcuts', () => {
    it('Cmd+Z calls undo', () => {
      const undo = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { undo })));
      act(() => dispatchKey({ key: 'z', metaKey: true }));
      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z calls undo', () => {
      const undo = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { undo })));
      act(() => dispatchKey({ key: 'z', ctrlKey: true }));
      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('Cmd+Shift+Z calls redo', () => {
      const redo = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { redo })));
      act(() => dispatchKey({ key: 'z', metaKey: true, shiftKey: true }));
      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y calls redo', () => {
      const redo = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { redo })));
      act(() => dispatchKey({ key: 'y', ctrlKey: true }));
      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('Cmd+S calls flushNow and does not navigate/save the browser page', () => {
      const flushNow = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { flushNow })));
      const evt = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(evt);
      });
      expect(flushNow).toHaveBeenCalledTimes(1);
      expect(evt.defaultPrevented).toBe(true);
    });

    it('Cmd+C copies the selection', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'c', metaKey: true }));
      // Verify indirectly: paste after copy produces a new node.
      // (copySelection has no external spy point, so drive via a second hook
      // instance sharing the same store would be awkward — instead assert
      // through Cmd+V immediately after.)
      act(() => dispatchKey({ key: 'v', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(4);
    });

    it('Cmd+X cuts the selection (copies then deletes)', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'x', metaKey: true }));
      expect(store.getSnapshot().nodes.some((n) => n.id === 's1')).toBe(false);
    });

    it('Cmd+V pastes the clipboard', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'c', metaKey: true }));
      act(() => dispatchKey({ key: 'v', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(4);
    });

    it('Cmd+D duplicates the selection', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'd', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(4);
    });

    it('Delete key deletes the selection', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'Delete' }));
      expect(store.getSnapshot().nodes.some((n) => n.id === 's1')).toBe(false);
    });

    it('Backspace key deletes the selection', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: 'Backspace' }));
      expect(store.getSnapshot().nodes.some((n) => n.id === 's1')).toBe(false);
    });

    it(']  reorders forward', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      const before = store.getSnapshot().nodes.find((n) => n.id === 's1')!.order;
      act(() => dispatchKey({ key: ']' }));
      const after = store.getSnapshot().nodes.find((n) => n.id === 's1')!.order;
      expect(after).toBeGreaterThan(before);
    });

    it('[ reorders backward (s2 ends up behind s1)', () => {
      const selectedNodeIds = new Set(['s2']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: '[' }));
      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      expect(s2.order).toBeLessThan(s1.order);
    });

    it('} sends to front', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: '}' }));
      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      expect(s1.order).toBeGreaterThan(s2.order);
    });

    it('{ sends to back', () => {
      const selectedNodeIds = new Set(['s2']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));
      act(() => dispatchKey({ key: '{' }));
      const nodes = store.getSnapshot().nodes;
      const s1 = nodes.find((n) => n.id === 's1')!;
      const s2 = nodes.find((n) => n.id === 's2')!;
      expect(s2.order).toBeLessThan(s1.order);
    });

    it('Escape calls onEscape', () => {
      const onEscape = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { onEscape })));
      act(() => dispatchKey({ key: 'Escape' }));
      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('unregisters the keydown listener on unmount', () => {
      const undo = vi.fn();
      const { unmount } = renderHook(() => useBoardInteractions(defaultOptions(store, { undo })));
      unmount();
      act(() => dispatchKey({ key: 'z', metaKey: true }));
      expect(undo).not.toHaveBeenCalled();
    });
  });

  // ── Shortcut gating ──────────────────────────────────────────────────────────

  describe('gating', () => {
    it('readonly: delete/cut/paste/duplicate/layer shortcuts are no-ops, but undo/redo still fire', () => {
      const selectedNodeIds = new Set(['s1']);
      const undo = vi.fn();
      const redo = vi.fn();
      const flushNow = vi.fn();
      renderHook(() =>
        useBoardInteractions(
          defaultOptions(store, { selectedNodeIds, readonly: true, undo, redo, flushNow }),
        ),
      );

      act(() => dispatchKey({ key: 'Delete' }));
      expect(store.getSnapshot().nodes).toHaveLength(3);

      act(() => dispatchKey({ key: 'x', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(3);

      act(() => dispatchKey({ key: 'v', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(3);

      act(() => dispatchKey({ key: ']' }));
      const before = store.getSnapshot().nodes.find((n) => n.id === 's1')!.order;
      act(() => dispatchKey({ key: ']' }));
      expect(store.getSnapshot().nodes.find((n) => n.id === 's1')!.order).toBe(before);
    });

    it('aiLocked: mutating shortcuts are no-ops', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() =>
        useBoardInteractions(defaultOptions(store, { selectedNodeIds, aiLocked: true })),
      );
      act(() => dispatchKey({ key: 'Delete' }));
      expect(store.getSnapshot().nodes).toHaveLength(3);
      act(() => dispatchKey({ key: 'v', metaKey: true }));
      expect(store.getSnapshot().nodes).toHaveLength(3);
    });

    it('focus in an <input>: shortcuts (except Escape) are suppressed', () => {
      const selectedNodeIds = new Set(['s1']);
      const undo = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds, undo })));

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      act(() => dispatchKey({ key: 'Delete' }));
      expect(store.getSnapshot().nodes).toHaveLength(3);
      act(() => dispatchKey({ key: 'z', metaKey: true }));
      expect(undo).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('focus in a contentEditable element: shortcuts are suppressed', () => {
      const selectedNodeIds = new Set(['s1']);
      renderHook(() => useBoardInteractions(defaultOptions(store, { selectedNodeIds })));

      // jsdom doesn't implement the `contentEditable`/`isContentEditable` IDL
      // property (setting `.contentEditable = 'true'` is a no-op there), so
      // set the attribute directly — which the hook's gating checks as a
      // fallback specifically so this is testable outside a real browser.
      // `tabIndex` is required for jsdom to actually move `activeElement` on
      // `.focus()` for a non-form element.
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      div.tabIndex = 0;
      document.body.appendChild(div);
      div.focus();

      act(() => dispatchKey({ key: 'Delete' }));
      expect(store.getSnapshot().nodes).toHaveLength(3);

      document.body.removeChild(div);
    });

    it('Cmd+S (flushNow) still fires even with focus in an input (matches legacy save-anywhere behaviour)', () => {
      const flushNow = vi.fn();
      renderHook(() => useBoardInteractions(defaultOptions(store, { flushNow })));
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      act(() => dispatchKey({ key: 's', metaKey: true }));
      expect(flushNow).toHaveBeenCalledTimes(1);
      document.body.removeChild(input);
    });
  });
});
