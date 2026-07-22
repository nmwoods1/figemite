// ── DrawingNode ───────────────────────────────────────────────────────────────
//
// Ported from the prototype's DrawingNode.tsx: a persistent freehand pencil
// stroke. `points` are relative to the node's `pos` so dragging only updates
// `pos` — the SVG path doesn't need rewriting on move. No editing, no
// connection handles, no rotation — none exist for drawings in the legacy
// model either. Per-node NodeResizer (P4-T24) IS added here even though the
// legacy had none for DrawingNode individually (only via its multi-select
// group resize, which also scales the stroke's `points` — see
// canvas/coords.ts and the multi-select resize wiring), per this task's
// explicit resizable-types list.

import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import type { XY } from '@figemite/shared';
import { getStrokePath, smoothPath } from '../lib/draw-utils.js';
import { useIsMultiSelected } from './use-is-multi-selected.js';

export interface DrawingNodeData extends Record<string, unknown> {
  points: XY[];
  color: string;
  strokeWidth: number;
  width: number;
  height: number;
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
}

/** No per-node min size existed in the legacy (DrawingNode had no individual
 * NodeResizer there — see this file's module doc); floor matches the
 * legacy's multi-select group-resize MIN_BBOX so a drawing can never be
 * resized down to nothing either way. */
const MIN_WIDTH = 20;
const MIN_HEIGHT = 20;

export function DrawingNode({ id, data, selected }: NodeProps<Node<DrawingNodeData, 'drawing'>>) {
  const resizable = !!data.onResizeEnd;
  const multiSelected = useIsMultiSelected();
  // Visible stroke: a filled perfect-freehand outline (pressure-simulated).
  // Hit target: the plain centerline, fattened + transparent, so thin strokes
  // stay easy to click.
  const outline = getStrokePath(data.points, { size: data.strokeWidth, last: true });
  const centerline = smoothPath(data.points);

  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        position: 'relative',
        // Selection highlight is a subtle dashed bbox around the stroke
        // (matches TextNode). The stroke itself is already colored and
        // doesn't need a brighter outline.
        border: selected ? '1px dashed #2563eb' : '1px dashed transparent',
        borderRadius: 4,
        boxSizing: 'border-box',
        cursor: 'default',
      }}
    >
      <NodeResizer
        nodeId={id}
        isVisible={!!selected && resizable && !multiSelected}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        handleStyle={{
          width: 8,
          height: 8,
          background: '#fff',
          border: '1.5px solid #94a3b8',
          borderRadius: 2,
        }}
        onResizeEnd={(_event, params) =>
          data.onResizeEnd?.(id, { width: params.width, height: params.height })
        }
      />
      <svg
        width={data.width}
        height={data.height}
        viewBox={`0 0 ${data.width} ${data.height}`}
        style={{ display: 'block', position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <path
          data-testid="drawing-fill"
          d={outline}
          fill={data.color}
          stroke="none"
          style={{ pointerEvents: 'fill' }}
        />
        {/* Fat invisible hit-target for easier selection of thin strokes. */}
        <path
          data-testid="drawing-hit"
          d={centerline}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(data.strokeWidth + 10, 12)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
      </svg>
    </div>
  );
}
