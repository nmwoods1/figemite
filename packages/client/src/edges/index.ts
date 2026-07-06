// ── The ReactFlow edge-type registry ─────────────────────────────────────────
//
// BoardCanvas (P3-T20) passes this map to `<ReactFlow edgeTypes={edgeTypes} />`.
// Keyed by the RF edge `type` string (matching rf-adapters.ts's
// `boardEdgeToRf`, which sets `type` to `'cardinality'` when
// `edge.kind === 'cardinality'`, else `'arrow'`).

import type { EdgeTypes } from '@xyflow/react';
import { ArrowEdge } from './ArrowEdge.js';
import { CardinalityEdge } from './CardinalityEdge.js';

export const edgeTypes: EdgeTypes = {
  arrow: ArrowEdge,
  cardinality: CardinalityEdge,
};

export { ArrowEdge } from './ArrowEdge.js';
export type { ArrowEdgeData } from './ArrowEdge.js';
export { CardinalityEdge } from './CardinalityEdge.js';
export type { CardinalityEdgeData } from './CardinalityEdge.js';
