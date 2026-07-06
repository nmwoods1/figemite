import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { addNode } from '@easel/shared';
import type { BoardFile, BoardNode } from '@easel/shared';
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
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 0 },
        order: 1,
        size: { width: 480, height: 320 },
        title: 'Frame',
        color: '#fef3c7',
      },
    ],
    edges: [{ id: 'e1', source: 's1', target: 'f1', style: 'solid' }],
    viewport: { x: 5, y: 6, zoom: 1.5 },
  };
}

describe('createBoardStore', () => {
  it('hydrates the doc from the initial board and getSnapshot reflects its nodes/edges', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const snap = store.getSnapshot();

    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
    const sticky = snap.nodes.find((n) => n.id === 's1');
    expect(sticky).toMatchObject({ id: 's1', type: 'sticky', text: 'hello' });
    const frame = snap.nodes.find((n) => n.id === 'f1');
    expect(frame).toMatchObject({ id: 'f1', type: 'frame', title: 'Frame' });
    expect(snap.edges[0]).toMatchObject({ id: 'e1', source: 's1', target: 'f1' });

    store.destroy();
  });

  it('getSnapshot returns the SAME object reference when nothing has changed', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b);
    store.destroy();
  });

  it('applying a shared op fires subscribers and the next getSnapshot includes the change', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const before = store.getSnapshot();
    const newNode: BoardNode = {
      id: 'new1',
      type: 'text',
      pos: { x: 100, y: 100 },
      order: 2,
      text: 'New node',
    };
    addNode(store.doc, newNode);

    expect(listener).toHaveBeenCalled();
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.nodes.some((n) => n.id === 'new1')).toBe(true);

    unsubscribe();
    store.destroy();
  });

  it('getSnapshot reference changes only when the doc actually updates', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(first).toBe(second);

    addNode(store.doc, {
      id: 'x1',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 5,
      text: 'x',
    });

    const third = store.getSnapshot();
    expect(third).not.toBe(second);
    const fourth = store.getSnapshot();
    expect(fourth).toBe(third);

    store.destroy();
  });

  it('destroy() stops further notifications', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    store.subscribe(listener);
    store.destroy();

    // Mutating the doc after destroy should not notify (doc.destroy() also
    // detaches observers, but this proves the store's own cleanup too).
    addNode(store.doc, {
      id: 'after-destroy',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 9,
      text: 'nope',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops that particular listener from being called again', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    addNode(store.doc, {
      id: 'after-unsub',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 9,
      text: 'nope',
    });

    expect(listener).not.toHaveBeenCalled();
    store.destroy();
  });

  it('exposes the underlying Y.Doc', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    expect(store.doc).toBeInstanceOf(Y.Doc);
    store.destroy();
  });

  describe('viewport', () => {
    it('getViewport returns the initial board viewport', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      expect(store.getViewport()).toEqual({ x: 5, y: 6, zoom: 1.5 });
      store.destroy();
    });

    it('setViewport updates getViewport and notifies viewport subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribeViewport(listener);

      store.setViewport({ x: 1, y: 2, zoom: 2 });

      expect(store.getViewport()).toEqual({ x: 1, y: 2, zoom: 2 });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('viewport getSnapshot is referentially stable when unchanged', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const a = store.getViewport();
      const b = store.getViewport();
      expect(a).toBe(b);
      store.destroy();
    });
  });
});
