// ── The 4 directional connection handles ─────────────────────────────────────
//
// Ported from the identical top/right/bottom/left `<Handle>` block that was
// copy-pasted across StickyNode/ShapeNode/EmojiNode/IconNode in the legacy
// prototype. `id`s ('t'/'r'/'b'/'l') match the legacy exactly since
// `BoardEdge.sourceHandle`/`targetHandle` (see @easel/shared) persist these
// ids — changing them would break existing board files' edge endpoints.
//
// `interactive` gates whether handles render at all: Phase 3 is render-only,
// and a read-only board should show no edge-drawing affordances whatsoever
// (not just visually hidden — genuinely absent, so there's nothing to
// accidentally drag).
//
// `anchors`, when provided, overrides the default bbox-edge-midpoint
// position with explicit per-handle (x, y) node-local coordinates — needed
// by ShapeNode's diamond, whose visual vertices sit inset from the bbox
// edges (see ShapeNode.tsx's `getDiamondAnchors`).

import type { CSSProperties } from 'react';
import { Handle, Position } from '@xyflow/react';

export interface HandleAnchor {
  x: number;
  y: number;
}

export interface HandleAnchors {
  t: HandleAnchor;
  r: HandleAnchor;
  b: HandleAnchor;
  l: HandleAnchor;
}

export interface ConnectionHandlesProps {
  /** Whether handles should render at all (false for read-only boards). */
  interactive: boolean;
  /** Explicit vertex anchors, e.g. for a diamond shape. Omit for the default
   * bbox-edge-midpoint placement ReactFlow gives each `Position`. */
  anchors?: HandleAnchors;
}

const HANDLE_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  background: '#94a3b8',
  border: '1.5px solid #fff',
  borderRadius: '50%',
};

function anchorStyle(anchor: HandleAnchor): CSSProperties {
  return {
    ...HANDLE_STYLE,
    left: anchor.x,
    top: anchor.y,
    right: 'auto',
    bottom: 'auto',
    transform: 'translate(-50%, -50%)',
  };
}

/** The 4 directional connection handles, shared by every connectable node type. */
export function ConnectionHandles({ interactive, anchors }: ConnectionHandlesProps) {
  if (!interactive) return null;

  return (
    <>
      <Handle
        type="source"
        position={Position.Top}
        id="t"
        style={anchors ? anchorStyle(anchors.t) : HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        style={anchors ? anchorStyle(anchors.r) : HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={anchors ? anchorStyle(anchors.b) : HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="l"
        style={anchors ? anchorStyle(anchors.l) : HANDLE_STYLE}
      />
    </>
  );
}
