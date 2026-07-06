import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { addNode } from '@easel/shared';
import type { BoardFile } from '@easel/shared';
import { createBoardStore } from './board-store.js';
import { useBoardStore, useBoardViewport } from './use-board-store.js';

afterEach(() => {
  cleanup();
});

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

describe('useBoardStore', () => {
  it('returns the current nodes/edges snapshot', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useBoardStore(store));

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]).toMatchObject({ id: 's1' });
    expect(result.current.edges).toHaveLength(0);

    store.destroy();
  });

  it('re-renders with the new node after a doc mutation', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useBoardStore(store));

    act(() => {
      addNode(store.doc, {
        id: 'new1',
        type: 'text',
        pos: { x: 0, y: 0 },
        order: 1,
        text: 'New',
      });
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.nodes.some((n) => n.id === 'new1')).toBe(true);

    store.destroy();
  });
});

describe('useBoardViewport', () => {
  it('returns the current viewport and updates after setViewport', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const { result } = renderHook(() => useBoardViewport(store));

    expect(result.current).toEqual({ x: 0, y: 0, zoom: 1 });

    act(() => {
      store.setViewport({ x: 10, y: 20, zoom: 2 });
    });

    expect(result.current).toEqual({ x: 10, y: 20, zoom: 2 });

    store.destroy();
  });
});
