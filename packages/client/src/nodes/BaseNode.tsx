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

import type { CSSProperties, ReactNode } from 'react';
import type { DescriptionBadgeProps } from './DescriptionBadge.js';
import { DescriptionBadge } from './DescriptionBadge.js';

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
  style?: CSSProperties;
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
  style,
}: BaseNodeProps) {
  const editable = !!onDoubleClick;

  const descriptionBadgeProps: DescriptionBadgeProps = {
    nodeId,
    description,
    editable,
    onOpenDescription,
    style: descriptionBadgeStyle,
  };

  return (
    <div
      data-selected={selected ? 'true' : 'false'}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    >
      <div
        data-testid="base-node-rotation"
        onDoubleClick={onDoubleClick}
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
      </div>
    </div>
  );
}
