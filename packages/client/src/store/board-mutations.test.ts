// ── Mutation-API tests ────────────────────────────────────────────────────────
//
// The thin, typed mutation surface layered over the doc-first store (P4-T22).
// Each method wraps a shared CRDT op against `store.doc`, so BoardCanvas commits
// interactions through `store.moveNode(...)` etc. rather than importing raw ops.
// Read-only stores must no-op every mutation (guarded on `store.readonly`).

import { describe, it, expect, vi } from 'vitest';
import type { BoardEdge, BoardFile } from '@figemite/shared';
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
  // ── Node creation + generic patch (P4-T25 Toolbar) ──────────────────────────

  describe('addNode', () => {
    it('adds a fully-built node to the doc', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.addNode({
        id: 'new1',
        type: 'text',
        pos: { x: 42, y: 43 },
        order: 5,
        text: 'Label',
      });
      const node = store.getSnapshot().nodes.find((n) => n.id === 'new1');
      expect(node).toMatchObject({ type: 'text', pos: { x: 42, y: 43 }, order: 5, text: 'Label' });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.addNode({ id: 'new1', type: 'text', pos: { x: 0, y: 0 }, order: 5, text: 'Label' });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.addNode({ id: 'new1', type: 'text', pos: { x: 0, y: 0 }, order: 5, text: 'Label' });
      expect(store.getSnapshot().nodes.some((n) => n.id === 'new1')).toBe(false);
      store.destroy();
    });
  });

  describe('updateNode', () => {
    it("merges a patch into an existing node (e.g. a sticky's color)", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.updateNode('s1', { color: '#dbeafe' });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ color: '#dbeafe' });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.updateNode('s1', { color: '#dbeafe' });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.updateNode('s1', { color: '#dbeafe' });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ color: '#fef3c7' });
      store.destroy();
    });
  });

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

  // ── P4-T24: text / resize / rotate / edge-styling ───────────────────────────

  describe('setNodeText', () => {
    it("updates a sticky's text via nodeTexts, leaving nodeData untouched", () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.setNodeText('s1', 'updated text');
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ id: 's1', text: 'updated text' });
      store.destroy();
    });

    it("updates a frame's title (frame text lives in nodeTexts as its title)", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 480, height: 320 },
        title: 'Old title',
        color: '#fef3c7',
      });
      const store = createBoardStore(board, { readonly: false });
      store.setNodeText('f1', 'New title');
      const node = store.getSnapshot().nodes.find((n) => n.id === 'f1');
      expect(node).toMatchObject({ id: 'f1', title: 'New title' });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.setNodeText('s1', 'x');
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.setNodeText('s1', 'nope');
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ text: 'hello' });
      store.destroy();
    });
  });

  describe('resizeNode', () => {
    it('updates a WH-sized node (sticky) size', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.resizeNode('s1', { width: 250, height: 180 });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ size: { width: 250, height: 180 } });
      store.destroy();
    });

    it('updates a numeric-sized node (emoji) size', () => {
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
      store.resizeNode('em1', 96);
      const node = store.getSnapshot().nodes.find((n) => n.id === 'em1');
      expect(node).toMatchObject({ size: 96 });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.resizeNode('s1', { width: 250, height: 180 });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.resizeNode('s1', { width: 999, height: 999 });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({ size: { width: 200, height: 160 } });
      store.destroy();
    });
  });

  describe('rotateNode', () => {
    it("updates a shape node's rotation", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'sh1',
        type: 'shape',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'rect',
        color: '#fef3c7',
      });
      const store = createBoardStore(board, { readonly: false });
      store.rotateNode('sh1', 45);
      const node = store.getSnapshot().nodes.find((n) => n.id === 'sh1');
      expect(node).toMatchObject({ rotation: 45 });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'sh1',
        type: 'shape',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'rect',
        color: '#fef3c7',
      });
      const store = createBoardStore(board, { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.rotateNode('sh1', 45);
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'sh1',
        type: 'shape',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'rect',
        color: '#fef3c7',
      });
      const store = createBoardStore(board, { readonly: true });
      store.rotateNode('sh1', 45);
      const node = store.getSnapshot().nodes.find((n) => n.id === 'sh1');
      expect((node as { rotation?: number })?.rotation).toBeUndefined();
      store.destroy();
    });
  });

  // ── Edge styling ─────────────────────────────────────────────────────────────

  describe('setEdgeLabel', () => {
    it('sets the edge label', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.setEdgeLabel('e1', 'triggers');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.label).toBe('triggers');
      store.destroy();
    });

    it('clears the label when set to an empty string', () => {
      const board = fixtureBoard();
      board.edges[0].label = 'old label';
      const store = createBoardStore(board, { readonly: false });
      store.setEdgeLabel('e1', '');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.label).toBeUndefined();
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.setEdgeLabel('e1', 'triggers');
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.setEdgeLabel('e1', 'triggers');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.label).toBeUndefined();
      store.destroy();
    });
  });

  describe('setEdgeArrow', () => {
    it('updates the edge arrow style', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.setEdgeArrow('e1', 'both');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.arrow).toBe('both');
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.setEdgeArrow('e1', 'both');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.arrow).toBe('end');
      store.destroy();
    });
  });

  describe('setEdgeLineStyle', () => {
    it('updates the edge line style', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.setEdgeLineStyle('e1', 'dashed');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.style).toBe('dashed');
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.setEdgeLineStyle('e1', 'dashed');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.style).toBe('solid');
      store.destroy();
    });
  });

  describe('setEdgeCardinality', () => {
    it('updates the edge cardinality', () => {
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
      store.setEdgeCardinality('e2', 'N:N');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e2');
      expect(edge?.cardinality).toBe('N:N');
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const board = fixtureBoard();
      board.edges.push({
        id: 'e2',
        source: 's1',
        target: 's2',
        style: 'solid',
        kind: 'cardinality',
        cardinality: '1:N',
      });
      const store = createBoardStore(board, { readonly: true });
      store.setEdgeCardinality('e2', 'N:N');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e2');
      expect(edge?.cardinality).toBe('1:N');
      store.destroy();
    });
  });

  describe('setEdgeKind', () => {
    it('switching arrow -> cardinality sets a default cardinality and clears the arrow field', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      // e1 starts as kind:'arrow', arrow:'end'.
      store.setEdgeKind('e1', 'cardinality');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.kind).toBe('cardinality');
      expect(edge?.cardinality).toBe('1:N');
      expect(edge?.arrow).toBeUndefined();
      store.destroy();
    });

    it('switching cardinality -> arrow sets a default arrow and clears the cardinality field', () => {
      const board = fixtureBoard();
      board.edges.push({
        id: 'e2',
        source: 's1',
        target: 's2',
        style: 'solid',
        kind: 'cardinality',
        cardinality: 'N:N',
      });
      const store = createBoardStore(board, { readonly: false });
      store.setEdgeKind('e2', 'arrow');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e2');
      expect(edge?.kind).toBe('arrow');
      expect(edge?.arrow).toBe('end');
      expect(edge?.cardinality).toBeUndefined();
      store.destroy();
    });

    it('preserves an existing cardinality value when switching arrow -> cardinality back and forth', () => {
      const board = fixtureBoard();
      board.edges.push({
        id: 'e2',
        source: 's1',
        target: 's2',
        style: 'solid',
        kind: 'cardinality',
        cardinality: 'N:1',
      });
      const store = createBoardStore(board, { readonly: false });
      store.setEdgeKind('e2', 'arrow');
      store.setEdgeKind('e2', 'cardinality');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e2');
      // Switching back to cardinality without an explicit value re-defaults
      // rather than resurrecting the old one — matches setEdgeKind's
      // single-step contract (each call fully re-derives the opposite field).
      expect(edge?.cardinality).toBe('1:N');
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.setEdgeKind('e1', 'cardinality');
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge?.kind).toBe('arrow');
      store.destroy();
    });
  });

  // ── Multi-select group resize (P4-T24) ──────────────────────────────────────

  describe('applyNodePatch', () => {
    it('commits a combined position + size patch in one call', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.applyNodePatch('s1', { pos: { x: 5, y: 6 }, size: { width: 300, height: 250 } });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node).toMatchObject({
        pos: { x: 5, y: 6 },
        size: { width: 300, height: 250 },
      });
      store.destroy();
    });

    it('commits position + numeric size (emoji/icon) in one call', () => {
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
      store.applyNodePatch('em1', { pos: { x: 10, y: 20 }, size: 96 });
      const node = store.getSnapshot().nodes.find((n) => n.id === 'em1');
      expect(node).toMatchObject({ pos: { x: 10, y: 20 }, size: 96 });
      store.destroy();
    });

    it("commits position + size + points in one call for a drawing node's group resize", () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 'd1',
        type: 'drawing',
        pos: { x: 0, y: 0 },
        order: 2,
        size: { width: 100, height: 80 },
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 40 },
        ],
        color: '#000',
        strokeWidth: 2,
      });
      const store = createBoardStore(board, { readonly: false });
      store.applyNodePatch('d1', {
        pos: { x: 1, y: 2 },
        size: { width: 200, height: 160 },
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
        ],
      });
      const node = store.getSnapshot().nodes.find((n) => n.id === 'd1');
      expect(node).toMatchObject({
        pos: { x: 1, y: 2 },
        size: { width: 200, height: 160 },
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
        ],
      });
      store.destroy();
    });

    it('commits a position-only patch (text node group move)', () => {
      const board = fixtureBoard();
      board.nodes.push({
        id: 't1',
        type: 'text',
        pos: { x: 0, y: 0 },
        order: 2,
        text: 'label',
      });
      const store = createBoardStore(board, { readonly: false });
      store.applyNodePatch('t1', { pos: { x: 42, y: 43 } });
      const node = store.getSnapshot().nodes.find((n) => n.id === 't1');
      expect(node).toMatchObject({ pos: { x: 42, y: 43 } });
      store.destroy();
    });

    it('notifies subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribe(listener);
      store.applyNodePatch('s1', { pos: { x: 1, y: 1 } });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.applyNodePatch('s1', { pos: { x: 999, y: 999 } });
      const node = store.getSnapshot().nodes.find((n) => n.id === 's1');
      expect(node?.pos).toEqual({ x: 10, y: 20 });
      store.destroy();
    });
  });
});
