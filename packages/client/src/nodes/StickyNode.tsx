// ── StickyNode ────────────────────────────────────────────────────────────────
//
// Ported from figmalade's StickyNode.tsx. Differences from the legacy:
//   - `hexToRgba` now comes from `./color.js` (was duplicated inline).
//   - Uses `useEditableText` instead of local editing/draft state.
//   - Uses `ConnectionHandles`/`BaseNode` for the shared chrome.
//   - NodeResizer wiring and the drill-in (sub-board) badge are dropped —
//     resize/rotate/drill-in interaction handlers are Phase 4. The
//     description badge (render-only: presence indicator + seam) IS built.
//   - `interactive` (whether handles/edit affordances show) is derived from
//     whether `data.onTextChange` is present, matching the read-only-vs-
//     editable seam the task specifies, rather than a separate READONLY
//     global (Phase 4/BoardCanvas decides what callbacks to pass down).

import type { NodeProps, Node } from '@xyflow/react';
import { ConnectionHandles } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';
import { useEditableText } from './useEditableText.js';

export interface StickyNodeData extends Record<string, unknown> {
  text: string;
  color: string;
  width: number;
  height: number;
  description?: string;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
}

export function StickyNode({ id, data, selected }: NodeProps<Node<StickyNodeData, 'sticky'>>) {
  const editable = !!data.onTextChange;
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text,
    (next) => data.onTextChange?.(id, next),
  );

  const bg = data.color;

  return (
    <BaseNode
      nodeId={id}
      selected={selected}
      description={data.description}
      onOpenDescription={data.onOpenDescription}
      onDoubleClick={editable ? startEdit : undefined}
    >
      <ConnectionHandles interactive={editable} />
      <div
        data-testid="sticky-body"
        style={{
          width: '100%',
          height: '100%',
          background: bg,
          borderRadius: 4,
          boxSizing: 'border-box',
          padding: 10,
          display: 'flex',
          alignItems: 'flex-start',
          cursor: 'default',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {editing ? (
          <textarea
            className="nodrag"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commit}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
              e.stopPropagation();
            }}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              fontSize: 14,
              fontWeight: 500,
              color: '#1e293b',
              lineHeight: 1.5,
              fontFamily: 'inherit',
              cursor: 'text',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: '#1e293b',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              width: '100%',
              userSelect: 'none',
              opacity: data.text ? 1 : 0.4,
            }}
          >
            {data.text || 'Double-click to edit'}
          </span>
        )}
      </div>
    </BaseNode>
  );
}
