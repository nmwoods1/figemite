// ── ArrowEdge ─────────────────────────────────────────────────────────────────
//
// Ported from figmalade's ArrowEdge.tsx: a bezier path with arrowhead markers
// per `data.arrow` (`none`/`end`/`both`), solid/dashed stroke per `data.style`,
// and an optional label. P4-T24 wires the inline label-editing seam (ported
// from the legacy): double-click the label region to edit, Enter/blur
// commits via `data.onLabelChange`, Escape reverts — using the SAME
// `useEditableText` state machine every node's text edit uses (nodes/
// useEditableText.ts), gated the same way (`data.onLabelChange` present ⇒
// editable). When selected, editable, and no label exists yet, a small "+"
// affordance invites adding one (matches the legacy exactly).
// `onArrowChange`/`onStyleChange` are NOT inline affordances in the legacy
// either — those are toolbar-driven (P4-T25); this task only adds the store
// ops (`board-store.ts`'s `setEdgeArrow`/`setEdgeLineStyle`) they'll call.

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { ArrowStyle, LineStyle } from '@easel/shared';
import { useEditableText } from '../nodes/useEditableText.js';

export interface ArrowEdgeData extends Record<string, unknown> {
  label?: string;
  style: LineStyle;
  arrow: ArrowStyle;
  onLabelChange?: (id: string, label: string) => void;
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
  const editable = !!data?.onLabelChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data?.label ?? '',
    (next) => data?.onLabelChange?.(id, next.trim()),
  );

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

      {(data?.label || editing || (selected && editable)) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: selected ? 10 : 5,
            }}
            onDoubleClick={editable ? startEdit : undefined}
          >
            {editing ? (
              <input
                value={draft}
                onChange={(e) => onChange(e.target.value)}
                onBlur={commit}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') cancel();
                  e.stopPropagation();
                }}
                style={{
                  fontSize: 11,
                  fontFamily: 'inherit',
                  background: '#fff',
                  border: '1px solid #94a3b8',
                  borderRadius: 4,
                  padding: '1px 5px',
                  outline: 'none',
                  minWidth: 40,
                  width: Math.max(40, draft.length * 7),
                  color: '#475569',
                }}
              />
            ) : data?.label ? (
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
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: '#94a3b8',
                  userSelect: 'none',
                  display: 'block',
                  padding: '1px 5px',
                  cursor: 'text',
                }}
                title="Double-click to add label"
              >
                +
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
