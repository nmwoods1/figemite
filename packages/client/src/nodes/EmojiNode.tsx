// ── EmojiNode ─────────────────────────────────────────────────────────────────
//
// Ported from figmalade's EmojiNode.tsx: a single emoji glyph rendered at
// `size` pixels. Resize/rotate interaction HANDLERS (NodeResizer,
// RotationHandle drag-to-rotate) are Phase 4 — this renders `data.rotation`
// as a static CSS transform only (see BaseNode). Uses `useEditableText`/
// `ConnectionHandles`/`BaseNode` for the shared chrome. `ConnectionHandles`
// is nested INSIDE `BaseNode`'s children (i.e. inside the rotation wrapper),
// matching the legacy's DOM nesting exactly — so the handles rotate together
// with the glyph rather than staying axis-aligned.

import type { NodeProps, Node } from '@xyflow/react';
import { ConnectionHandles } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';
import { useEditableText } from './useEditableText.js';

export interface EmojiNodeData extends Record<string, unknown> {
  text: string;
  size: number;
  description?: string;
  rotation?: number;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
}

export function EmojiNode({ id, data, selected }: NodeProps<Node<EmojiNodeData, 'emoji'>>) {
  const editable = !!data.onTextChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text,
    (next) => {
      const trimmed = next.trim();
      if (trimmed) data.onTextChange?.(id, trimmed);
    },
  );

  const size = data.size;

  return (
    <BaseNode
      nodeId={id}
      selected={selected}
      rotation={data.rotation}
      description={data.description}
      onOpenDescription={data.onOpenDescription}
      onDoubleClick={editable ? startEdit : undefined}
      descriptionBadgeStyle={{ top: 2, right: 2 }}
    >
      <ConnectionHandles interactive={editable} />
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: selected ? 'rgba(37,99,235,0.06)' : 'transparent',
          border: selected ? '1px dashed #2563eb' : '1px dashed transparent',
          borderRadius: 6,
          cursor: 'default',
          userSelect: 'none',
          position: 'relative',
          WebkitFontSmoothing: 'antialiased',
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
              fontSize: Math.min(size * 0.7, 48),
              textAlign: 'center',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              width: '90%',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: Math.min(size * 0.85, 320),
              lineHeight: 1,
              display: 'block',
            }}
          >
            {data.text}
          </span>
        )}
      </div>
    </BaseNode>
  );
}
