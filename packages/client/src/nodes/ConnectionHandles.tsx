// ── The 4 directional connection handles ─────────────────────────────────────
//
// Ported from the identical top/right/bottom/left `<Handle>` block that was
// copy-pasted across StickyNode/ShapeNode/EmojiNode/IconNode in the legacy
// prototype. `id`s ('t'/'r'/'b'/'l') match the legacy exactly since
// `BoardEdge.sourceHandle`/`targetHandle` (see @easel/shared) persist these
// ids — changing them would break existing board files' edge endpoints.
//
// CRITICAL: the handle elements ALWAYS render, even on a read-only board.
// ReactFlow measures each rendered handle's DOM position to build the node's
// `handleBounds`; with no handles in the DOM, `getEdgePosition` can't find an
// endpoint and throws error #008 — so edges never paint. (jsdom masks this
// because it can't run RF's measurement pipeline; it only surfaced once P3-T20
// rendered a real board in a browser.) `interactive` therefore gates the
// handles' BEHAVIOUR, not their existence: when false (read-only), handles
// render but are `isConnectable={false}` and visually hidden (opacity 0,
// pointer-events none) so a read-only board shows no distracting connection
// dots yet edges still route correctly.
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
  /** Whether the handles are connectable + visible. false (read-only) keeps
   * the handle elements in the DOM — so ReactFlow can still measure them and
   * route edges — but makes them non-connectable and visually hidden. */
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

/** Applied when `!interactive`: keeps the handle in the DOM (so RF measures
 * it and edges route) but hides it and stops it swallowing pointer events. */
const HIDDEN_HANDLE_STYLE: CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
};

function handleStyle(interactive: boolean, anchor?: HandleAnchor): CSSProperties {
  const base: CSSProperties = anchor
    ? {
        ...HANDLE_STYLE,
        left: anchor.x,
        top: anchor.y,
        right: 'auto',
        bottom: 'auto',
        transform: 'translate(-50%, -50%)',
      }
    : HANDLE_STYLE;
  return interactive ? base : { ...base, ...HIDDEN_HANDLE_STYLE };
}

/** The 4 directional connection handles, shared by every connectable node type. */
export function ConnectionHandles({ interactive, anchors }: ConnectionHandlesProps) {
  return (
    <>
      <Handle
        type="source"
        position={Position.Top}
        id="t"
        isConnectable={interactive}
        style={handleStyle(interactive, anchors?.t)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={interactive}
        style={handleStyle(interactive, anchors?.r)}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={interactive}
        style={handleStyle(interactive, anchors?.b)}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="l"
        isConnectable={interactive}
        style={handleStyle(interactive, anchors?.l)}
      />
    </>
  );
}
