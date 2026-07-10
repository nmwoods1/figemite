// ── Drill-in (sub-board) badge ───────────────────────────────────────────────
//
// Ported from the legacy prototype's per-node "›" drill button
// (StickyNode/ShapeNode each drew their own copy). Clicking it opens the
// node's sub-board — a nested canvas scoped to that node — creating an empty
// one first if none exists yet (the create path is editable-only; see
// `canCreate`). The whole sub-board backend + breadcrumb navigation already
// exist (server repo, /api/create, app/router.ts's `path` segments,
// components/Breadcrumb.tsx); this badge is the missing node-level affordance
// that was deferred in the refactor.
//
// Visibility mirrors DescriptionBadge's contract, with a sub-board twist:
//   - `hasSubBoard`: the node ALREADY has a sub-board → always show (a solid
//     blue badge that navigates in). True in read-only mode too, so a
//     published/static board can still drill into existing sub-boards.
//   - `canCreate && hovered`: no sub-board yet, but this node is editable →
//     show on hover (an outlined "create one" affordance). `canCreate` is
//     false in read-only mode, so a static board never offers to create.
//
// Like DescriptionBadge, hover state is OWNED BY THE CALLER (`BaseNode`, on
// its rotation wrapper — a real pointer-events-auto element) and passed in as
// `hovered`; this component tracks no hover itself (see DescriptionBadge.tsx's
// module doc for the pointer-events bug that rationale prevents).

import type { CSSProperties } from 'react';

export interface DrillInBadgeProps {
  nodeId: string;
  /** Whether the node already has a sub-board (always-visible, navigate-in). */
  hasSubBoard: boolean;
  /** Whether a sub-board may be CREATED from here (editable mode only). Gates
   * the hover-to-create affordance for a node without a sub-board yet. */
  canCreate: boolean;
  /** Whether the node is currently hovered — owned by the caller (BaseNode). */
  hovered: boolean;
  onDrillIn?: (nodeId: string) => void;
  /** Positioning override — callers (e.g. ShapeNode's diamond) may need a
   * different anchor than the default top-right slot. */
  style?: CSSProperties;
}

const BASE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 4,
  // One badge-width (16) + 4px gap to the LEFT of the description badge
  // (right: 4), so the two never overlap when both are visible.
  right: 24,
  width: 16,
  height: 16,
  borderRadius: '50%',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: '1',
  padding: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  zIndex: 5,
};

/**
 * A small badge that opens (or, when editable, offers to create) a node's
 * sub-board. Renders nothing when not visible, so it never shadows the node
 * body underneath it — hover detection is the caller's (`BaseNode`'s) job,
 * passed in as `hovered`.
 *
 * The outer `data-testid="drill-in-badge-hover-zone"` div mirrors
 * DescriptionBadge's stable locator anchor: a plain, unstyled wrapper carrying
 * no pointer-events trick and no hover listeners of its own.
 */
export function DrillInBadge({
  nodeId,
  hasSubBoard,
  canCreate,
  hovered,
  onDrillIn,
  style,
}: DrillInBadgeProps) {
  const visible = hasSubBoard || (canCreate && hovered);

  return (
    <div data-testid="drill-in-badge-hover-zone">
      {visible && (
        <button
          type="button"
          className="nodrag"
          onClick={(e) => {
            e.stopPropagation();
            onDrillIn?.(nodeId);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title={hasSubBoard ? 'Open sub-board' : 'Create sub-board'}
          style={{
            ...BASE_STYLE,
            border: `1.5px solid ${hasSubBoard ? '#2563eb' : '#94a3b8'}`,
            background: hasSubBoard ? '#2563eb' : 'transparent',
            color: hasSubBoard ? '#fff' : '#94a3b8',
            pointerEvents: 'auto',
            ...style,
          }}
        >
          &#8250;
        </button>
      )}
    </div>
  );
}
