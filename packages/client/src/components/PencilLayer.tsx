// ── PencilLayer: freehand pencil drawing -> a PERSISTED DrawingNode ──────────
//
// Rendered as a sibling of `<ReactFlow>` inside the same measured container
// (mirrors CommentLayer's pattern — see that module's doc). While `active`
// (the toolbar's pencil-mode toggle), a full-pane overlay captures
// pointerdown -> pointermove* -> pointerup, accumulating FLOW-space points
// via `canvas/coords.ts`'s `getFlowPointer` (screen<->flow's one shared
// transform) rather than RF's own `screenToFlowPosition`, which always
// honours the canvas's own snap-to-grid — a pencil stroke needs to follow the
// cursor exactly. Holding Shift opts into the same 20px grid
// (`canvas/coords.ts`'s `snapToGrid`) the rest of the canvas uses for new
// nodes.
//
// The in-progress stroke renders as a live smoothed SVG path (`smoothPath`,
// packages/client/src/lib/draw-utils.ts, ported from the legacy in P3). On
// pointerup, the accumulated points are thinned (`thinPoints`, same module)
// and committed via `@figemite/shared`'s `makeDrawingNode` (which computes the
// bbox + rebases points to be relative to it) + `store.addNode` — a NORMAL,
// PERSISTED node that syncs and survives a reload through the doc, unlike
// AnnotationLayer's ephemeral strokes (see that module's doc for the
// contrast).
//
// Ported behavior (screen->flow conversion bypassing RF's own snap,
// Shift-to-snap, live smoothed preview) from the original
// prototype's `src/components/PencilLayer.tsx`, rewired onto this codebase's
// shared coords module and doc-first `BoardStore.addNode` instead of the
// legacy's `onCommit` callback into a local reducer.

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useViewport } from '@xyflow/react';
import { generateId, makeDrawingNode, nextOrder } from '@figemite/shared';
import type { XY } from '@figemite/shared';
import { getFlowPointer, snapToGrid } from '../canvas/coords.js';
import { smoothPath, thinPoints } from '../lib/draw-utils.js';
import type { BoardStore } from '../store/board-store.js';

export interface PencilLayerProps {
  /** True while the toolbar's pencil-mode toggle is active. */
  active: boolean;
  /** Ref to the measured container (same element `<ReactFlow>` is mounted
   * inside) so pointer positions can be resolved relative to its bounds. */
  containerRef: RefObject<HTMLDivElement | null>;
  store: BoardStore;
  /** Stroke color for new pencil strokes. Matches the legacy default. */
  color?: string;
  strokeWidth?: number;
}

const DEFAULT_COLOR = '#1e293b';
const DEFAULT_STROKE_WIDTH = 3;

export function PencilLayer({
  active,
  containerRef,
  store,
  color = DEFAULT_COLOR,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: PencilLayerProps) {
  const viewport = useViewport();
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

      const existingIds = new Set(store.getSnapshot().nodes.map((n) => n.id));
      const id = generateId('drawing', existingIds);
      const order = nextOrder(store.getSnapshot().nodes);
      const node = makeDrawingNode(id, points, order, color, strokeWidth);
      store.addNode(node);
    },
    [active, setStroke, store, color, strokeWidth],
  );

  if (!active || store.readonly) return null;

  // Live-preview stroke rendered in flow space, transformed to screen space
  // via a CSS transform on the SVG group (mirrors the legacy's approach and
  // CommentLayer/AnnotationLayer's shared convention for overlay drawing).
  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

  return (
    <div
      data-testid="pencil-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 15,
        cursor: 'crosshair',
      }}
    >
      {drawing && drawing.length > 0 && (
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          <g style={{ transform, transformOrigin: '0 0' }}>
            <path
              d={smoothPath(drawing)}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      )}
    </div>
  );
}
