// ── Description badge ────────────────────────────────────────────────────────
//
// Ported from the legacy per-node "≡" button (StickyNode/ShapeNode/TextNode/
// EmojiNode/IconNode each drew their own copy). Shown whenever a description
// exists; also shown on hover for editable nodes so authors discover the
// affordance to ADD one. Read-only nodes only ever show it when a
// description already exists (no hover-to-discover, since there's nothing
// to add).
//
// Scope note (P3-T19): clicking calls `onOpenDescription?.(nodeId)` — a seam
// only. The TipTap description modal that this eventually opens is a later
// task; nothing here renders modal content.

import { useState } from 'react';
import type { CSSProperties } from 'react';

export interface DescriptionBadgeProps {
  nodeId: string;
  description: string | undefined;
  /** Whether this node is editable (has write callbacks). Gates hover-reveal. */
  editable: boolean;
  onOpenDescription?: (nodeId: string) => void;
  /** Positioning override — callers (e.g. ShapeNode's diamond) may need a
   * different anchor than the default top-right corner. */
  style?: CSSProperties;
}

const BASE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 16,
  height: 16,
  borderRadius: '50%',
  fontSize: 9,
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
 * A small badge indicating (and, when editable, offering to add) a
 * description. Wraps its own hover tracking so callers just render it inside
 * a `position: relative` container — no need to lift hover state up.
 */
export function DescriptionBadge({
  nodeId,
  description,
  editable,
  onOpenDescription,
  style,
}: DescriptionBadgeProps) {
  const [hovered, setHovered] = useState(false);

  const visible = !!description || (editable && hovered);

  return (
    <div
      data-testid="description-badge-hover-zone"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {visible && (
        <button
          type="button"
          className="nodrag"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDescription?.(nodeId);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title={description ? 'View description' : 'Add description'}
          style={{
            ...BASE_STYLE,
            border: `1.5px solid ${description ? '#0f766e' : '#94a3b8'}`,
            background: description ? '#0f766e' : 'transparent',
            color: description ? '#fff' : '#94a3b8',
            pointerEvents: 'auto',
            ...style,
          }}
        >
          &#8801;
        </button>
      )}
    </div>
  );
}
