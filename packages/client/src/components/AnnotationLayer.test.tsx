// ── AnnotationLayer tests ─────────────────────────────────────────────────────
//
// The EPHEMERAL discussion-scribble overlay. Unlike PencilLayer's persisted
// DrawingNode (see PencilLayer.test.tsx), a committed annotation stroke is
// pushed onto the room's `Y.Array` named by the shared `ANNOTATIONS` const
// (`store.doc.getArray(ANNOTATIONS)`) — it SYNCS live across peers via the
// provider (same doc, same awareness of updates) but is never written to
// `board.json`: the server's `getSnapshot`-based persistence path
// (`@easel/shared`'s `crdt/ops.ts`) only ever reads `nodeData`/`nodeTexts`/
// `edgeData`, never `annotations` — proven directly below via a real
// `getSnapshot(doc)` call after strokes exist.
//
// Tests exercise a REAL in-memory `Y.Doc` (not a mock) — same preference this
// codebase's other CRDT-touching tests follow (see board-store.ts's module
// doc) — so pushing/wiping the array and reading it back is exercised for
// real, not through a mocked API.

import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import * as Y from 'yjs';
import { ANNOTATIONS, getSnapshot } from '@easel/shared';
import { AnnotationLayer } from './AnnotationLayer.js';

afterEach(() => {
  cleanup();
});

function renderLayer({
  doc,
  active = true,
  viewport = { x: 0, y: 0, zoom: 1 },
}: {
  doc: Y.Doc;
  active?: boolean;
  viewport?: { x: number; y: number; zoom: number };
}) {
  const containerRef = createRef<HTMLDivElement>();
  const utils = render(
    <div ref={containerRef} style={{ width: 800, height: 600, position: 'relative' }}>
      <ReactFlow nodes={[]} edges={[]} defaultViewport={viewport}>
        <AnnotationLayer active={active} containerRef={containerRef} doc={doc} />
      </ReactFlow>
    </div>,
  );
  Object.defineProperty(containerRef.current as HTMLDivElement, 'getBoundingClientRect', {
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
  return { ...utils, containerRef };
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

describe('AnnotationLayer — active mode captures pointer events', () => {
  it('renders a full-pane overlay when active', () => {
    const doc = new Y.Doc();
    const { getByTestId } = renderLayer({ doc });
    expect(getByTestId('annotation-overlay')).toBeInTheDocument();
  });

  it('does not render a capturing overlay when inactive, but still renders strokes', () => {
    const doc = new Y.Doc();
    doc
      .getArray(ANNOTATIONS)
      .push([{ points: [{ x: 0, y: 0 }], color: '#ec4899', strokeWidth: 4 }]);
    const { queryByTestId, getByTestId } = renderLayer({ doc, active: false });
    expect(queryByTestId('annotation-overlay')).not.toBeInTheDocument();
    expect(getByTestId('annotation-stroke-0')).toBeInTheDocument();
  });
});

describe('AnnotationLayer — commits an ephemeral stroke to the shared Y.Array', () => {
  it('pointerdown -> move -> up pushes a stroke onto doc.getArray(ANNOTATIONS)', () => {
    const doc = new Y.Doc();
    const { getByTestId } = renderLayer({ doc });
    const overlay = getByTestId('annotation-overlay');

    drawStroke(overlay, [
      { clientX: 10, clientY: 10 },
      { clientX: 50, clientY: 10 },
      { clientX: 50, clientY: 60 },
    ]);

    const arr = doc.getArray(ANNOTATIONS);
    expect(arr.length).toBe(1);
    const stroke = arr.get(0) as {
      points: { x: number; y: number }[];
      color: string;
      strokeWidth: number;
    };
    expect(stroke.points[0]).toEqual({ x: 10, y: 10 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({ x: 50, y: 60 });
    expect(stroke.color).toBe('#ec4899');
  });

  it('renders a pink path per entry already in the array', () => {
    const doc = new Y.Doc();
    doc.getArray(ANNOTATIONS).push([
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: '#ec4899',
        strokeWidth: 4,
      },
      {
        points: [
          { x: 5, y: 5 },
          { x: 15, y: 15 },
        ],
        color: '#ec4899',
        strokeWidth: 4,
      },
    ]);
    const { getByTestId } = renderLayer({ doc, active: false });
    expect(getByTestId('annotation-stroke-0')).toBeInTheDocument();
    expect(getByTestId('annotation-stroke-1')).toBeInTheDocument();
  });

  it('re-renders when a remote peer pushes a new stroke onto the array', () => {
    const doc = new Y.Doc();
    const { getByTestId, queryByTestId } = renderLayer({ doc, active: false });
    expect(queryByTestId('annotation-stroke-0')).not.toBeInTheDocument();

    act(() => {
      doc
        .getArray(ANNOTATIONS)
        .push([{ points: [{ x: 0, y: 0 }], color: '#ec4899', strokeWidth: 4 }]);
    });

    expect(getByTestId('annotation-stroke-0')).toBeInTheDocument();
  });

  it('does not commit a stroke for a single click with insufficient points', () => {
    const doc = new Y.Doc();
    const { getByTestId } = renderLayer({ doc });
    const overlay = getByTestId('annotation-overlay');

    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 5, clientY: 5 });

    expect(doc.getArray(ANNOTATIONS).length).toBe(0);
  });

  it('Shift held snaps points to the grid', () => {
    const doc = new Y.Doc();
    const { getByTestId } = renderLayer({ doc });
    const overlay = getByTestId('annotation-overlay');

    drawStroke(
      overlay,
      [
        { clientX: 7, clientY: 13 },
        { clientX: 53, clientY: 68 },
      ],
      { shiftKey: true },
    );

    const arr = doc.getArray(ANNOTATIONS);
    const stroke = arr.get(0) as { points: { x: number; y: number }[] };
    expect(stroke.points[0]).toEqual({ x: 0, y: 20 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({ x: 60, y: 60 });
  });
});

describe('AnnotationLayer — Wipe', () => {
  it('clears the annotations array for everyone', () => {
    const doc = new Y.Doc();
    doc.getArray(ANNOTATIONS).push([
      { points: [{ x: 0, y: 0 }], color: '#ec4899', strokeWidth: 4 },
      { points: [{ x: 1, y: 1 }], color: '#ec4899', strokeWidth: 4 },
    ]);
    const { getByRole } = renderLayer({ doc });
    fireEvent.click(getByRole('button', { name: /wipe/i }));
    expect(doc.getArray(ANNOTATIONS).length).toBe(0);
  });

  it('is not shown when there are no annotations', () => {
    const doc = new Y.Doc();
    const { queryByRole } = renderLayer({ doc });
    expect(queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });
});

describe('AnnotationLayer — ephemerality: getSnapshot never returns annotation data', () => {
  it('a getSnapshot(doc) taken after annotations exist has no trace of them', () => {
    const doc = new Y.Doc();
    doc
      .getArray(ANNOTATIONS)
      .push([{ points: [{ x: 0, y: 0 }], color: '#ec4899', strokeWidth: 4 }]);

    const snapshot = getSnapshot(doc);
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.edges).toEqual([]);
    // Belt-and-braces: nothing in the snapshot mentions the annotation stroke.
    expect(JSON.stringify(snapshot)).not.toContain('#ec4899');
  });
});

describe('AnnotationLayer — read-only', () => {
  it('does not render a capturing overlay when read-only (no active mode possible anyway)', () => {
    const doc = new Y.Doc();
    const { queryByTestId } = renderLayer({ doc, active: false });
    expect(queryByTestId('annotation-overlay')).not.toBeInTheDocument();
  });
});
