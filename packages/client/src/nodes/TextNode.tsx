// ── TextNode ──────────────────────────────────────────────────────────────────
//
// Ported from figmalade's TextNode.tsx: a free-floating label, no connection
// handles (legacy TextNode never had any — it's a label, not something edges
// connect to) and no rotation. Uses `useEditableText`/`BaseNode` for the
// shared edit/description-badge chrome.

import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode.js';
import { useEditableText } from './useEditableText.js';

export interface TextNodeData extends Record<string, unknown> {
  text: string;
  description?: string;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
}

export function TextNode({ id, data, selected }: NodeProps<Node<TextNodeData, 'text'>>) {
  const editable = !!data.onTextChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text,
    (next) => {
      const trimmed = next.trim();
      data.onTextChange?.(id, trimmed || data.text);
    },
  );

  return (
    <BaseNode
      nodeId={id}
      selected={selected}
      description={data.description}
      onOpenDescription={data.onOpenDescription}
      onDoubleClick={editable ? startEdit : undefined}
      descriptionBadgeStyle={{ top: -8, right: -8 }}
      style={{
        minWidth: 60,
        maxWidth: 240,
        width: 'auto',
        height: 'auto',
        padding: '2px 6px',
        background: selected ? 'rgba(37,99,235,0.06)' : 'transparent',
        border: selected ? '1px dashed #2563eb' : '1px dashed transparent',
        borderRadius: 4,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {editing ? (
        <textarea
          className="nodrag"
          value={draft}
          rows={Math.max(1, draft.split('\n').length)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            e.stopPropagation();
          }}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            resize: 'none',
            fontSize: 13,
            fontWeight: 600,
            color: '#475569',
            lineHeight: 1.4,
            width: Math.max(80, draft.length * 7.5),
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#475569',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            display: 'block',
          }}
        >
          {data.text || 'Label'}
        </span>
      )}
    </BaseNode>
  );
}
