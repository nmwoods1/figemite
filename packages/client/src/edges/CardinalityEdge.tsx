// ── CardinalityEdge ───────────────────────────────────────────────────────────
//
// Ported from the prototype's CardinalityEdge.tsx: an ER-style edge — the path
// plus cardinality pills (1:1/1:N/N:1/N:N) near each endpoint, deliberately
// with NO arrowheads (cardinality notation communicates direction/multiplicity
// via the pills, not an arrowhead), solid/dashed stroke, and an optional verb
// label. P4-T24 wires both inline affordances the legacy had: double-click
// the center label to edit it (`useEditableText`, same pattern as ArrowEdge),
// and click either pill to toggle that side's cardinality (1<->N) via
// `data.onCardinalityChange` — each gated on its respective write callback.
// `onStyleChange` is NOT an inline affordance in the legacy either — that's
// toolbar-driven (P4-T25); this task only adds the store op
// (`board-store.ts`'s `setEdgeLineStyle`) it will call.
//
// Source/target handle positions are auto-detected from raw endpoint geometry
// (not taken from the `sourcePosition`/`targetPosition` props) — ported
// faithfully from the legacy, which does the same so the pill offsets always
// point "outward" from the edge regardless of which handles were connected.

import { EdgeLabelRenderer, getBezierPath, Position } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { Cardinality, LineStyle } from '@figemite/shared';
import { useEditableText } from '../nodes/useEditableText.js';

export interface CardinalityEdgeData extends Record<string, unknown> {
  label?: string;
  style: LineStyle;
  cardinality: Cardinality;
  onLabelChange?: (id: string, label: string) => void;
  onCardinalityChange?: (id: string, cardinality: Cardinality) => void;
}

/** Toggle the SOURCE side of a cardinality pair between 1 and N. */
function toggleSource(c: Cardinality): Cardinality {
  if (c === '1:1') return 'N:1';
  if (c === '1:N') return 'N:N';
  if (c === 'N:1') return '1:1';
  return '1:N';
}

/** Toggle the TARGET side of a cardinality pair between 1 and N. */
function toggleTarget(c: Cardinality): Cardinality {
  if (c === '1:1') return '1:N';
  if (c === '1:N') return '1:1';
  if (c === 'N:1') return 'N:N';
  return 'N:1';
}

const CARDINALITY_SYMBOLS: Record<Cardinality, [string, string]> = {
  '1:1': ['1', '1'],
  '1:N': ['1', 'N'],
  'N:1': ['N', '1'],
  'N:N': ['N', 'N'],
};

function pillOffset(pos: Position): [number, number] {
  switch (pos) {
    case Position.Top:
      return [0, -28];
    case Position.Bottom:
      return [0, 28];
    case Position.Left:
      return [-28, 0];
    case Position.Right:
      return [28, 0];
    default:
      return [0, 28];
  }
}

export function CardinalityEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  data,
  style = {},
}: EdgeProps<Edge<CardinalityEdgeData, 'cardinality'>>) {
  const label = data?.label;
  const editable = !!data?.onLabelChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    label ?? '',
    (next) => data?.onLabelChange?.(id, next.trim()),
  );

  // Auto-detect source/target positions from geometry (ported from the legacy).
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  let srcPos: Position;
  let tgtPos: Position;
  if (Math.abs(dy) >= Math.abs(dx)) {
    srcPos = dy >= 0 ? Position.Bottom : Position.Top;
    tgtPos = dy >= 0 ? Position.Top : Position.Bottom;
  } else {
    srcPos = dx >= 0 ? Position.Right : Position.Left;
    tgtPos = dx >= 0 ? Position.Left : Position.Right;
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: srcPos,
    targetX,
    targetY,
    targetPosition: tgtPos,
  });

  const strokeColor = selected ? '#2563eb' : '#475569';
  const isDashed = data?.style === 'dashed';
  const resolvedStyle: React.CSSProperties = {
    ...style,
    stroke: strokeColor,
    strokeWidth: selected ? 2 : 1.5,
    ...(isDashed ? { strokeDasharray: '6 4' } : null),
  };

  const hasLabel = label != null && label !== '';
  const cardinality = data?.cardinality ?? '1:N';
  const [srcSymbol, tgtSymbol] = CARDINALITY_SYMBOLS[cardinality];

  const [srcDx, srcDy] = pillOffset(srcPos);
  const [tgtDx, tgtDy] = pillOffset(tgtPos);

  return (
    <>
      <path id={id} className="react-flow__edge-path" d={edgePath} style={resolvedStyle} />

      <EdgeLabelRenderer>
        {/* Source-side pill — click toggles this side's cardinality (1<->N)
            when `onCardinalityChange` is present (seam: read-only edges get
            no click handler and stay inert, matching every other affordance's
            gating convention). */}
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${sourceX + srcDx}px, ${sourceY + srcDy}px)`,
            pointerEvents: 'all',
            zIndex: 10,
          }}
          onClick={(e) => {
            e.stopPropagation();
            data?.onCardinalityChange?.(id, toggleSource(cardinality));
          }}
        >
          <span
            style={{
              background: '#1e293b',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              borderRadius: 4,
              padding: '1px 5px',
              lineHeight: 1.6,
              userSelect: 'none',
              cursor: data?.onCardinalityChange ? 'pointer' : 'default',
            }}
            title={`Source: ${srcSymbol}`}
          >
            {srcSymbol}
          </span>
        </div>

        {/* Target-side pill — same click-to-toggle affordance. */}
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${targetX + tgtDx}px, ${targetY + tgtDy}px)`,
            pointerEvents: 'all',
            zIndex: 10,
          }}
          onClick={(e) => {
            e.stopPropagation();
            data?.onCardinalityChange?.(id, toggleTarget(cardinality));
          }}
        >
          <span
            style={{
              background: '#1e293b',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              borderRadius: 4,
              padding: '1px 5px',
              lineHeight: 1.6,
              userSelect: 'none',
              cursor: data?.onCardinalityChange ? 'pointer' : 'default',
            }}
            title={`Target: ${tgtSymbol}`}
          >
            {tgtSymbol}
          </span>
        </div>

        {/* Centre verb label — double-click to edit (same useEditableText
            pattern as ArrowEdge/every node), "+" affordance when selected,
            editable, and empty. */}
        {(hasLabel || editing || (selected && editable)) && (
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
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
                  border: '1px solid #2563eb',
                  borderRadius: 3,
                  padding: '1px 4px',
                  background: '#fff',
                  color: '#1e293b',
                  outline: 'none',
                  width: Math.max(60, draft.length * 7),
                  textAlign: 'center',
                }}
              />
            ) : hasLabel ? (
              <span
                style={{
                  fontSize: 11,
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 3,
                  padding: '1px 6px',
                  color: '#475569',
                  fontStyle: 'italic',
                }}
              >
                {label}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 11,
                  color: '#94a3b8',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: 3,
                  padding: '0px 5px',
                  userSelect: 'none',
                }}
                title="Double-click to add verb label"
              >
                +
              </span>
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
