// ── Description badge ────────────────────────────────────────────────────────
//
// Ported from the legacy per-node "≡" button (StickyNode/ShapeNode/TextNode/
// EmojiNode/IconNode each drew their own copy). Shown whenever a description
// exists; also shown on hover for editable nodes so authors discover the
// affordance to ADD one. Read-only nodes only ever show it when a
// description already exists (no hover-to-discover, since there's nothing
// to add).
//
// Hover tracking is NOT owned here (see history: an earlier version wrapped
// its own `pointer-events: none` hover-zone div and tracked `hovered` via
// local state — but a `pointer-events: none` element can never receive a
// REAL browser mouse's `onMouseEnter`, only jsdom's synthetic
// `fireEvent.mouseEnter`, which bypasses CSS pointer-events entirely. That
// made a node WITHOUT a description permanently unable to reveal its "add"
// affordance for any real user, even though unit tests passed). The caller
// (`BaseNode`) owns hover state instead, tracked on its rotation wrapper —
// a real, pointer-events-auto element that already covers the whole node
// body — and passes it down as the `hovered` prop.
//
// Scope note (P3-T19): clicking calls `onOpenDescription?.(nodeId)` — a seam
// only. The TipTap description modal that this eventually opens is a later
// task; nothing here renders modal content.

import type { CSSProperties } from 'react';

export interface DescriptionBadgeProps {
  nodeId: string;
  description: string | undefined;
  /** Whether this node is editable (has write callbacks). Gates hover-reveal. */
  editable: boolean;
  /** Whether the node is currently hovered — owned by the caller (BaseNode),
   * which tracks it on an element that actually receives pointer events. */
  hovered: boolean;
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
 * description. Renders nothing when not visible, so it never shadows the
 * node body underneath it — hover detection is the caller's (`BaseNode`'s)
 * job, passed in as `hovered`.
 *
 * The outer `data-testid="description-badge-hover-zone"` div is kept as a
 * STABLE LOCATOR ANCHOR only (existing e2e/unit tests scope the badge button
 * via `[data-testid="description-badge-hover-zone"] button`) — it carries no
 * `pointer-events: none` trick and no hover listeners of its own; it's a
 * plain, unstyled (non-positioned) wrapper that doesn't affect the button's
 * own `position: absolute` placement.
 */
export function DescriptionBadge({
  nodeId,
  description,
  editable,
  hovered,
  onOpenDescription,
  style,
}: DescriptionBadgeProps) {
  const visible = !!description || (editable && hovered);

  return (
    <div data-testid="description-badge-hover-zone">
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
