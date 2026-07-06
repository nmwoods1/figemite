// ── ArrowEdge ─────────────────────────────────────────────────────────────────
//
// Ported from figmalade's ArrowEdge.tsx: a bezier path with arrowhead markers
// per `data.arrow` (`none`/`end`/`both`), solid/dashed stroke per `data.style`,
// and an optional label. Deviation from the legacy: no label-editing UI
// (double-click-to-edit input, `onLabelChange`/`onArrowChange`/`onStyleChange`
// callbacks) — Phase 3 is read-only end to end, so this only ever renders.
// Label editing is a Phase-4 seam: when it lands, gate the edit affordance on
// a write callback in `data` (e.g. `data.onLabelChange`), mirroring how
// BaseNode/node components gate their own double-click-to-edit on
// `data.onTextChange` (see nodes/BaseNode.tsx's module doc).

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { ArrowStyle, LineStyle } from '@easel/shared';

export interface ArrowEdgeData extends Record<string, unknown> {
  label?: string;
  style: LineStyle;
  arrow: ArrowStyle;
}

export function ArrowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<ArrowEdgeData, 'arrow'>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strokeDasharray = data?.style === 'dashed' ? '6 4' : undefined;

  // Marker ids for arrowheads — namespaced per edge id so multiple ArrowEdges
  // on the same board don't collide in the shared SVG `<defs>` id space.
  const markerId = `arrow-end-${id}`;
  const markerStartId = `arrow-start-${id}`;

  const arrowColor = selected ? '#2563eb' : '#64748b';
  const strokeColor = selected ? '#2563eb' : '#94a3b8';
  const strokeWidth = selected ? 2 : 1.5;

  const showEnd = data?.arrow === 'end' || data?.arrow === 'both';
  const showStart = data?.arrow === 'both';

  return (
    <>
      <defs>
        {showEnd && (
          <marker id={markerId} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={arrowColor} />
          </marker>
        )}
        {showStart && (
          <marker
            id={markerStartId}
            markerWidth="10"
            markerHeight="7"
            refX="1"
            refY="3.5"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={arrowColor} />
          </marker>
        )}
      </defs>

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={showEnd ? `url(#${markerId})` : undefined}
        markerStart={showStart ? `url(#${markerStartId})` : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray,
        }}
      />

      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
              zIndex: selected ? 10 : 5,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: '#475569',
                background: '#fff',
                border: '1px solid transparent',
                padding: '1px 5px',
                borderRadius: 4,
                userSelect: 'none',
                display: 'block',
              }}
            >
              {data.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
