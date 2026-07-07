// ── AnnotationLayer: EPHEMERAL pink discussion scribbles ─────────────────────
//
// Rendered as a sibling of `<ReactFlow>` inside the same measured container
// (mirrors CommentLayer/PencilLayer's pattern). Unlike PencilLayer's
// persisted `DrawingNode` (a real node in `nodeData`/`nodeTexts`), an
// annotation stroke is pushed onto the room's `Y.Array` named by the shared
// `ANNOTATIONS` const (`crdt/schema.ts`) — `doc.getArray(ANNOTATIONS)`. That
// array lives on the SAME `Y.Doc` as every node/edge, so it SYNCS live across
// peers through the room's provider exactly like any other doc content — but
// it is never written to `board.json`: both the client's own snapshot cache
// (store/board-store.ts) and the server's persistence path
// (packages/server/src/services/yjs-ws.ts) build their view of "the board"
// via `@figemite/shared`'s `getSnapshot(doc)`, which only ever reads
// `nodeData`/`nodeTexts`/`edgeData` (crdt/ops.ts) — it has no knowledge of
// `ANNOTATIONS` at all. So annotations sync live but never persist, matching
// the legacy prototype's component-state-only strokes (this rewrite's
// version just gets multiplayer sync for free by riding the doc instead of
// local React state).
//
// Freehand capture (pointerdown -> move -> up, Shift-to-snap,
// screen<->flow via `canvas/coords.ts`) mirrors PencilLayer exactly — see
// that module's doc for the rationale of bypassing RF's own snap-to-grid.
// The only difference on commit: push `{ points, color, strokeWidth }` onto
// the Y.Array instead of building + adding a BoardNode.
//
// Every array entry renders as a pink SVG path, transformed by the live
// viewport (same `translate/scale` CSS-transform convention as PencilLayer).
// The array is observed directly (`Y.Array.observe`) so a remote peer's push
// (or a local Wipe) re-renders this component without needing the doc's
// node/edge snapshot machinery at all.
//
// Wipe (`arr.delete(0, arr.length)`, in a transaction) clears the array for
// everyone — every connected peer's observer fires and their overlay goes
// blank. Only shown once there's something to wipe.
//
// Ported behavior (freehand capture, pink color/stroke-width constants, Wipe)
// from the original prototype's `src/components/AnnotationLayer.tsx`,
// rewired onto `canvas/coords.ts`'s shared coords helpers and a real
// `Y.Array` (via the shared `ANNOTATIONS` schema const) instead of the
// legacy's local `strokes` React state + `onAddStroke` callback.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useViewport } from '@xyflow/react';
import * as Y from 'yjs';
import { ANNOTATIONS } from '@figemite/shared';
import type { XY } from '@figemite/shared';
import { getFlowPointer, snapToGrid } from '../canvas/coords.js';
import { smoothPath, thinPoints } from '../lib/draw-utils.js';

/** Always-pink — matches the legacy's `ANNOTATION_COLOR`/`ANNOTATION_STROKE_WIDTH`. */
export const ANNOTATION_COLOR = '#ec4899';
export const ANNOTATION_STROKE_WIDTH = 4;

export interface AnnotationStroke {
  points: XY[];
  color: string;
  strokeWidth: number;
}

export interface AnnotationLayerProps {
  /** True while the toolbar's annotation-mode toggle is active. */
  active: boolean;
  /** Ref to the measured container (same element `<ReactFlow>` is mounted
   * inside) so pointer positions can be resolved relative to its bounds. */
  containerRef: RefObject<HTMLDivElement | null>;
  doc: Y.Doc;
}

/** Subscribes to `doc.getArray(ANNOTATIONS)` and returns its current contents
 * as a plain array, re-rendering the caller on every push/delete/Wipe —
 * whether that change originated locally or from a remote peer's sync. */
function useAnnotationStrokes(doc: Y.Doc): AnnotationStroke[] {
  const arr = doc.getArray<AnnotationStroke>(ANNOTATIONS);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>(() => arr.toArray());

  useEffect(() => {
    const onChange = () => setStrokes(arr.toArray());
    onChange();
    arr.observe(onChange);
    return () => arr.unobserve(onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `arr` is re-derived from `doc` each render (a stable Y.Array instance per doc, but not referentially memoized here); re-subscribing on `doc` identity change is the intended behaviour.
  }, [doc]);

  return strokes;
}

export function AnnotationLayer({ active, containerRef, doc }: AnnotationLayerProps) {
  const viewport = useViewport();
  const strokes = useAnnotationStrokes(doc);
  const [drawing, setDrawing] = useState<XY[] | null>(null);
  const drawingRef = useRef<XY[] | null>(null);

  const setStroke = useCallback((next: XY[] | null) => {
    drawingRef.current = next;
    setDrawing(next);
  }, []);

  const toFlow = useCallback(
    (e: { clientX: number; clientY: number }, snap: boolean): XY => {
      const rect = containerRef.current?.getBoundingClientRect();
      const point = getFlowPointer(e, rect ?? { left: 0, top: 0 }, viewport);
      return snap ? snapToGrid(point) : point;
    },
    [containerRef, viewport],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setStroke([toFlow(e, e.shiftKey)]);
    },
    [active, toFlow, setStroke],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || !drawingRef.current) return;
      setStroke([...drawingRef.current, toFlow(e, e.shiftKey)]);
    },
    [active, toFlow, setStroke],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || !drawingRef.current) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ok — pointer capture may already have been released/lost */
      }
      const points = thinPoints(drawingRef.current);
      setStroke(null);
      if (points.length < 2) return;

      const arr = doc.getArray<AnnotationStroke>(ANNOTATIONS);
      doc.transact(() => {
        arr.push([{ points, color: ANNOTATION_COLOR, strokeWidth: ANNOTATION_STROKE_WIDTH }]);
      });
    },
    [active, setStroke, doc],
  );

  const handleWipe = useCallback(() => {
    const arr = doc.getArray<AnnotationStroke>(ANNOTATIONS);
    doc.transact(() => {
      arr.delete(0, arr.length);
    });
  }, [doc]);

  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

  return (
    <>
      {active && (
        <div
          data-testid="annotation-overlay"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 16,
            cursor: 'crosshair',
          }}
        />
      )}

      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <g style={{ transform, transformOrigin: '0 0' }}>
          {strokes.map((s, i) => (
            <path
              key={i}
              data-testid={`annotation-stroke-${i}`}
              d={smoothPath(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.92}
            />
          ))}
          {drawing && drawing.length > 0 && (
            <path
              d={smoothPath(drawing)}
              fill="none"
              stroke={ANNOTATION_COLOR}
              strokeWidth={ANNOTATION_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.92}
            />
          )}
        </g>
      </svg>

      {strokes.length > 0 && (
        <button
          type="button"
          onClick={handleWipe}
          title="Wipe all annotations"
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 17,
            background: ANNOTATION_COLOR,
            color: '#fff',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.3,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(236,72,153,0.35)',
          }}
        >
          Wipe
        </button>
      )}
    </>
  );
}
