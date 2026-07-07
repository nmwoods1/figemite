// ── PencilLayer tests ────────────────────────────────────────────────────────
//
// The pencil overlay — a sibling of `<ReactFlow>` inside the same measured
// container (mirrors CommentLayer's pattern: rendered inside a real
// `<ReactFlow>` so `useViewport()` resolves, with the container element's
// `getBoundingClientRect` stubbed for deterministic screen-space math).
//
// While `active`, a full-pane overlay captures pointerdown -> pointermove* ->
// pointerup, accumulating FLOW-space points (via `getFlowPointer`) and
// rendering a live smoothed SVG path. On pointerup the accumulated points are
// thinned (`thinPoints`) and committed as a real, PERSISTED `DrawingNode` via
// `store.addNode` (built by the shared `makeDrawingNode` factory) — a normal
// node that syncs + persists through the doc, unlike the ephemeral
// AnnotationLayer (see AnnotationLayer.test.tsx).
//
// Ported behavior (screen->flow conversion without RF's own snap-to-grid,
// Shift held opts into a 20px grid snap) from the original
// prototype's `src/components/PencilLayer.tsx`, rewired onto
// `canvas/coords.ts`'s shared `getFlowPointer`/`snapToGrid` and this
// rewrite's doc-first `BoardStore.addNode` instead of the legacy's
// `onCommit` callback + local reducer.

import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { PencilLayer } from './PencilLayer.js';

afterEach(() => {
  cleanup();
});

function emptyBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Test board',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function renderLayer({
  store,
  active = true,
  viewport = { x: 0, y: 0, zoom: 1 },
}: {
  store: BoardStore;
  active?: boolean;
  viewport?: { x: number; y: number; zoom: number };
}) {
  const containerRef = createRef<HTMLDivElement>();
  const utils = render(
    <div ref={containerRef} style={{ width: 800, height: 600, position: 'relative' }}>
      <ReactFlow nodes={[]} edges={[]} defaultViewport={viewport}>
        <PencilLayer active={active} containerRef={containerRef} store={store} />
      </ReactFlow>
    </div>,
  );
  vi_stubRect(containerRef.current as HTMLDivElement);
  return { ...utils, containerRef };
}

// Local helper (not vitest's `vi` — just named to avoid clashing with the
// import) — stubs the container's bounding rect so screen<->flow math is
// deterministic under jsdom (which never lays out real pixel geometry).
function vi_stubRect(el: HTMLDivElement) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON() {},
    }),
  });
}

function drawStroke(
  overlay: HTMLElement,
  points: Array<{ clientX: number; clientY: number }>,
  opts: { shiftKey?: boolean } = {},
) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, ...first, ...opts });
  for (const p of rest) {
    fireEvent.pointerMove(overlay, { pointerId: 1, ...p, ...opts });
  }
  fireEvent.pointerUp(overlay, { pointerId: 1, ...points[points.length - 1], ...opts });
}

describe('PencilLayer — active mode captures pointer events', () => {
  it('renders a full-pane overlay when active', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { getByTestId } = renderLayer({ store });
    expect(getByTestId('pencil-overlay')).toBeInTheDocument();
  });

  it('does not render an overlay when inactive', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { queryByTestId } = renderLayer({ store, active: false });
    expect(queryByTestId('pencil-overlay')).not.toBeInTheDocument();
  });
});

describe('PencilLayer — commits a persisted DrawingNode', () => {
  it('pointerdown -> move -> up commits a DrawingNode whose absolute geometry matches the input', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { getByTestId } = renderLayer({ store });
    const overlay = getByTestId('pencil-overlay');

    drawStroke(overlay, [
      { clientX: 10, clientY: 10 },
      { clientX: 50, clientY: 10 },
      { clientX: 50, clientY: 60 },
    ]);

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.type).toBe('drawing');
    if (node.type !== 'drawing') throw new Error('expected a drawing node');

    // Absolute geometry: node.pos + each relative point should reconstruct
    // the original (screen == flow here, identity viewport) input points,
    // within tolerance (thinPoints may drop intermediate points that are
    // within its min-distance threshold, but must always keep first/last).
    const absolute = node.points.map((p) => ({ x: p.x + node.pos.x, y: p.y + node.pos.y }));
    expect(absolute[0]).toEqual({ x: 10, y: 10 });
    expect(absolute[absolute.length - 1]).toEqual({ x: 50, y: 60 });
  });

  it('assigns a fresh id and nextOrder to the committed node', () => {
    const board = emptyBoard();
    board.nodes.push({
      id: 'drawing1',
      type: 'drawing',
      pos: { x: 0, y: 0 },
      order: 3,
      size: { width: 10, height: 10 },
      points: [{ x: 0, y: 0 }],
      color: '#000',
      strokeWidth: 2,
    });
    const store = createBoardStore(board, { readonly: false });
    const { getByTestId } = renderLayer({ store });
    const overlay = getByTestId('pencil-overlay');

    drawStroke(overlay, [
      { clientX: 0, clientY: 0 },
      { clientX: 20, clientY: 20 },
    ]);

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(2);
    const newNode = nodes.find((n) => n.id !== 'drawing1');
    expect(newNode?.id).not.toBe('drawing1');
    expect(newNode?.order).toBeGreaterThan(3);
  });

  it('does not commit a node for a single click (no drag) with insufficient points', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { getByTestId } = renderLayer({ store });
    const overlay = getByTestId('pencil-overlay');

    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 5, clientY: 5 });

    expect(store.getSnapshot().nodes).toHaveLength(0);
  });

  it('converts screen to flow coordinates using the live viewport', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { getByTestId } = renderLayer({ store, viewport: { x: 20, y: 10, zoom: 2 } });
    const overlay = getByTestId('pencil-overlay');

    // screenToFlow({x:120,y:110}, {x:20,y:10,zoom:2}) = {x:50,y:50}
    // screenToFlow({x:220,y:210}, {x:20,y:10,zoom:2}) = {x:100,y:100}
    drawStroke(overlay, [
      { clientX: 120, clientY: 110 },
      { clientX: 220, clientY: 210 },
    ]);

    const { nodes } = store.getSnapshot();
    const node = nodes[0];
    if (node.type !== 'drawing') throw new Error('expected a drawing node');
    const absolute = node.points.map((p) => ({ x: p.x + node.pos.x, y: p.y + node.pos.y }));
    expect(absolute[0]).toEqual({ x: 50, y: 50 });
    expect(absolute[absolute.length - 1]).toEqual({ x: 100, y: 100 });
  });

  it('Shift held snaps points to the grid', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const { getByTestId } = renderLayer({ store });
    const overlay = getByTestId('pencil-overlay');

    drawStroke(
      overlay,
      [
        { clientX: 7, clientY: 13 },
        { clientX: 53, clientY: 68 },
      ],
      { shiftKey: true },
    );

    const { nodes } = store.getSnapshot();
    const node = nodes[0];
    if (node.type !== 'drawing') throw new Error('expected a drawing node');
    const absolute = node.points.map((p) => ({ x: p.x + node.pos.x, y: p.y + node.pos.y }));
    // snapToGrid rounds to nearest 20: (7,13) -> (0,20); (53,68) -> (60,60)
    expect(absolute[0]).toEqual({ x: 0, y: 20 });
    expect(absolute[absolute.length - 1]).toEqual({ x: 60, y: 60 });
  });
});

describe('PencilLayer — read-only', () => {
  it('does not render an overlay on a read-only store', () => {
    const store = createBoardStore(emptyBoard(), { readonly: true });
    const { queryByTestId } = renderLayer({ store, active: true });
    expect(queryByTestId('pencil-overlay')).not.toBeInTheDocument();
  });
});
