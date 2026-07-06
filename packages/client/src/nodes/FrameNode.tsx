// ── FrameNode ─────────────────────────────────────────────────────────────────
//
// Ported from figmalade's FrameNode.tsx: a titled container. Legacy
// FrameNode has no description badge, no connection handles, and no
// rotation — none of those are added here either. `hexToRgba` now comes from
// `./color.js` (was duplicated inline, identically to StickyNode's copy).
// Uses `useEditableText` for the title edit state instead of local state.
//
// The title bar keeps `frame-drag-handle` as a className: BoardCanvas
// (P3-T20) configures ReactFlow's `dragHandle` selector to `.frame-drag-handle`
// so frames drag only by their title bar, not their whole body (matching the
// legacy's drag-handle convention) — that wiring is Phase 4/T20, but the
// className needs to already be present for it to have something to select.

import type { NodeProps, Node } from '@xyflow/react';
import { hexToRgba } from './color.js';
import { useEditableText } from './useEditableText.js';

export interface FrameNodeData extends Record<string, unknown> {
  title: string;
  color: string;
  width: number;
  height: number;
  onTitleChange?: (id: string, newTitle: string) => void;
}

export function FrameNode({ id, data, selected }: NodeProps<Node<FrameNodeData, 'frame'>>) {
  const editable = !!data.onTitleChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.title,
    (next) => {
      const trimmed = next.trim();
      if (trimmed) data.onTitleChange?.(id, trimmed);
    },
  );

  const color = data.color;
  const fill = hexToRgba(color, 0.18);
  const border = hexToRgba(color, 0.85);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: fill,
        border: `2px ${selected ? 'solid' : 'dashed'} ${border}`,
        borderRadius: 10,
        boxSizing: 'border-box',
        position: 'relative',
        cursor: 'default',
      }}
    >
      <div
        className="frame-drag-handle"
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (editable) startEdit();
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'inline-flex',
          alignItems: 'center',
          padding: '6px 12px',
          background: border,
          color: '#1e293b',
          fontSize: 13,
          fontWeight: 600,
          borderTopLeftRadius: 8,
          borderBottomRightRadius: 10,
          cursor: editing ? 'text' : 'move',
          userSelect: 'none',
          maxWidth: 'calc(100% - 24px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxShadow: selected ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
        }}
      >
        {editing ? (
          <input
            className="nodrag"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commit}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
              e.stopPropagation();
            }}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: 600,
              color: '#1e293b',
              width: Math.max(80, draft.length * 8),
              fontFamily: 'inherit',
              cursor: 'text',
            }}
          />
        ) : (
          <span>{data.title || 'Frame'}</span>
        )}
      </div>
    </div>
  );
}
