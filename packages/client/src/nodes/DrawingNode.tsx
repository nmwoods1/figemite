// ── DrawingNode ───────────────────────────────────────────────────────────────
//
// Ported from figmalade's DrawingNode.tsx: a persistent freehand pencil
// stroke. `points` are relative to the node's `pos` so dragging only updates
// `pos` — the SVG path doesn't need rewriting on move. No editing, no
// connection handles, no rotation — none exist for drawings in the legacy
// model either.

import type { NodeProps, Node } from '@xyflow/react';
import type { XY } from '@easel/shared';
import { smoothPath } from '../lib/draw-utils.js';

export interface DrawingNodeData extends Record<string, unknown> {
  points: XY[];
  color: string;
  strokeWidth: number;
  width: number;
  height: number;
}

export function DrawingNode({ data, selected }: NodeProps<Node<DrawingNodeData, 'drawing'>>) {
  const d = smoothPath(data.points);

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
      <svg
        width={data.width}
        height={data.height}
        viewBox={`0 0 ${data.width} ${data.height}`}
        style={{ display: 'block', position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <path
          d={d}
          fill="none"
          stroke={data.color}
          strokeWidth={data.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
        {/* Fat invisible hit-target for easier selection of thin strokes. */}
        <path
          d={d}
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
