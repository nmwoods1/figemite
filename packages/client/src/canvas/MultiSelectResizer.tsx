// ── MultiSelectResizer ────────────────────────────────────────────────────────
//
// Ported from the prototype's src/components/MultiSelectResizer.tsx: when 2+
// board nodes are selected, this overlay draws a single bounding box around
// the whole group with 8 resize handles (4 corners + 4 edges), mimicking how
// Figma/Sketch/Keynote scale a multi-selection as one. It sits as an
// absolutely-positioned sibling of the ReactFlow canvas and uses the live
// viewport transform (`useViewport`) to project the flow-space bbox to
// screen coordinates — via `canvas/coords.ts`'s `flowToScreen`/`boundingBox`/
// `nodeRect`, the SAME transform every other overlay in this codebase uses,
// rather than reimplementing the math (see coords.ts's module doc).
//
// On mousedown we snapshot the bbox and every selected node's rect, then on
// every mousemove call `onScale` with a scale factor + fixed anchor corner +
// the snapshotted rects. The CALLER (BoardCanvas/useEditableCanvas) applies
// that spec to the board via `multi-select-scale.ts`'s pure per-type
// transform + the store's `applyNodePatch` — this component only does
// geometry, no board mutation.
//
// Deviation from the legacy: no GRID_SIZE snapping (the new codebase has no
// grid-snap concept anywhere else either — see multi-select-scale.ts's
// module doc) — only the MIN_BBOX floor is kept.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewport } from '@xyflow/react';
import type { RefObject } from 'react';
import type { BoardNode } from '@figemite/shared';
import { boundingBox, flowToScreen, nodeRect } from './coords.js';
import type { Rect } from './coords.js';
import type { OriginalRect, ScaleSpec } from './multi-select-scale.js';

export type ResizeHandleId = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

export interface MultiSelectScaleEvent extends ScaleSpec {
  originalRects: Map<string, OriginalRect>;
}

export interface MultiSelectResizerProps {
  selectedNodes: BoardNode[];
  containerRef: RefObject<HTMLDivElement | null>;
  onStart: () => void;
  onScale: (spec: MultiSelectScaleEvent) => void;
}

/** Mirrors the legacy's MIN_BBOX — the group bbox can never scale below this
 * floor in either dimension while dragging. */
const MIN_BBOX = 20;
const HANDLE_SIZE = 10;

const HANDLE_DEFS: { id: ResizeHandleId; cx: number; cy: number; cursor: string }[] = [
  { id: 'tl', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { id: 't', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { id: 'tr', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { id: 'r', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { id: 'br', cx: 1, cy: 1, cursor: 'nwse-resize' },
  { id: 'b', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { id: 'bl', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { id: 'l', cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

interface DragState {
  handle: ResizeHandleId;
  startBbox: Rect;
  originalRects: Map<string, OriginalRect>;
  startMouseFlow: { x: number; y: number };
}

export function MultiSelectResizer({
  selectedNodes,
  containerRef,
  onStart,
  onScale,
}: MultiSelectResizerProps) {
  const viewport = useViewport();
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  const rects = useMemo(() => {
    const m = new Map<string, OriginalRect>();
    for (const n of selectedNodes) m.set(n.id, nodeRect(n));
    return m;
  }, [selectedNodes]);

  const bbox = useMemo(() => boundingBox(selectedNodes), [selectedNodes]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      const container = containerRef.current;
      if (!state || !container) return;
      const rect = container.getBoundingClientRect();
      const flowX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const flowY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const dx = flowX - state.startMouseFlow.x;
      const dy = flowY - state.startMouseFlow.y;

      const { startBbox, handle } = state;
      const right = startBbox.x + startBbox.width;
      const bottom = startBbox.y + startBbox.height;
      const movesLeft = handle === 'tl' || handle === 'l' || handle === 'bl';
      const movesRight = handle === 'tr' || handle === 'r' || handle === 'br';
      const movesTop = handle === 'tl' || handle === 't' || handle === 'tr';
      const movesBottom = handle === 'bl' || handle === 'b' || handle === 'br';

      let newW = startBbox.width;
      let newH = startBbox.height;
      if (movesLeft) newW = right - (startBbox.x + dx);
      if (movesRight) newW = startBbox.width + dx;
      if (movesTop) newH = bottom - (startBbox.y + dy);
      if (movesBottom) newH = startBbox.height + dy;

      newW = Math.max(MIN_BBOX, newW);
      newH = Math.max(MIN_BBOX, newH);

      const sx = newW / startBbox.width;
      const sy = newH / startBbox.height;
      // Opposite corner is the anchor that stays put.
      const anchor = {
        x: movesLeft ? right : startBbox.x,
        y: movesTop ? bottom : startBbox.y,
      };

      onScale({ sx, sy, anchor, originalRects: state.originalRects });
    };

    const onUp = () => {
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, viewport.x, viewport.y, viewport.zoom, containerRef, onScale]);

  if (rects.size < 2) return null;

  const topLeft = flowToScreen({ x: bbox.x, y: bbox.y }, viewport);
  const screen = {
    x: topLeft.x,
    y: topLeft.y,
    width: bbox.width * viewport.zoom,
    height: bbox.height * viewport.zoom,
  };

  const startHandle = (handle: ResizeHandleId) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const flowX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const flowY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
    dragStateRef.current = {
      handle,
      startBbox: bbox,
      originalRects: new Map(rects),
      startMouseFlow: { x: flowX, y: flowY },
    };
    setDragging(true);
    onStart();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      <div
        data-testid="multi-resize-bbox"
        style={{
          position: 'absolute',
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          border: '1.5px solid #2563eb',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      />
      {HANDLE_DEFS.map((h) => (
        <div
          key={h.id}
          data-testid="multi-resize-handle"
          data-handle-id={h.id}
          onMouseDown={startHandle(h.id)}
          style={{
            position: 'absolute',
            left: screen.x + h.cx * screen.width - HANDLE_SIZE / 2,
            top: screen.y + h.cy * screen.height - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            background: '#fff',
            border: '1.5px solid #2563eb',
            borderRadius: 2,
            cursor: h.cursor,
            pointerEvents: 'auto',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  );
}
