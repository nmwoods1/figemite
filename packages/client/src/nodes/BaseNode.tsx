// ── BaseNode: shared chrome for every node component ─────────────────────────
//
// Factors out what was previously copy-pasted per legacy node component:
//   - a rotation wrapper applying `data.rotation` (deg) as a CSS transform
//     (StickyNode has none — sticky notes don't rotate — but Shape/Emoji/Icon
//     all had the identical `transform: rotate(${rotation}deg)` div);
//   - the description-badge slot (DescriptionBadge, positioned top-right by
//     default; callers needing a different anchor — ShapeNode's diamond —
//     pass `descriptionBadgeStyle`);
//   - the double-click-to-edit affordance: calls `onDoubleClick` iff it was
//     given one. This is the read-only seam (P3-T19 scope): node components
//     only pass a handler here when `data.onTextChange` (or equivalent
//     write callback) exists, so a read-only board's nodes double-click to
//     nothing.
//
// Selection ring / resize / rotate HANDLES are explicitly NOT here — those
// are Phase 4 (drag/resize/rotate interaction). `selected` is surfaced only
// as a `data-selected` attribute so node components can style a selection
// ring themselves (each legacy node styled its own selection differently —
// sticky uses a box-shadow ring, frame a solid-vs-dashed border, etc. — so
// BaseNode doesn't impose one shared visual).
//
// Hover tracking for the description badge lives HERE, on the rotation
// wrapper div, not inside `DescriptionBadge` itself: this div spans the
// node's full body and actually receives pointer events (unlike a
// `pointer-events: none` zone, which a real mouse can never trigger — see
// DescriptionBadge.tsx's module doc for the bug this replaced). `editable`
// (which gates hover-reveal for a node WITHOUT a description yet) is derived
// from `onOpenDescription` being present — matching the legacy's
// `showDescBtn = !!data.onOpenDescription && (...)` gate — rather than from
// `onDoubleClick`, since IconNode has no editable text (no `onDoubleClick`)
// but still wants hover-to-reveal governed by whether it's writable at all.
// `rf-adapters.ts`'s `DESCRIBABLE_TYPES`/readonly gating means
// `onOpenDescription` is only ever passed down for an editable board's
// describable node types, so this is a safe, read-only-callback-free signal.

import { useContext, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { DescriptionBadgeProps } from './DescriptionBadge.js';
import { DescriptionBadge } from './DescriptionBadge.js';
import { DrillInBadge } from './DrillInBadge.js';
import { DescriptionReadOnlyContext } from './description-mode.js';

export interface BaseNodeProps {
  nodeId: string;
  children: ReactNode;
  /** Rotation in degrees, applied as `rotate(${rotation}deg)` around the
   * content's center. Absent/0 renders no transform at all. */
  rotation?: number;
  selected?: boolean;
  description?: string;
  onOpenDescription?: (nodeId: string) => void;
  /** Only provided by a node component when the node is editable (i.e.
   * `data.onTextChange` or equivalent is present) — the double-click-to-edit
   * seam. Absent means double-click does nothing (read-only). */
  onDoubleClick?: () => void;
  /** Position override for the description badge (ShapeNode's diamond needs
   * a center-top anchor instead of the default top-right corner). */
  descriptionBadgeStyle?: CSSProperties;
  /** Whether the node already has a sub-board (drives the always-visible,
   * navigate-in drill badge). Absent/false hides it unless a create-affordance
   * is offered (see `onDrillIn`/`canCreateSubBoard`). */
  hasSubBoard?: boolean;
  /** Whether a sub-board may be CREATED from this node (editable mode only) —
   * gates the hover-to-create drill affordance for a node without one yet. */
  canCreateSubBoard?: boolean;
  /** Opens (creating first if needed) the node's sub-board. Absent means no
   * drill badge renders at all (the read-only/no-op seam). */
  onDrillIn?: (nodeId: string) => void;
  /** Position override for the drill-in badge (ShapeNode's diamond anchors it
   * to the left of the center-top description badge). */
  drillInBadgeStyle?: CSSProperties;
  style?: CSSProperties;
  /** Forwarded onto the rotation wrapper div (P4-T24) — `RotationHandle`
   * measures this element's `getBoundingClientRect()` to compute the drag
   * angle around the node's actual (rotating) center, so it needs a ref to
   * the SAME div `rotation`'s CSS transform is applied to. */
  rotationRef?: RefObject<HTMLDivElement | null>;
}

/** Shared chrome wrapper every node component composes: rotation, the
 * description-badge slot, and the double-click-to-edit affordance. */
export function BaseNode({
  nodeId,
  children,
  rotation,
  selected,
  description,
  onOpenDescription,
  onDoubleClick,
  descriptionBadgeStyle,
  hasSubBoard,
  canCreateSubBoard,
  onDrillIn,
  drillInBadgeStyle,
  style,
  rotationRef,
}: BaseNodeProps) {
  // Descriptions can be opened whenever `onOpenDescription` is wired, but the
  // hover-to-ADD affordance is suppressed when descriptions are read-only (the
  // content-locked live board): there the badge appears only for a node that
  // already HAS a description, and clicking it opens a read-only view. Drafts
  // (and every provider-less render) default to editable, unchanged.
  const descriptionReadOnly = useContext(DescriptionReadOnlyContext);
  const canAddDescription = !!onOpenDescription && !descriptionReadOnly;
  const [hovered, setHovered] = useState(false);

  const descriptionBadgeProps: DescriptionBadgeProps = {
    nodeId,
    description,
    editable: canAddDescription,
    hovered,
    onOpenDescription,
    style: descriptionBadgeStyle,
  };

  return (
    <div
      data-selected={selected ? 'true' : 'false'}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    >
      <div
        ref={rotationRef}
        data-testid="base-node-rotation"
        onDoubleClick={onDoubleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        {children}
        <DescriptionBadge {...descriptionBadgeProps} />
        {onDrillIn && (
          <DrillInBadge
            nodeId={nodeId}
            hasSubBoard={!!hasSubBoard}
            canCreate={!!canCreateSubBoard}
            hovered={hovered}
            onDrillIn={onDrillIn}
            style={drillInBadgeStyle}
          />
        )}
      </div>
    </div>
  );
}
