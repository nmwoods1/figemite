// ── CardinalityEdge ───────────────────────────────────────────────────────────
//
// Ported from figmalade's CardinalityEdge.tsx: an ER-style edge — the path
// plus cardinality pills (1:1/1:N/N:1/N:N) near each endpoint, deliberately
// with NO arrowheads (cardinality notation communicates direction/multiplicity
// via the pills, not an arrowhead), solid/dashed stroke, and an optional verb
// label. Deviation from the legacy: no editing UI (pill click-to-toggle,
// double-click-to-edit label input, `onLabelChange`/`onCardinalityChange`/
// `onStyleChange` callbacks) — Phase 3 is read-only end to end. Editing is a
// Phase-4 seam, same rationale as ArrowEdge's module doc.
//
// Source/target handle positions are auto-detected from raw endpoint geometry
// (not taken from the `sourcePosition`/`targetPosition` props) — ported
// faithfully from the legacy, which does the same so the pill offsets always
// point "outward" from the edge regardless of which handles were connected.

import { EdgeLabelRenderer, getBezierPath, Position } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { Cardinality, LineStyle } from '@easel/shared';

export interface CardinalityEdgeData extends Record<string, unknown> {
  label?: string;
  style: LineStyle;
  cardinality: Cardinality;
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
        {/* Source-side pill */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${sourceX + srcDx}px, ${sourceY + srcDy}px)`,
            pointerEvents: 'none',
            zIndex: 10,
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
            }}
            title={`Source: ${srcSymbol}`}
          >
            {srcSymbol}
          </span>
        </div>

        {/* Target-side pill */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${targetX + tgtDx}px, ${targetY + tgtDy}px)`,
            pointerEvents: 'none',
            zIndex: 10,
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
            }}
            title={`Target: ${tgtSymbol}`}
          >
            {tgtSymbol}
          </span>
        </div>

        {/* Centre verb label */}
        {hasLabel && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
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
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
