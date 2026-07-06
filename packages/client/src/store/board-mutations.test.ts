// ── Mutation-API tests ────────────────────────────────────────────────────────
//
// The thin, typed mutation surface layered over the doc-first store (P4-T22).
// Each method wraps a shared CRDT op against `store.doc`, so BoardCanvas commits
// interactions through `store.moveNode(...)` etc. rather than importing raw ops.
// Read-only stores must no-op every mutation (guarded on `store.readonly`).

import { describe, it, expect, vi } from 'vitest';
import type { BoardEdge, BoardFile } from '@easel/shared';
import { createBoardStore } from './board-store.js';

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

describe('board mutation API', () => {
  describe('moveNode', () => {
    it('updates the doc so getSnapshot reflects the new position', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.moveNode('s1', { x: 999, y: 888 });
      const moved = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(moved?.pos).toEqual({ x: 999, y: 888 });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.moveNode('s1', { x: 1, y: 2 });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      const listener = vi.fn();
      store.subscribe(listener);
      store.moveNode('s1', { x: 999, y: 888 });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node?.pos).toEqual({ x: 10, y: 20 });
      expect(listener).not.toHaveBeenCalled();
      store.destroy();
    });
  });

  describe('deleteNodes', () => {
    it('removes the node and every edge touching it', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.deleteNodes(['s1']);
      const snap = store.getSnapshot();
      expect(snap.nodes.some((n) => n.id === 's1')).toBe(false);
      // e1 touched s1, so it must be gone too.
      expect(snap.edges.some((e) => e.id === 'e1')).toBe(false);
      store.destroy();
    });

    it('deletes multiple nodes in one call', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.deleteNodes(['s1', 's2']);
      expect(store.getSnapshot().nodes).toHaveLength(0);
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.deleteNodes(['s1']);
      expect(store.getSnapshot().nodes.some((n) => n.id === 's1')).toBe(true);
      store.destroy();
    });
  });

  describe('addEdge', () => {
    it('adds the edge to the doc', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const edge: BoardEdge = {
        id: 'e2',
        source: 's2',
        target: 's1',
        style: 'solid',
        kind: 'arrow',
        arrow: 'end',
      };
      store.addEdge(edge);
      expect(store.getSnapshot().edges.some((e) => e.id === 'e2')).toBe(true);
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      const edge: BoardEdge = {
        id: 'e2',
        source: 's2',
        target: 's1',
        style: 'solid',
        kind: 'arrow',
        arrow: 'end',
      };
      store.addEdge(edge);
      expect(store.getSnapshot().edges.some((e) => e.id === 'e2')).toBe(false);
      store.destroy();
    });
  });

  describe('deleteEdges', () => {
    it('removes the edges from the doc', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.deleteEdges(['e1']);
      expect(store.getSnapshot().edges.some((e) => e.id === 'e1')).toBe(false);
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.deleteEdges(['e1']);
      expect(store.getSnapshot().edges.some((e) => e.id === 'e1')).toBe(true);
      store.destroy();
    });
  });
});
